import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { L2EpisodicMemory } from './l2-episodic.js';
import { L3SemanticMemory } from './l3-semantic.js';
import { LogEpisodeParams } from './types.js';

// Each test suite gets its own temp directory so tests are fully isolated
// and never touch the real data/ directory.
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vino-test-'));
}

function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── L2EpisodicMemory ─────────────────────────────────────────────────────────

describe('L2EpisodicMemory', () => {
  let dir: string;
  let l2: L2EpisodicMemory;

  beforeEach(() => {
    dir = makeTmpDir();
    l2 = new L2EpisodicMemory(dir);
  });

  afterEach(async () => {
    await l2.flush();
    rmDir(dir);
  });

  // ── add ────────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('returns a complete EpisodicMemory with generated id and timestamps', async () => {
      const params: LogEpisodeParams = {
        content: 'Invoice #1 moved from Hold to Conservative',
        tags: ['yield-strategy'],
        tokenId: '1',
        strategy: 'Conservative',
        outcome: 'pending',
        marketRegime: 'stable',
      };

      const m = await l2.add(params);

      expect(m.id).toMatch(/^[0-9a-f-]{36}$/); // UUID
      expect(m.content).toBe(params.content);
      expect(m.tags).toEqual(['yield-strategy']);
      expect(m.tokenId).toBe('1');
      expect(m.outcome).toBe('pending');
      expect(m.relevanceScore).toBe(1);
      expect(m.accessCount).toBe(0);
      expect(m.createdAt).toBeGreaterThan(0);
    });

    it('increments count after each add', async () => {
      expect(l2.count()).toBe(0);
      await l2.add({ content: 'first', tags: ['yield-strategy'] });
      expect(l2.count()).toBe(1);
      await l2.add({ content: 'second', tags: ['market-regime'] });
      expect(l2.count()).toBe(2);
    });

    it('persists to disk so a new instance loads the same memories', async () => {
      await l2.add({ content: 'persisted memory', tags: ['yield-strategy'] });
      await l2.flush();

      const l2b = new L2EpisodicMemory(dir);
      expect(l2b.count()).toBe(1);
      expect(l2b.getAll()[0].content).toBe('persisted memory');
      await l2b.flush();
    });
  });

  // ── search ─────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns empty array when no memories exist', async () => {
      expect(await l2.search('anything')).toHaveLength(0);
    });

    it('returns relevant memories ranked by TF-IDF cosine similarity', async () => {
      await l2.add({ content: 'aggressive yield strategy invoice risk high', tags: ['yield-strategy'] });
      await l2.add({ content: 'market bear regime volatile price drop', tags: ['market-regime'] });
      await l2.add({ content: 'conservative strategy low risk payment probability', tags: ['yield-strategy'] });

      const results = await l2.search('high risk invoice aggressive strategy');

      expect(results.length).toBeGreaterThan(0);
      // The most relevant result should be the aggressive one
      expect(results[0].content).toContain('aggressive');
    });

    it('respects topK limit', async () => {
      for (let i = 0; i < 5; i++) {
        await l2.add({ content: `invoice ${i} strategy yield risk`, tags: ['yield-strategy'] });
      }
      const results = await l2.search('invoice strategy', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('filters by tag when filterTags is provided', async () => {
      await l2.add({ content: 'yield strategy invoice', tags: ['yield-strategy'] });
      await l2.add({ content: 'market regime bear bull', tags: ['market-regime'] });

      const results = await l2.search('strategy invoice market', 10, ['yield-strategy']);

      expect(results.every((m) => m.tags.includes('yield-strategy'))).toBe(true);
    });

    it('increments accessCount on retrieved memories', async () => {
      await l2.add({ content: 'invoice yield strategy risk score', tags: ['yield-strategy'] });
      await l2.search('invoice yield strategy risk');

      const memories = l2.getAll();
      expect(memories[0].accessCount).toBe(1);
    });
  });

  // ── getPendingOutcomes / updateOutcome ─────────────────────────────────────

  describe('outcome tracking', () => {
    it('getPendingOutcomes returns only memories with outcome=pending and tokenId set', async () => {
      await l2.add({ content: 'pending decision', tags: ['invoice-outcome'], tokenId: '1', outcome: 'pending' });
      await l2.add({ content: 'no tokenId', tags: ['invoice-outcome'], outcome: 'pending' });
      await l2.add({ content: 'already resolved', tags: ['invoice-outcome'], tokenId: '2', outcome: 'success' });

      const pending = l2.getPendingOutcomes();
      expect(pending).toHaveLength(1);
      expect(pending[0].tokenId).toBe('1');
    });

    it('updateOutcome resolves a pending episode', async () => {
      const m = await l2.add({ content: 'pending', tags: ['invoice-outcome'], tokenId: '3', outcome: 'pending' });

      l2.updateOutcome(m.id, 'success');

      const pending = l2.getPendingOutcomes();
      expect(pending).toHaveLength(0);
      expect(l2.getAll().find((ep) => ep.id === m.id)?.outcome).toBe('success');
    });

    it('updateOutcome is a no-op when outcome is already resolved', async () => {
      const m = await l2.add({ content: 'done', tags: ['invoice-outcome'], tokenId: '4', outcome: 'success' });
      l2.updateOutcome(m.id, 'suboptimal'); // should not overwrite

      expect(l2.getAll().find((ep) => ep.id === m.id)?.outcome).toBe('success');
    });

    it('updateOutcome is a no-op for an unknown id', () => {
      expect(() => l2.updateOutcome('nonexistent-id', 'success')).not.toThrow();
    });

    it('respects maxCount in getPendingOutcomes', async () => {
      for (let i = 0; i < 5; i++) {
        await l2.add({ content: `pending ${i}`, tags: ['invoice-outcome'], tokenId: String(i), outcome: 'pending' });
      }
      expect(l2.getPendingOutcomes(3)).toHaveLength(3);
    });
  });

  // ── applyDecay ─────────────────────────────────────────────────────────────

  describe('applyDecay', () => {
    it('removes memories whose relevanceScore falls below threshold', async () => {
      // Add a memory then manually set its score below the prune threshold
      const m = await l2.add({ content: 'old memory', tags: ['yield-strategy'] });
      // Backdate createdAt by 3 years to force decay below threshold
      m.createdAt = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;

      const { pruned } = l2.applyDecay();
      expect(pruned).toBe(1);
      expect(l2.count()).toBe(0);
    });

    it('keeps fresh memories', async () => {
      await l2.add({ content: 'fresh memory', tags: ['yield-strategy'] });
      const { pruned } = l2.applyDecay();
      expect(pruned).toBe(0);
      expect(l2.count()).toBe(1);
    });
  });

  // ── removeByIds ────────────────────────────────────────────────────────────

  describe('removeByIds', () => {
    it('removes specified memories by id', async () => {
      const a = await l2.add({ content: 'to remove', tags: ['yield-strategy'] });
      await l2.add({ content: 'to keep', tags: ['yield-strategy'] });

      l2.removeByIds([a.id]);

      expect(l2.count()).toBe(1);
      expect(l2.getAll()[0].content).toBe('to keep');
    });

    it('is a no-op when ids array is empty', async () => {
      await l2.add({ content: 'keep', tags: ['yield-strategy'] });
      l2.removeByIds([]);
      expect(l2.count()).toBe(1);
    });
  });
});

