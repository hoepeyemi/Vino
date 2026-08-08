// L3 Semantic Memory — distilled "rules of thumb" condensed from episodic events
// Persisted as JSON. Retrieved by domain keyword matching.
//
// Decay formula (multiplicative so rules always tend to zero):
//   score = (confidence/100 × recencyScore) × 0.7 + hitScore × 0.3
//   recencyScore = e^(-λ × ageDays)   λ=0.008 → half-life ~87 days
//   hitScore     = min(hitCount / 10, 1)
//
// A confidence=75 rule with no hits decays below PRUNE_THRESHOLD at ~200 days.
// Frequent hits (hitCount≥10) can sustain a rule indefinitely.
// Rules below PRUNE_THRESHOLD are removed; LLM re-evaluates borderline ones.

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SemanticMemory } from './types.js';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const MAX_RULES = 200;
const DECAY_LAMBDA = 0.008;       // half-life ~87 days (e-folding ~125 days)
const MS_PER_DAY = 86_400_000;
const PRUNE_THRESHOLD = 0.12;    // composite score below this → prune candidate
const BORDERLINE_BAND = 0.08;    // 0.12–0.20 → ask LLM before pruning

export class L3SemanticMemory {
  private rules: SemanticMemory[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly storePath: string;

  constructor(dataDir: string = DEFAULT_DATA_DIR) {
    this.storePath = path.join(dataDir, 'l3-semantic.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        this.rules = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as SemanticMemory[];
      }
    } catch {
      this.rules = [];
    }
  }

  private persist(): void {
    // Capture state at call time to avoid mutation-during-write corruption.
    // Write to a sibling .tmp file then atomically rename so a mid-write
    // process.exit never leaves a truncated or partially-written JSON file.
    const snapshot = JSON.stringify(this.rules, null, 2);
    const tmp = this.storePath + '.tmp';
    this.writeQueue = this.writeQueue
      .then(() => fsPromises.writeFile(tmp, snapshot, 'utf8'))
      .then(() => fsPromises.rename(tmp, this.storePath))
      .catch((err) => console.error('[L3] Failed to persist rules:', err));
  }

  add(rule: string, domain: SemanticMemory['domain'], evidence: string[], confidence: number): SemanticMemory {
    const keywords = rule
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const semantic: SemanticMemory = {
      id: randomUUID(),
      rule,
      evidence,
      confidence,
      domain,
      keywords,
      hitCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.rules.push(semantic);

    // Evict lowest-scoring rules when over cap.
    // Use ruleScore (confidence × recency × weight + hitScore) so that a freshly
    // distilled rule is not immediately discarded in favour of stale low-confidence
    // rules that happen to have a marginally higher raw confidence value.
    if (this.rules.length > MAX_RULES) {
      this.rules.sort((a, b) => this.ruleScore(a) - this.ruleScore(b));
      this.rules.splice(0, this.rules.length - MAX_RULES);
    }

    this.persist();
    return semantic;
  }

  // Retrieve top-k rules relevant to a query string via keyword overlap
  query(queryText: string, topK = 3): SemanticMemory[] {
    if (this.rules.length === 0) return [];

    const queryWords = new Set(
      queryText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3),
    );

    const scored = this.rules.map((r) => {
      const overlap = r.keywords.filter((k) => queryWords.has(k)).length;
      const score = overlap / Math.max(r.keywords.length, 1);
      return { rule: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).filter((s) => s.score > 0).map((s) => s.rule);

    for (const r of top) {
      r.hitCount++;
      r.updatedAt = Date.now();
    }
    if (top.length > 0) this.persist();

    return top;
  }

  // Composite relevance score in [0, 1].
  // Confidence and recency are multiplicative — both must be high for a rule to
  // survive. The hit component is additive so frequently-recalled rules stay alive
  // even when old. A confidence=75 rule with zero hits crosses PRUNE_THRESHOLD at
  // ~200 days; with 10+ hits it survives indefinitely.
  private ruleScore(rule: SemanticMemory): number {
    const ageDays = (Date.now() - rule.createdAt) / MS_PER_DAY;
    const recencyScore = Math.exp(-DECAY_LAMBDA * ageDays);
    const hitScore = Math.min(rule.hitCount / 10, 1);
    return (rule.confidence / 100) * recencyScore * 0.7 + hitScore * 0.3;
  }

  // Prune L3 rules whose composite score falls below threshold.
  // Borderline rules (within BORDERLINE_BAND above threshold) are passed to the
  // optional LLM evaluator before deciding; definite misses are dropped immediately.
  // Returns pruned count.
  async applyDecay(
    llmEvaluate?: (content: string) => Promise<number>,
  ): Promise<{ count: number; prunedIds: string[] }> {
    const definiteKeep: SemanticMemory[] = [];
    const definitePrune: SemanticMemory[] = [];
    const borderline: SemanticMemory[] = [];

    for (const rule of this.rules) {
      const score = this.ruleScore(rule);
      if (score >= PRUNE_THRESHOLD + BORDERLINE_BAND) {
        definiteKeep.push(rule);
      } else if (score < PRUNE_THRESHOLD) {
        definitePrune.push(rule);
      } else {
        borderline.push(rule);
      }
    }

    // Ask LLM for borderline rules — keep if LLM score (0–1) ≥ 0.5
    const borderlineKept: SemanticMemory[] = [];
    if (llmEvaluate && borderline.length > 0) {
      await Promise.all(
        borderline.map(async (rule) => {
          try {
            const llmScore = await llmEvaluate(rule.rule);
            if (llmScore >= 0.5) {
              borderlineKept.push(rule);
            } else {
              definitePrune.push(rule);
            }
          } catch {
            // On error, keep the rule — safer than dropping it
            borderlineKept.push(rule);
          }
        }),
      );
    } else {
      // No LLM available: keep borderline rules (conservative)
      borderlineKept.push(...borderline);
    }

    const before = this.rules.length;
    this.rules = [...definiteKeep, ...borderlineKept];
    const pruned = before - this.rules.length;

    if (pruned > 0) this.persist();
    return { count: pruned, prunedIds: definitePrune.map((r) => r.id) };
  }

  getAll(): SemanticMemory[] {
    return [...this.rules];
  }

  count(): number {
    return this.rules.length;
  }

  /** Await any in-flight async write so the caller knows the file is up-to-date. */
  flush(): Promise<void> {
    return this.writeQueue;
  }
}
