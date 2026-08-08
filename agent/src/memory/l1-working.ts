// L1 Working Memory — fast ephemeral session state.
//
// In-process Map is always the source of truth for reads (zero-latency).
// When REDIS_URL is set, every mutation is also written to Redis so that
// multiple agent instances or a restarted process share working-memory state.
// Redis is loaded dynamically so the agent boots without it when the env var
// is absent — the only change visible to callers is that mutations become
// eventually-consistent across instances rather than process-local.

import { WorkingMemoryState } from './types.js';

const MAX_RECENT_DECISIONS = 20;
const REDIS_KEY = 'vino:working-memory';
const REDIS_TTL_SECONDS = 3600; // expire orphaned state after 1 hour

export class L1WorkingMemory {
  private state: WorkingMemoryState;
  // Typed as `any` because the ioredis client is loaded via dynamic import at
  // runtime — adding ioredis as a hard compile-time type dependency would make
  // the agent fail to start when the package is absent.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any = null;

  constructor() {
    this.state = {
      sessionId: `session-${Date.now()}`,
      activeInvoices: [],
      currentMarketRegime: 'unknown',
      recentDecisions: [],
      lastCycleAt: 0,
    };

    if (process.env.REDIS_URL) {
      this.initRedis(process.env.REDIS_URL).catch((err) =>
        console.error('[L1] Redis init failed:', (err as Error).message),
      );
    }
  }

  private async initRedis(url: string): Promise<void> {
    try {
      const ioredis = await import('ioredis');
      const Redis = ioredis.default ?? ioredis;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.redis = new (Redis as any)(url, { lazyConnect: true, maxRetriesPerRequest: 1 });

      this.redis.on('error', (err: Error) => {
        // Demote connection errors to warnings so the agent never crashes
        // due to a transient Redis outage — it degrades to in-process mode.
        console.warn('[L1] Redis connection error (degrading to in-process):', err.message.split('\n')[0]);
      });

      await this.redis.connect();

      // Restore state from Redis if another instance wrote it recently
      const saved = await this.redis.get(REDIS_KEY).catch(() => null);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Partial<WorkingMemoryState>;
          // Only restore shared fields — session ID stays per-instance
          this.state.activeInvoices = parsed.activeInvoices ?? this.state.activeInvoices;
          this.state.currentMarketRegime = parsed.currentMarketRegime ?? this.state.currentMarketRegime;
          this.state.recentDecisions = parsed.recentDecisions ?? this.state.recentDecisions;
          console.log('[L1] Working memory restored from Redis');
        } catch { /* corrupt data — keep in-process defaults */ }
      }

      console.log('✅ L1: Redis connected — working memory is distributed');
    } catch (err) {
      console.warn('[L1] ioredis unavailable, using in-process working memory:', (err as Error).message);
      this.redis = null;
    }
  }

  // Fire-and-forget Redis write. Errors are intentionally swallowed:
  // a failed Redis write degrades gracefully to in-process mode without
  // blocking the caller or crashing the agent.
  private pushRedis(): void {
    if (!this.redis) return;
    const data = JSON.stringify({
      activeInvoices: this.state.activeInvoices,
      currentMarketRegime: this.state.currentMarketRegime,
      recentDecisions: this.state.recentDecisions,
    });
    this.redis.setex(REDIS_KEY, REDIS_TTL_SECONDS, data).catch(() => {/* degraded */});
  }

  get(): WorkingMemoryState {
    return { ...this.state };
  }

  addDecision(tokenId: string, strategy: string): void {
    this.state.recentDecisions.unshift({ tokenId, strategy, timestamp: Date.now() });
    if (this.state.recentDecisions.length > MAX_RECENT_DECISIONS) {
      this.state.recentDecisions.length = MAX_RECENT_DECISIONS;
    }
    this.pushRedis();
  }

  setActiveInvoices(ids: string[]): void {
    this.state.activeInvoices = ids;
    this.pushRedis();
  }

  setMarketRegime(regime: string): void {
    this.state.currentMarketRegime = regime;
    this.pushRedis();
  }

  touchCycle(): void {
    this.state.lastCycleAt = Date.now();
    // lastCycleAt is per-instance — not shared to Redis
  }

  /** Close the Redis connection cleanly on agent shutdown. */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {/* ignore */});
      this.redis = null;
    }
  }
}