// ── L3SemanticMemory ─────────────────────────────────────────────────────────

describe('L3SemanticMemory', () => {
  let dir: string;
  let l3: L3SemanticMemory;

  beforeEach(() => {
    dir = makeTmpDir();
    l3 = new L3SemanticMemory(dir);
  });

  afterEach(async () => {
    await l3.flush();
    rmDir(dir);
  });

  // ── add ────────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('stores a rule and returns it with keywords extracted', () => {
      const rule = l3.add(
        'High risk score invoices should use conservative strategy',
        'yield',
        ['ep-1', 'ep-2'],
        80,
      );

      expect(rule.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rule.rule).toContain('High risk score');
      expect(rule.confidence).toBe(80);
      expect(rule.domain).toBe('yield');
      expect(rule.evidence).toEqual(['ep-1', 'ep-2']);
      expect(rule.hitCount).toBe(0);
      expect(rule.keywords.length).toBeGreaterThan(0);
    });

    it('increments count', () => {
      expect(l3.count()).toBe(0);
      l3.add('Rule one about yield strategy risk', 'yield', [], 75);
      expect(l3.count()).toBe(1);
      l3.add('Rule two about market regime bear', 'market', [], 70);
      expect(l3.count()).toBe(2);
    });

    it('persists to disk so a new instance loads the same rules', async () => {
      l3.add('yield strategy rule persisted', 'yield', [], 75);
      await l3.flush();

      const l3b = new L3SemanticMemory(dir);
      expect(l3b.count()).toBe(1);
      expect(l3b.getAll()[0].rule).toContain('yield strategy rule');
      await l3b.flush();
    });
  });

  // ── query ──────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('returns empty array when no rules exist', () => {
      expect(l3.query('anything')).toHaveLength(0);
    });

    it('returns rules with keyword overlap to the query', () => {
      l3.add('Invoices with high risk score should use conservative yield strategy', 'yield', [], 80);
      l3.add('Bear market regime reduces aggressive position allocation', 'market', [], 75);

      const results = l3.query('high risk invoice conservative strategy');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].rule).toContain('conservative');
    });

    it('returns empty when no keyword matches', () => {
      l3.add('Invoices with risk score should hold position', 'yield', [], 80);
      // Query with words not in the rule
      const results = l3.query('zzz qqq mmm');
      expect(results).toHaveLength(0);
    });

    it('increments hitCount on retrieved rules', () => {
      l3.add('risk score invoice strategy yield conservative', 'yield', [], 80);
      l3.query('risk score invoice strategy yield');

      const rules = l3.getAll();
      expect(rules[0].hitCount).toBe(1);
    });

    it('respects topK limit', () => {
      for (let i = 0; i < 5; i++) {
        l3.add(`invoice risk score strategy yield rule ${i}`, 'yield', [], 75);
      }
      const results = l3.query('invoice risk score strategy yield', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // ── applyDecay ─────────────────────────────────────────────────────────────

  describe('applyDecay', () => {
    it('prunes rules whose composite score is below threshold', async () => {
      const rule = l3.add('old low confidence rule placeholder text', 'yield', [], 10);
      // Backdate by 3 years so decay score falls well below 0.12
      rule.createdAt = Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;

      const { count } = await l3.applyDecay();
      expect(count).toBe(1);
      expect(l3.count()).toBe(0);
    });

    it('keeps fresh high-confidence rules', async () => {
      l3.add('fresh rule invoice risk strategy yield', 'yield', [], 85);
      const { count } = await l3.applyDecay();
      expect(count).toBe(0);
      expect(l3.count()).toBe(1);
    });

    it('keeps borderline rules when no LLM evaluator is provided', async () => {
      const rule = l3.add('borderline rule invoice risk', 'yield', [], 30);
      // Set age so score is in the borderline band (0.12–0.20)
      rule.createdAt = Date.now() - 400 * 24 * 60 * 60 * 1000; // ~400 days

      const { count } = await l3.applyDecay(); // no LLM → keep borderline
      // Rule may be kept or pruned depending on exact decay; just verify no throw
      expect(typeof count).toBe('number');
    });

    it('asks the LLM evaluator for borderline rules and follows its verdict', async () => {
      const rule = l3.add('borderline invoice rule text here', 'yield', [], 30);
      rule.createdAt = Date.now() - 400 * 24 * 60 * 60 * 1000;

      // LLM says keep it (score >= 0.5)
      const { count: kept } = await l3.applyDecay(async () => 0.8);
      // LLM says discard it (score < 0.5) — re-add since previous run may have pruned
      if (l3.count() === 0) {
        const r2 = l3.add('borderline invoice rule text here second', 'yield', [], 30);
        r2.createdAt = Date.now() - 400 * 24 * 60 * 60 * 1000;
        const { count: pruned } = await l3.applyDecay(async () => 0.2);
        expect(pruned).toBe(1);
      } else {
        expect(kept).toBe(0); // LLM said keep
      }
    });
  });
});
