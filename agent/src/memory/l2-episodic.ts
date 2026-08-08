// L2 Episodic Memory — specific past events with semantic search.
//
// Default: file-backed JSON store with TF-IDF cosine similarity.
// Upgrade: when DATABASE_URL is set a PostgreSQL table is used instead,
//   giving ACID durability, concurrent multi-instance access, and a clear
//   path to pgvector similarity search (requires an embedding API — see
//   the pushPg comment below for the migration point).
//
// The public interface is identical in both modes so no callers change.

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EpisodicMemory, LogEpisodeParams, MemoryTag } from './types.js';
import { decayedRelevance, initialRelevance, shouldPrune } from './decay.js';
import { QWEN_EMBED_DIMS } from '../llm.js';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const MAX_MEMORIES = 500;

// pg DDL — applied once on startup when DATABASE_URL is set.
// The embedding column and ivfflat index are added separately after the core
// table so the table is usable even when pgvector is not installed.
const PG_CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS l2_episodic (
    id               TEXT PRIMARY KEY,
    content          TEXT NOT NULL,
    tags             JSONB NOT NULL DEFAULT '[]',
    token_id         TEXT,
    strategy         TEXT,
    outcome          TEXT,
    market_regime    TEXT,
    relevance_score  REAL NOT NULL DEFAULT 1,
    created_at       BIGINT NOT NULL,
    last_accessed_at BIGINT NOT NULL,
    access_count     INTEGER NOT NULL DEFAULT 0,
    metadata         JSONB NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS l2_episodic_tags_idx    ON l2_episodic USING GIN (tags);
  CREATE INDEX IF NOT EXISTS l2_episodic_outcome_idx ON l2_episodic (outcome) WHERE outcome = 'pending';
`;

// pgvector DDL — applied separately; failures are caught and treated as
// "extension not available" so TF-IDF search stays active.
const PG_ENABLE_VECTOR = (dims: number) => `
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE l2_episodic ADD COLUMN IF NOT EXISTS embedding vector(${dims});
  CREATE INDEX IF NOT EXISTS l2_episodic_embed_idx
    ON l2_episodic USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'for', 'in', 'to', 'a', 'an', 'and',
  'or', 'but', 'with', 'from', 'by', 'of', 'was', 'it', 'its', 'this',
  'that', 'are', 'be', 'been', 'has', 'have', 'had', 'not', 'as', 'into',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  const max = Math.max(...tf.values(), 1);
  for (const [k, v] of tf) tf.set(k, v / max);
  return tf;
}

