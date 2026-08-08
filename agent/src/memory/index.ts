// MemoriVault — hierarchical memory system facade
// L1 (working) → L2 (episodic) → L3 (semantic rules)

import { L1WorkingMemory } from './l1-working.js';
import { L2EpisodicMemory } from './l2-episodic.js';
import { L3SemanticMemory } from './l3-semantic.js';
import { MemoryMaintenance } from './maintenance.js';
import {
  MemoryEvent,
  MemoryQueryResult,
  LogEpisodeParams,
  EpisodicMemory,
  SemanticMemory,
} from './types.js';
import type { LLMService } from '../llm.js';

export class MemorySystem {
  readonly l1: L1WorkingMemory;
  readonly l2: L2EpisodicMemory;
  readonly l3: L3SemanticMemory;
  private maintenance: MemoryMaintenance | null = null;
  private eventListeners: Array<(event: MemoryEvent) => void> = [];

  constructor(dataDir?: string) {
    this.l1 = new L1WorkingMemory();
    this.l2 = new L2EpisodicMemory(dataDir);
    this.l3 = new L3SemanticMemory(dataDir);
    console.log(`🧠 MemorySystem online — L2: ${this.l2.count()} episodes | L3: ${this.l3.count()} rules`);
  }

  // Wire background maintenance and inject the embedding function into L2
  // so pgvector similarity search activates as soon as the LLM service is ready.
  startMaintenance(llm: LLMService): void {
    this.l2.setEmbedFn(llm.embedText.bind(llm));
    this.maintenance = new MemoryMaintenance(this.l2, this.l3, llm, (event) => this.emit(event));
    this.maintenance.start();
  }

  stopMaintenance(): void {
    this.maintenance?.stop();
  }

  /** Drain write queues and close external connections before process exit. */
  async flush(): Promise<void> {
    await Promise.all([this.l2.flush(), this.l3.flush(), this.l1.disconnect()]);
  }

  onMemoryEvent(listener: (event: MemoryEvent) => void): void {
    this.eventListeners.push(listener);
  }

  private emit(event: MemoryEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  // RAG retrieval: L3 first (rules of thumb), then L2 (top 3 episodes)
  async query(queryText: string, topK = 3): Promise<MemoryQueryResult> {
    const l3Rules = this.l3.query(queryText, topK);
    const l2Episodes = await this.l2.search(queryText, topK);

    if (l3Rules.length > 0 || l2Episodes.length > 0) {
      this.emit({
        type: 'recalled',
        tier: l3Rules.length > 0 ? 'L3' : 'L2',
        memoryId: [...l3Rules.map((r) => r.id), ...l2Episodes.map((e) => e.id)].join(','),
        summary: `Retrieved ${l3Rules.length} rules + ${l2Episodes.length} episodes for: "${queryText.slice(0, 50)}"`,
        timestamp: Date.now(),
      });
    }

    return {
      l3Rules,
      l2Episodes,
      contextString: formatContext(l3Rules, l2Episodes),
    };
  }

  // Log a new episodic memory after an agent action
  async logEpisode(params: LogEpisodeParams): Promise<EpisodicMemory> {
    const memory = await this.l2.add(params);
    this.emit({
      type: 'created',
      tier: 'L2',
      memoryId: memory.id,
      summary: params.content.slice(0, 100),
      timestamp: Date.now(),
      domain: params.tags[0],
    });
    return memory;
  }

  recordDecision(tokenId: string, strategy: string): void {
    this.l1.addDecision(tokenId, strategy);
  }

  stats(): { l1: ReturnType<L1WorkingMemory['get']>; l2Count: number; l3Count: number } {
    return {
      l1: this.l1.get(),
      l2Count: this.l2.count(),
      l3Count: this.l3.count(),
    };
  }
}

function formatContext(rules: SemanticMemory[], episodes: EpisodicMemory[]): string {
  if (rules.length === 0 && episodes.length === 0) return '';

  const parts: string[] = [];

  if (rules.length > 0) {
    parts.push('RULES OF THUMB (distilled experience):');
    for (const r of rules) parts.push(`• ${r.rule}`);
  }

  if (episodes.length > 0) {
    parts.push('RELEVANT PAST DECISIONS:');
    for (const e of episodes) {
      const age = Math.floor((Date.now() - e.createdAt) / 86_400_000);
      parts.push(`• [${age}d ago] ${e.content}`);
    }
  }

  return parts.join('\n');
}

export { MemoryEvent, LogEpisodeParams };
