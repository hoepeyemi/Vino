// MemoriVault - Memory system types

export type MemoryTier = 'L1' | 'L2' | 'L3';

export type MemoryTag =
  | 'yield-strategy'
  | 'user-preference'
  | 'market-regime'
  | 'invoice-outcome'
  | 'rule-of-thumb'
  | 'gas-optimization';

export interface EpisodicMemory {
  id: string;
  content: string;
  tags: MemoryTag[];
  tokenId?: string;
  strategy?: string;
  outcome?: 'success' | 'suboptimal' | 'pending';
  marketRegime?: string;
  relevanceScore: number; // 0-1, decays over time
  createdAt: number; // ms
  lastAccessedAt: number;
  accessCount: number;
  metadata: Record<string, unknown>;
}

export interface SemanticMemory {
  id: string;
  rule: string; // Distilled "rule of thumb" sentence
  evidence: string[]; // L2 memory IDs that were condensed into this rule
  confidence: number; // 0-100
  domain: 'yield' | 'risk' | 'market' | 'user' | 'gas';
  keywords: string[];
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkingMemoryState {
  sessionId: string;
  activeInvoices: string[];
  currentMarketRegime: string;
  recentDecisions: Array<{ tokenId: string; strategy: string; timestamp: number }>;
  lastCycleAt: number;
}

export interface MemoryQueryResult {
  l3Rules: SemanticMemory[];
  l2Episodes: EpisodicMemory[];
  contextString: string;
}

export interface MemoryEvent {
  type: 'created' | 'recalled' | 'pruned' | 'condensed';
  tier: MemoryTier;
  memoryId: string;
  summary: string;
  timestamp: number;
  reason?: string;
  /** Domain tag for graph placement */
  domain?: string;
  /** L2 IDs consumed by this condensation */
  sourceIds?: string[];
}

export interface LogEpisodeParams {
  content: string;
  tags: MemoryTag[];
  tokenId?: string;
  strategy?: string;
  outcome?: 'success' | 'suboptimal' | 'pending';
  marketRegime?: string;
  metadata?: Record<string, unknown>;
}
