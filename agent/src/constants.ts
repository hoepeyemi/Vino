// Centralized constants for vino Agent

/**
 * Human-readable strategy names indexed by Strategy enum value.
 * Must stay in sync with the Strategy enum order: Hold=0, Conservative=1, Aggressive=2.
 */
export const STRATEGY_NAMES = ['Hold', 'Conservative', 'Aggressive'] as const;

/**
 * Agent decision thresholds — single source of truth for confidence values
 * used across agent.ts, index.ts, and optimizer.ts.
 */
export const AGENT_THRESHOLDS = {
  MIN_CONFIDENCE: 70,      // minimum confidence to act on any recommendation
  HIGH_CONFIDENCE: 85,     // floor confidence when regime forces a de-risk move
  RISKY_UPGRADE_DELTA: 10, // extra confidence required to move to a riskier strategy
} as const;

/** Milliseconds between analysis cycles — single source of truth for both
 *  agent.ts default config and index.ts launch config. */
export const ANALYSIS_INTERVAL_MS = 30_000;
