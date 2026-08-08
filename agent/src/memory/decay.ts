// Synaptic pruning: time-decay relevance scoring
// relevance = baseScore * e^(-λ * ageDays) + accessBonus
// λ = 0.05 → half-life ~14 days; frequent recall slows decay

const DECAY_LAMBDA = 0.05;
const MS_PER_DAY = 86_400_000;

export const PRUNE_THRESHOLD = 0.08; // below this the memory is deleted
export const CONDENSE_THRESHOLD = 5;  // min L2 memories per domain before condensation

// Compute relevance purely from creation time so repeated calls never compound.
// accessBonus slows decay for frequently-recalled memories (capped at 0.3).
export function decayedRelevance(createdAt: number, accessCount: number): number {
  const ageDays = (Date.now() - createdAt) / MS_PER_DAY;
  const accessBonus = Math.min(accessCount * 0.04, 0.3);
  const decayed = Math.exp(-DECAY_LAMBDA * ageDays) + accessBonus;
  return Math.max(0, Math.min(1, decayed));
}

export function shouldPrune(relevanceScore: number): boolean {
  return relevanceScore < PRUNE_THRESHOLD;
}

// Initial relevance for a fresh memory (high by default)
export function initialRelevance(): number {
  return 1.0;
}