function cosineSimilarity(tfA: Map<string, number>, tfB: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [term, score] of tfA) {
    dot += score * (tfB.get(term) || 0);
    magA += score * score;
  }
  for (const score of tfB.values()) magB += score * score;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class L2EpisodicMemory {
  private memories: EpisodicMemory[] = [];
  private readonly storePath: string;
  // Serialize async writes via a promise chain so concurrent mutations
  // never interleave and the event loop is never blocked on disk I/O.
  private writeQueue: Promise<void> = Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pgPool: any = null;
  // True once pgvector extension + embedding column are confirmed present
  private pgVectorEnabled = false;
  // Injected by MemorySystem after the LLM service is available
  private embedFn: ((text: string) => Promise<number[] | null>) | null = null;

  constructor(dataDir: string = DEFAULT_DATA_DIR) {
    const storeDir = dataDir;
    this.storePath = path.join(storeDir, 'l2-episodic.json');

    fs.mkdirSync(storeDir, { recursive: true });
    this.load();

    if (process.env.DATABASE_URL) {
      this.initPg(process.env.DATABASE_URL).catch((err) =>
        console.error('[L2] pg init failed:', (err as Error).message),
      );
    }
  }

  private async initPg(connectionString: string): Promise<void> {
    try {
      const pgModule = await import('pg');
      const Pool = pgModule.default?.Pool ?? pgModule.Pool;
      // Strip `sslmode` from the URL so the config-level ssl object below takes
      // precedence. When sslmode=require is present in the URL, pg ignores
      // rejectUnauthorized:false in the options and re-enables strict validation,
      // causing "self-signed certificate in certificate chain" on Aiven / managed hosts.
      const cleanUrl = connectionString.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.pgPool = new (Pool as any)({ connectionString: cleanUrl, max: 3, ssl: { rejectUnauthorized: false } });
      await this.pgPool.query(PG_CREATE_TABLE);

      // Try to enable pgvector — requires the extension to be installed on the
      // pg server. Managed instances (Supabase, Neon, Railway) have it by default.
      // Self-hosted instances may need `CREATE EXTENSION vector` as superuser.
      // Any failure here degrades gracefully to TF-IDF search.
      try {
        await this.pgPool.query(PG_ENABLE_VECTOR(QWEN_EMBED_DIMS));
        this.pgVectorEnabled = true;
        console.log('[L2] pgvector enabled — vector similarity search active');
      } catch {
        console.log('[L2] pgvector extension not available — using TF-IDF search');
      }

      // Bootstrap pg from the file store on first run so existing memories
      // are not lost when switching from file to pg mode.
      if (this.memories.length > 0) {
        const client = await this.pgPool.connect();
        try {
          await client.query('BEGIN');
          for (const m of this.memories) {
            await client.query(
              `INSERT INTO l2_episodic
                 (id, content, tags, token_id, strategy, outcome, market_regime,
                  relevance_score, created_at, last_accessed_at, access_count, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
               ON CONFLICT (id) DO NOTHING`,
              [
                m.id, m.content, JSON.stringify(m.tags), m.tokenId ?? null,
                m.strategy ?? null, m.outcome ?? null, m.marketRegime ?? null,
                m.relevanceScore, m.createdAt, m.lastAccessedAt, m.accessCount,
                JSON.stringify(m.metadata),
              ],
            );
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
        console.log(`[L2] Migrated ${this.memories.length} file-backed memories → pg`);
      }

      // Switch in-memory store to pg view
      // pgPool is `any` from dynamic import so no generic type arg here
      const { rows } = await this.pgPool.query(
        'SELECT * FROM l2_episodic ORDER BY created_at DESC LIMIT $1', [MAX_MEMORIES],
      );
      this.memories = rows.map(this.rowToMemory);
      console.log(`✅ L2: PostgreSQL connected — ${this.memories.length} memories loaded`);
    } catch (err) {
      console.warn('[L2] pg unavailable, using file-backed store:', (err as Error).message);
      this.pgPool = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rowToMemory(row: any): EpisodicMemory {
    return {
      id: row.id,
      content: row.content,
      tags: (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) as MemoryTag[],
      tokenId: row.token_id ?? undefined,
      strategy: row.strategy ?? undefined,
      outcome: row.outcome ?? undefined,
      marketRegime: row.market_regime ?? undefined,
      relevanceScore: row.relevance_score,
      createdAt: Number(row.created_at),
      lastAccessedAt: Number(row.last_accessed_at),
      accessCount: row.access_count,
      metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>,
    };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        this.memories = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as EpisodicMemory[];
      }
    } catch {
      this.memories = [];
    }
  }

  private persist(): void {
    if (this.pgPool) return; // pg is the source of truth — no file write needed
    // Capture state at call time to avoid mutation-during-write corruption.
    // Write to a sibling .tmp file then atomically rename so a mid-write
    // process.exit never leaves a truncated or partially-written JSON file.
    const snapshot = JSON.stringify(this.memories, null, 2);
    const tmp = this.storePath + '.tmp';
    this.writeQueue = this.writeQueue
      .then(() => fsPromises.writeFile(tmp, snapshot, 'utf8'))
      .then(() => fsPromises.rename(tmp, this.storePath))
      .catch((err) => console.error('[L2] Failed to persist memories:', err));
  }

  /**
   * Register the embedding function from LLMService. Called by MemorySystem
   * once the LLM service is available (after agent.start()). Having it as an
   * injectable avoids a circular module dependency between l2-episodic and llm.
   */
  setEmbedFn(fn: (text: string) => Promise<number[] | null>): void {
    this.embedFn = fn;
  }

  private async persistPg(memory: EpisodicMemory, embedding?: number[] | null): Promise<void> {
    if (!this.pgPool) return;
    try {
      if (this.pgVectorEnabled && embedding && embedding.length > 0) {
        // Store with embedding for future vector similarity searches
        const vectorLiteral = `[${embedding.join(',')}]`;
        await this.pgPool.query(
          `INSERT INTO l2_episodic
             (id, content, tags, token_id, strategy, outcome, market_regime,
              relevance_score, created_at, last_accessed_at, access_count, metadata, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
           ON CONFLICT (id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             relevance_score = EXCLUDED.relevance_score,
             last_accessed_at = EXCLUDED.last_accessed_at,
             access_count = EXCLUDED.access_count,
             embedding = COALESCE(EXCLUDED.embedding, l2_episodic.embedding)`,
          [
            memory.id, memory.content, JSON.stringify(memory.tags),
            memory.tokenId ?? null, memory.strategy ?? null,
            memory.outcome ?? null, memory.marketRegime ?? null,
            memory.relevanceScore, memory.createdAt,
            memory.lastAccessedAt, memory.accessCount,
            JSON.stringify(memory.metadata), vectorLiteral,
          ],
        );
      } else {
        await this.pgPool.query(
          `INSERT INTO l2_episodic
             (id, content, tags, token_id, strategy, outcome, market_regime,
              relevance_score, created_at, last_accessed_at, access_count, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET
             outcome = EXCLUDED.outcome,
             relevance_score = EXCLUDED.relevance_score,
             last_accessed_at = EXCLUDED.last_accessed_at,
             access_count = EXCLUDED.access_count`,
          [
            memory.id, memory.content, JSON.stringify(memory.tags),
            memory.tokenId ?? null, memory.strategy ?? null,
            memory.outcome ?? null, memory.marketRegime ?? null,
            memory.relevanceScore, memory.createdAt,
            memory.lastAccessedAt, memory.accessCount,
            JSON.stringify(memory.metadata),
          ],
        );
      }
    } catch (err) {
      console.error('[L2] pg write failed:', (err as Error).message);
    }
  }

  async add(params: LogEpisodeParams): Promise<EpisodicMemory> {
    const memory: EpisodicMemory = {
      id: randomUUID(),
      content: params.content,
      tags: params.tags,
      tokenId: params.tokenId,
      strategy: params.strategy,
      outcome: params.outcome,
      marketRegime: params.marketRegime,
      relevanceScore: initialRelevance(),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      metadata: params.metadata || {},
    };

    this.memories.push(memory);

    // Keep store from growing unbounded. Sort by live decay score rather than the
    // stored relevanceScore (which is only updated hourly) so the eviction decision
    // is accurate even between maintenance cycles when all new memories share the
    // same initial score of 1.0.
    if (this.memories.length > MAX_MEMORIES) {
      this.memories.sort(
        (a, b) => decayedRelevance(a.createdAt, a.accessCount) - decayedRelevance(b.createdAt, b.accessCount),
      );
      this.memories.splice(0, this.memories.length - MAX_MEMORIES);
    }

    // Compute embedding in the background so `add` stays fast.
    // The vector is stored in pg when ready; TF-IDF search works immediately.
    const embedding = this.pgVectorEnabled && this.embedFn
      ? await this.embedFn(params.content).catch(() => null)
      : null;

    await this.persistPg(memory, embedding);
    this.persist();
    return memory;
  }

  async search(query: string, topK = 3, filterTags?: MemoryTag[]): Promise<EpisodicMemory[]> {
    if (this.memories.length === 0) return [];

    // ── pgvector path: cosine similarity via embedded query vector ────────────
    if (this.pgPool && this.pgVectorEnabled && this.embedFn) {
      const queryVec = await this.embedFn(query).catch(() => null);
      if (queryVec) {
        try {
          const tagFilter = filterTags && filterTags.length > 0
            ? `AND tags ?| array[${filterTags.map((t) => `'${t}'`).join(',')}]`
            : '';
          const vectorLiteral = `[${queryVec.join(',')}]`;
          const { rows } = await this.pgPool.query(
            `SELECT *, 1 - (embedding <=> $1::vector) AS vec_sim
             FROM l2_episodic
             WHERE embedding IS NOT NULL ${tagFilter}
             ORDER BY embedding <=> $1::vector
             LIMIT $2`,
            [vectorLiteral, topK],
          );
          if (rows.length > 0) {
            const top = rows.map(this.rowToMemory.bind(this)) as EpisodicMemory[];
            // Sync access stats back to in-memory store
            for (const m of top) {
              m.accessCount++;
              m.lastAccessedAt = Date.now();
              const local = this.memories.find((x) => x.id === m.id);
              if (local) { local.accessCount = m.accessCount; local.lastAccessedAt = m.lastAccessedAt; }
              await this.persistPg(m);
            }
            this.persist();
            return top;
          }
          // Fall through to TF-IDF if no embeddings stored yet
        } catch (err) {
          console.warn('[L2] pgvector search failed, falling back to TF-IDF:', (err as Error).message);
        }
      }
    }

    // ── TF-IDF path: in-process cosine similarity ─────────────────────────────
    const queryTf = termFrequency(tokenize(query));
    const pool = filterTags
      ? this.memories.filter((m) => filterTags.some((t) => m.tags.includes(t)))
      : this.memories;

    const scored = pool.map((m) => {
      const memTf = termFrequency(tokenize(m.content));
      const sim = cosineSimilarity(queryTf, memTf);
      // Use live decay rather than the stale stored relevanceScore (updated hourly at most)
      const liveRelevance = decayedRelevance(m.createdAt, m.accessCount);
      const score = sim * 0.7 + liveRelevance * 0.3;
      return { memory: m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map((s) => s.memory);

    // Update access stats on retrieved memories
    for (const m of top) {
      m.accessCount++;
      m.lastAccessedAt = Date.now();
      await this.persistPg(m);
    }
    if (top.length > 0) this.persist();

    return top;
  }

  applyDecay(): { updated: number; pruned: number } {
    const before = this.memories.length;
    const pruned: string[] = [];
    this.memories = this.memories.filter((m) => {
      m.relevanceScore = decayedRelevance(m.createdAt, m.accessCount);
      if (shouldPrune(m.relevanceScore)) {
        pruned.push(m.id);
        return false;
      }
      return true;
    });

    if (this.pgPool && pruned.length > 0) {
      const placeholders = pruned.map((_, i) => `$${i + 1}`).join(',');
      this.pgPool.query(`DELETE FROM l2_episodic WHERE id IN (${placeholders})`, pruned)
        .catch((err: Error) => console.error('[L2] pg prune failed:', err.message));
    }

    this.persist();
    return { updated: this.memories.length, pruned: before - this.memories.length };
  }

  getByDomain(domain: MemoryTag, maxCount: number): EpisodicMemory[] {
    return this.memories.filter((m) => m.tags.includes(domain)).slice(0, maxCount);
  }

  getAll(): EpisodicMemory[] {
    return [...this.memories];
  }

  removeByIds(ids: string[]): void {
    const idSet = new Set(ids);
    this.memories = this.memories.filter((m) => !idSet.has(m.id));

    if (this.pgPool && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      this.pgPool.query(`DELETE FROM l2_episodic WHERE id IN (${placeholders})`, ids)
        .catch((err: Error) => console.error('[L2] pg removeByIds failed:', err.message));
    }

    this.persist();
  }

  /**
   * Return episodes whose outcome is still 'pending' and whose tokenId is set —
   * these are executed strategy changes that haven't been confirmed yet.
   */
  getPendingOutcomes(maxCount = 20): EpisodicMemory[] {
    return this.memories
      .filter((m) => m.outcome === 'pending' && m.tokenId)
      .slice(0, maxCount);
  }

  /**
   * Resolve a pending outcome once the invoice's on-chain state is known.
   * No-op if the id doesn't exist or outcome is already resolved.
   */
  updateOutcome(id: string, outcome: 'success' | 'suboptimal'): void {
    const memory = this.memories.find((m) => m.id === id);
    if (!memory || memory.outcome !== 'pending') return;
    memory.outcome = outcome;
    memory.lastAccessedAt = Date.now();

    if (this.pgPool) {
      this.pgPool.query(
        'UPDATE l2_episodic SET outcome = $1, last_accessed_at = $2 WHERE id = $3',
        [outcome, Date.now(), id],
      ).catch((err: Error) => console.error('[L2] pg updateOutcome failed:', err.message));
    }

    this.persist();
  }

  count(): number {
    return this.memories.length;
  }

  /** Await any in-flight async write so the caller knows the file is up-to-date. */
  async flush(): Promise<void> {
    await this.writeQueue;
    // Drain pg pool on shutdown
    if (this.pgPool) {
      await this.pgPool.end().catch(() => {/* ignore */});
    }
  }
}
