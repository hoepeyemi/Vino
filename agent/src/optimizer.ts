// Intelligent strategy optimizer with market awareness and learning
// Beyond simple rules - uses multi-factor scoring and pattern recognition

import { Strategy, Invoice, Deposit, AnalysisResult, MarketConditions, MarketAlert } from './types.js';
import { STRATEGY_NAMES, AGENT_THRESHOLDS, ANALYSIS_INTERVAL_MS } from './constants.js';

// Historical decision tracking for learning
interface DecisionRecord {
  tokenId: string;
  timestamp: number;
  strategy: Strategy;
  confidence: number;
  riskScore: number;
  daysUntilDue: number;
  marketVolatility: string;
  outcome?: 'success' | 'suboptimal'; // Track if decision was good
}

// Market regime detection
export type MarketRegime = 'bull' | 'bear' | 'volatile' | 'stable' | 'unknown';

interface MarketDataPoint {
  timestamp: number;
  ethPrice: number;
  priceChange4h: number;
  volatility: string;
}

// In-memory stores
const decisionHistory: DecisionRecord[] = [];
const patternInsights: Map<string, number> = new Map();
const marketHistory: MarketDataPoint[] = [];
let currentRegime: MarketRegime = 'unknown';
let lastRegimeUpdate: number = 0;

interface OptimizationContext {
  invoice: Invoice;
  deposit?: Deposit;
  currentTimestamp: number;
}

interface StrategyRecommendation {
  strategy: Strategy;
  confidence: number;
  reasoning: string;
  factors: string[];
}

export function optimizeStrategy(context: OptimizationContext): StrategyRecommendation {
  const { invoice, deposit, currentTimestamp } = context;

  const daysUntilDue = Math.floor((invoice.dueDate - currentTimestamp) / (24 * 60 * 60));
  const depositDuration = deposit
    ? (currentTimestamp - deposit.depositTime) / (24 * 60 * 60)
    : 0;

  // Hard rule: overdue invoices always go to Hold regardless of risk score or
  // payment history. No yield strategy is appropriate when the debtor is already
  // past their payment date — capital protection takes priority.
  if (daysUntilDue < 0) {
    const overdueFactors = [
      `Invoice OVERDUE by ${Math.abs(daysUntilDue)} days — elevated default risk`,
      'Capital protection required until payment or resolution',
    ];
    const overdueConfidence = Math.min(95, 70 + Math.floor(Math.abs(daysUntilDue) / 5));
    const overdueReasoning = generateReasoning('Hold', overdueFactors, overdueConfidence, daysUntilDue);
    return { strategy: Strategy.Hold, confidence: overdueConfidence, reasoning: overdueReasoning, factors: overdueFactors };
  }

  // Map the current market regime to a volatility level for composite scoring.
  // The market-adjustment pass (applyMarketAdjustment / applyRegimeAdjustment)
  // further overrides the recommendation after this function returns, so only
  // an approximate signal is needed here.
  const regimeVolatility: Record<MarketRegime, string> = {
    bull: 'low', stable: 'low', unknown: 'medium', bear: 'high', volatile: 'high',
  };
  const marketVolatility = regimeVolatility[getCurrentRegime()];

  // Primary scoring: weighted multi-factor composite model (0–1 normalised)
  const composite = calculateCompositeScore(
    invoice.riskScore,
    invoice.paymentProbability,
    daysUntilDue,
    marketVolatility,
    depositDuration,
  );

  // Pattern recognition provides qualitative context and confidence weighting
  const pattern = recognizePatterns(invoice.riskScore, daysUntilDue, marketVolatility);

  // Map composite score → strategy with calibrated confidence.
  // Thresholds ensure derived risk metrics for real invoices produce meaningful
  // changes while vanilla 50/50 defaults land in Conservative (not Hold).
  let strategy: Strategy;
  let baseConfidence: number;

  if (composite.score >= 0.65) {
    strategy = Strategy.Aggressive;
    // 60–95%: score of ~0.80 clears the +10 confidence bar for risky upgrades
    baseConfidence = Math.round(60 + ((composite.score - 0.65) / 0.35) * 35);
  } else if (composite.score >= 0.42) {
    strategy = Strategy.Conservative;
    // 55–90%: score of ~0.50 yields ~65%, enough to act on a Hold→Conservative move
    baseConfidence = Math.round(55 + ((composite.score - 0.42) / 0.23) * 35);
  } else {
    strategy = Strategy.Hold;
    // 50–90%: higher score within Hold band = more confident about protecting capital
    baseConfidence = Math.round(50 + ((0.42 - composite.score) / 0.42) * 40);
  }

  // Blend in pattern confidence to reward well-understood market scenarios
  const blendedConfidence = Math.round(baseConfidence * 0.85 + pattern.confidence * 0.15);
  const confidence = Math.min(95, Math.max(50, blendedConfidence));

  const factors: string[] = [...composite.insights];
  if (pattern.pattern !== 'Standard') {
    factors.push(`${pattern.pattern} pattern — ${pattern.recommendation}`);
  }
  if (deposit) {
    if (deposit.strategy === Strategy.Hold && composite.score > 0.55) {
      factors.push('Idle Hold position — fundamentals support yield activation');
    } else if (deposit.strategy === Strategy.Aggressive && composite.score < 0.35) {
      factors.push('Aggressive strategy misaligned with current fundamentals');
    }
    if (depositDuration > 7 && deposit.strategy === Strategy.Hold) {
      factors.push(`On Hold for ${Math.floor(depositDuration)}d — due for yield activation review`);
    }
  }

  const reasoning = generateReasoning(STRATEGY_NAMES[strategy], factors, confidence, daysUntilDue);
  return { strategy, confidence, reasoning, factors };
}

function generateReasoning(
  strategyName: string,
  factors: string[],
  confidence: number,
  daysUntilDue: number,
): string {
  const topFactors = factors.slice(0, 3).join('. ');

  if (strategyName === 'Aggressive') {
    return `Recommending AGGRESSIVE strategy with ${confidence}% confidence. ${topFactors}. ` +
      `With ${daysUntilDue} days until due and strong risk metrics, ` +
      `this invoice is well-suited for higher-yield opportunities (6-8% APY).`;
  } else if (strategyName === 'Conservative') {
    return `Recommending CONSERVATIVE strategy with ${confidence}% confidence. ${topFactors}. ` +
      `The moderate risk profile suggests a balanced approach with stable yields (3-4% APY) ` +
      `while maintaining capital protection.`;
  } else {
    return `Recommending HOLD strategy with ${confidence}% confidence. ${topFactors}. ` +
      `Current conditions do not favor active yield strategies. ` +
      `Will continue monitoring for improved conditions.`;
  }
}

// ============ Advanced Intelligence Features ============

// Multi-factor composite scoring with weighted factors
function calculateCompositeScore(
  riskScore: number,
  paymentProbability: number,
  daysUntilDue: number,
  marketVolatility: string,
  depositDuration: number
): { score: number; breakdown: Record<string, number>; insights: string[] } {
  const insights: string[] = [];
  const breakdown: Record<string, number> = {};

  // Factor weights (tuned based on importance)
  const weights = {
    risk: 0.25,
    payment: 0.25,
    time: 0.20,
    market: 0.20,
    momentum: 0.10,
  };

  // Risk score component (0-100 normalized to 0-1)
  breakdown.risk = riskScore / 100;
  if (riskScore >= 80) insights.push('Strong debtor reliability');
  else if (riskScore < 50) insights.push('Elevated counterparty risk detected');

  // Payment probability component
  breakdown.payment = paymentProbability / 100;
  if (paymentProbability >= 90) insights.push('Historical payment patterns excellent');
  else if (paymentProbability < 70) insights.push('Payment uncertainty warrants caution');

  // Time value component (more time = more opportunity)
  breakdown.time = Math.min(daysUntilDue / 90, 1); // Cap at 90 days
  if (daysUntilDue >= 60) insights.push('Long runway enables yield accumulation');
  else if (daysUntilDue < 14) insights.push('Limited time constrains strategy options');

  // Market conditions component
  const volatilityScores: Record<string, number> = {
    'low': 1.0,
    'medium': 0.7,
    'high': 0.4,
    'extreme': 0.1,
  };
  breakdown.market = volatilityScores[marketVolatility] ?? 0.5;
  if (marketVolatility === 'high' || marketVolatility === 'extreme') {
    insights.push('Market stress signals defensive positioning');
  }

  // Momentum component (how long deposited, indicating stability)
  breakdown.momentum = Math.min(depositDuration / 30, 1); // Cap at 30 days
  if (depositDuration > 14) insights.push('Established position enables strategy refinement');

  // Calculate weighted composite
  const score =
    breakdown.risk * weights.risk +
    breakdown.payment * weights.payment +
    breakdown.time * weights.time +
    breakdown.market * weights.market +
    breakdown.momentum * weights.momentum;

  return { score, breakdown, insights };
}

// Pattern recognition from historical decisions
function recognizePatterns(
  riskScore: number,
  daysUntilDue: number,
  marketVolatility: string
): { pattern: string; confidence: number; recommendation: string } {
  // Define pattern signatures
  const patterns = [
    {
      name: 'Safe Haven',
      match: (r: number, d: number, m: string) => r >= 80 && d >= 30 && (m === 'low' || m === 'medium'),
      confidence: 90,
      recommendation: 'Optimal conditions for aggressive yield strategy',
    },
    {
      name: 'Time Pressure',
      match: (r: number, d: number) => d < 14 && r >= 60,
      confidence: 85,
      recommendation: 'Short duration limits yield potential - prioritize liquidity',
    },
    {
      name: 'Risk-Reward Balance',
      match: (r: number, d: number, m: string) => r >= 60 && r < 80 && d >= 30 && m !== 'extreme',
      confidence: 75,
      recommendation: 'Moderate risk profile suits conservative yield strategy',
    },
    {
      name: 'Defensive Posture',
      match: (r: number, d: number, m: string) => r < 60 || m === 'extreme' || m === 'high',
      confidence: 88,
      recommendation: 'Elevated risk signals - protect capital over yield',
    },
    {
      name: 'Opportunity Window',
      match: (r: number, d: number, m: string) => r >= 70 && d >= 45 && m === 'low',
      confidence: 82,
      recommendation: 'Stable conditions + long duration = maximize yield exposure',
    },
  ];

  // Find matching pattern
  for (const pattern of patterns) {
    if (pattern.match(riskScore, daysUntilDue, marketVolatility)) {
      // Frequency bonus: patterns seen often in similar conditions get higher confidence.
      // patternInsights keys are "${strategy}-${riskBucket}-${volatility}" — we search
      // for any key matching the current risk bucket + volatility (strategy-agnostic)
      // so the bonus reflects how well this market situation is understood overall.
      const riskBucket = Math.floor(riskScore / 20) * 20;
      let frequencyBonus = 0;
      for (const [key, count] of patternInsights) {
        if (key.endsWith(`-${riskBucket}-${marketVolatility}`)) {
          // +2 per observed execution, capped at +15 so fresh data never dominates
          frequencyBonus = Math.min(count * 2, 15);
          break;
        }
      }
      return {
        pattern: pattern.name,
        confidence: Math.min(95, pattern.confidence + frequencyBonus),
        recommendation: pattern.recommendation,
      };
    }
  }

  return {
    pattern: 'Standard',
    confidence: 70,
    recommendation: 'Apply balanced risk-adjusted strategy',
  };
}

// Record decision for learning (in production, would persist)
export function recordDecision(
  tokenId: string,
  strategy: Strategy,
  confidence: number,
  riskScore: number,
  daysUntilDue: number,
  marketVolatility: string
): void {
  decisionHistory.push({
    tokenId,
    timestamp: Date.now(),
    strategy,
    confidence,
    riskScore,
    daysUntilDue,
    marketVolatility,
  });

  // Keep last 100 decisions
  if (decisionHistory.length > 100) {
    decisionHistory.shift();
  }

  // Update pattern insights
  const patternKey = `${strategy}-${Math.floor(riskScore / 20) * 20}-${marketVolatility}`;
  patternInsights.set(patternKey, (patternInsights.get(patternKey) || 0) + 1);
}

// Get learning statistics
export function getLearningStats(): {
  totalDecisions: number;
  strategyDistribution: Record<string, number>;
  topPatterns: Array<{ pattern: string; count: number }>;
} {
  const strategyDistribution: Record<string, number> = { Hold: 0, Conservative: 0, Aggressive: 0 };

  for (const decision of decisionHistory) {
    const strategyName = STRATEGY_NAMES[decision.strategy];
    strategyDistribution[strategyName]++;
  }

  const topPatterns = Array.from(patternInsights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern, count]) => ({ pattern, count }));

  return {
    totalDecisions: decisionHistory.length,
    strategyDistribution,
    topPatterns,
  };
}

export function shouldChangeStrategy(
  current: Strategy,
  recommended: Strategy,
  confidence: number,
  minConfidence: number = AGENT_THRESHOLDS.MIN_CONFIDENCE,
): boolean {
  // Don't change if same strategy
  if (current === recommended) return false;

  // Don't change if confidence is too low
  if (confidence < minConfidence) return false;

  // Always allow moving to a safer strategy (de-risking)
  if (recommended < current) return true;

  // Hold → Conservative: activating yield with capital protection is not a risk
  // upgrade — treat it like a de-risk move and require only minConfidence.
  if (current === Strategy.Hold && recommended === Strategy.Conservative) return true;

  // Any other upward move (Hold→Aggressive, Conservative→Aggressive) requires
  // higher confidence because we are exposing capital to greater risk.
  if (recommended > current && confidence >= minConfidence + AGENT_THRESHOLDS.RISKY_UPGRADE_DELTA) return true;

  return false;
}

export function analyzeInvoice(
  invoice: Invoice,
  deposit: Deposit | undefined,
  currentTimestamp: number,
  minConfidence: number = AGENT_THRESHOLDS.MIN_CONFIDENCE,
): AnalysisResult {
  const recommendation = optimizeStrategy({
    invoice,
    deposit,
    currentTimestamp,
  });

  const currentStrategy = deposit?.strategy ?? Strategy.Hold;
  const daysUntilDue = Math.floor((invoice.dueDate - currentTimestamp) / (24 * 60 * 60));

  const shouldAct = shouldChangeStrategy(
    currentStrategy,
    recommendation.strategy,
    recommendation.confidence,
    minConfidence,
  );

  return {
    tokenId: invoice.tokenId,
    invoice,
    deposit,
    riskScore: invoice.riskScore,
    paymentProbability: invoice.paymentProbability,
    daysUntilDue,
    currentStrategy,
    recommendedStrategy: recommendation.strategy,
    confidence: recommendation.confidence,
    reasoning: recommendation.reasoning,
    shouldAct,
  };
}

// Apply market conditions to override strategy recommendations
export function applyMarketAdjustment(
  analysis: AnalysisResult,
  marketConditions: MarketConditions | null,
  marketAlert: MarketAlert | null
): AnalysisResult {
  if (!marketAlert || !marketConditions) {
    return analysis;
  }

  const adjusted = { ...analysis };

  // Critical alert: unconditionally force Hold regardless of current or recommended
  // strategy. The previous guard (currentStrategy !== Hold) was wrong: if the
  // position is already Hold but the optimizer recommended Aggressive (shouldAct=true),
  // the guard would skip the override and let an Aggressive upgrade execute during
  // a market crash.
  if (marketAlert.level === 'critical') {
    adjusted.recommendedStrategy = Strategy.Hold;
    adjusted.confidence = 95;
    adjusted.shouldAct = analysis.currentStrategy !== Strategy.Hold; // act only if not already safe
    adjusted.reasoning = `MARKET OVERRIDE: ${marketAlert.message}. ` +
      `Forcing HOLD to protect capital. ` +
      `Original analysis suggested ${STRATEGY_NAMES[analysis.recommendedStrategy]} ` +
      `but market conditions require defensive positioning.`;
  }

  // Warning alert: Cap at Conservative
  else if (marketAlert.level === 'warning') {
    if (analysis.currentStrategy === Strategy.Aggressive) {
      adjusted.recommendedStrategy = Strategy.Conservative;
      adjusted.confidence = Math.max(analysis.confidence, 85);
      adjusted.shouldAct = true;
      adjusted.reasoning = `MARKET ADJUSTMENT: ${marketAlert.message}. ` +
        `Reducing from Aggressive to Conservative strategy. ` +
        `Market volatility (${marketConditions.volatilityLevel}) suggests reducing risk exposure.`;
    } else if (analysis.recommendedStrategy === Strategy.Aggressive) {
      adjusted.recommendedStrategy = Strategy.Conservative;
      // Recalculate shouldAct: the original analysis may have had insufficient
      // confidence for Aggressive (shouldAct=false), but after the cap the
      // Conservative recommendation is a distinct action that should be evaluated
      // on its own merits — act if current strategy differs from Conservative.
      adjusted.shouldAct = analysis.currentStrategy !== Strategy.Conservative;
      adjusted.reasoning = `MARKET CAUTION: Blocking upgrade to Aggressive due to market stress. ` +
        `${marketAlert.message}. Recommending Conservative instead.`;
    }
  }

  return adjusted;
}

// ============ Market Regime Detection ============

/**
 * Update market data and detect the current regime
 * Called on each market conditions update
 */
export function updateMarketRegime(marketConditions: MarketConditions): MarketRegime {
  const now = Date.now();

  // Record market data point
  marketHistory.push({
    timestamp: now,
    ethPrice: marketConditions.ethPrice ?? 0,
    priceChange4h: marketConditions.priceChange4h,
    volatility: marketConditions.volatilityLevel,
  });

  // Keep last 288 data points (~2.4 hours at ANALYSIS_INTERVAL_MS intervals)
  const maxPoints = Math.ceil(2.4 * 60 * 60 * 1000 / ANALYSIS_INTERVAL_MS);
  while (marketHistory.length > maxPoints) {
    marketHistory.shift();
  }

  // Only update regime every 5 minutes to avoid flip-flopping
  if (now - lastRegimeUpdate < 5 * 60 * 1000 && currentRegime !== 'unknown') {
    return currentRegime;
  }

  // Need at least 10 data points to detect regime
  if (marketHistory.length < 10) {
    return 'unknown';
  }

  currentRegime = detectRegime();
  lastRegimeUpdate = now;

  return currentRegime;
}

/**
 * Analyze market history to detect the current regime
 */
function detectRegime(): MarketRegime {
  const recentPoints = marketHistory.slice(-20); // Last ~10 minutes

  // Calculate average price change
  const avgPriceChange = recentPoints.reduce((sum, p) => sum + p.priceChange4h, 0) / recentPoints.length;

  // Count volatility levels
  const volatilityCounts = { low: 0, medium: 0, high: 0, extreme: 0 };
  recentPoints.forEach(p => {
    const level = p.volatility as keyof typeof volatilityCounts;
    if (level in volatilityCounts) {
      volatilityCounts[level]++;
    }
  });

  // Calculate price trend (simple moving average comparison)
  const firstHalf = recentPoints.slice(0, Math.floor(recentPoints.length / 2));
  const secondHalf = recentPoints.slice(Math.floor(recentPoints.length / 2));
  const firstAvg = firstHalf.reduce((sum, p) => sum + p.ethPrice, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, p) => sum + p.ethPrice, 0) / secondHalf.length;
  const trendPercent = firstAvg !== 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;

  // Determine regime based on signals
  const highVolatilityRatio = (volatilityCounts.high + volatilityCounts.extreme) / recentPoints.length;

  // Volatile regime: High volatility regardless of direction
  if (highVolatilityRatio > 0.5) {
    return 'volatile';
  }

  // Bull regime: Consistent positive trend with low-medium volatility
  if (avgPriceChange > 2 && trendPercent > 0.5 && highVolatilityRatio < 0.3) {
    return 'bull';
  }

  // Bear regime: Consistent negative trend
  if (avgPriceChange < -2 && trendPercent < -0.5) {
    return 'bear';
  }

  // Stable regime: Low volatility, minimal price change
  if (volatilityCounts.low > recentPoints.length * 0.6 && Math.abs(avgPriceChange) < 1) {
    return 'stable';
  }

  // Default to stable if no strong signals
  return 'stable';
}

/**
 * Get the current market regime
 */
export function getCurrentRegime(): MarketRegime {
  return currentRegime;
}

/**
 * Reset all module-level optimizer state.
 * Must be called on agent start so stale history from a previous run in the
 * same process (hot-reload, test harness, multi-instance) does not corrupt
 * regime detection or decision scoring for the new run.
 */
export function resetOptimizerState(): void {
  decisionHistory.length = 0;
  patternInsights.clear();
  marketHistory.length = 0;
  currentRegime = 'unknown';
  lastRegimeUpdate = 0;
}

/**
 * Get regime-adjusted strategy weights
 * Returns multipliers for aggressive strategies based on regime
 */
export function getRegimeAdjustment(): {
  regime: MarketRegime;
  aggressiveMultiplier: number;
  conservativeMultiplier: number;
  holdMultiplier: number;
  description: string;
} {
  switch (currentRegime) {
    case 'bull':
      return {
        regime: 'bull',
        aggressiveMultiplier: 1.2,  // Favor aggressive in bull markets
        conservativeMultiplier: 1.0,
        holdMultiplier: 0.8,
        description: 'Bull market detected - favoring yield optimization',
      };
    case 'bear':
      return {
        regime: 'bear',
        aggressiveMultiplier: 0.6,  // Reduce aggressive in bear markets
        conservativeMultiplier: 1.1,
        holdMultiplier: 1.3,
        description: 'Bear market detected - prioritizing capital preservation',
      };
    case 'volatile':
      return {
        regime: 'volatile',
        aggressiveMultiplier: 0.5,  // Avoid aggressive in volatile markets
        conservativeMultiplier: 0.9,
        holdMultiplier: 1.4,
        description: 'High volatility detected - reducing risk exposure',
      };
    case 'stable':
      return {
        regime: 'stable',
        aggressiveMultiplier: 1.1,  // Slight preference for yield in stable markets
        conservativeMultiplier: 1.0,
        holdMultiplier: 0.9,
        description: 'Stable market conditions - balanced approach',
      };
    default:
      return {
        regime: 'unknown',
        aggressiveMultiplier: 1.0,
        conservativeMultiplier: 1.0,
        holdMultiplier: 1.0,
        description: 'Insufficient data for regime detection',
      };
  }
}

/**
 * Apply regime-based adjustments to analysis result
 */
export function applyRegimeAdjustment(
  analysis: AnalysisResult,
  minConfidence: number = AGENT_THRESHOLDS.MIN_CONFIDENCE,
): AnalysisResult {
  const adjustment = getRegimeAdjustment();

  if (adjustment.regime === 'unknown') {
    return analysis;
  }

  const adjusted = { ...analysis };

  // In bear or volatile markets, prevent upgrades to aggressive
  if ((adjustment.regime === 'bear' || adjustment.regime === 'volatile') &&
      analysis.recommendedStrategy === Strategy.Aggressive &&
      analysis.currentStrategy !== Strategy.Aggressive) {
    adjusted.recommendedStrategy = Strategy.Conservative;
    adjusted.reasoning = `REGIME ADJUSTMENT (${adjustment.regime.toUpperCase()}): ` +
      `${adjustment.description}. Blocking upgrade to Aggressive strategy. ` +
      `Recommending Conservative instead to balance yield and risk.`;
    adjusted.shouldAct = shouldChangeStrategy(
      analysis.currentStrategy,
      Strategy.Conservative,
      analysis.confidence,
      minConfidence,
    );
  }

  // In bear markets, suggest moving from aggressive to conservative.
  // Block 2 condition (currentStrategy === Aggressive) is mutually exclusive with
  // Block 1 (currentStrategy !== Aggressive), so adjusted state from Block 1
  // is never overwritten here.
  if (adjustment.regime === 'bear' &&
      analysis.currentStrategy === Strategy.Aggressive) {
    adjusted.recommendedStrategy = Strategy.Conservative;
    adjusted.confidence = Math.max(analysis.confidence, AGENT_THRESHOLDS.HIGH_CONFIDENCE);
    adjusted.shouldAct = true;
    adjusted.reasoning = `REGIME ADJUSTMENT (BEAR MARKET): ` +
      `${adjustment.description}. Recommending de-risking from Aggressive to Conservative.`;
  }

  // In bull markets with high confidence, consider aggressive
  if (adjustment.regime === 'bull' &&
      analysis.recommendedStrategy === Strategy.Conservative &&
      analysis.confidence >= 75 &&
      analysis.currentStrategy !== Strategy.Aggressive) {
    // Only suggest, don't force
    adjusted.reasoning = `${analysis.reasoning} ` +
      `REGIME NOTE: Bull market conditions may support aggressive strategy for qualifying invoices.`;
  }

  return adjusted;
}

/**
 * Get market regime statistics for display
 */
export function getRegimeStats(): {
  currentRegime: MarketRegime;
  dataPoints: number;
  lastUpdate: number;
  adjustment: ReturnType<typeof getRegimeAdjustment>;
} {
  return {
    currentRegime,
    dataPoints: marketHistory.length,
    lastUpdate: lastRegimeUpdate,
    adjustment: getRegimeAdjustment(),
  };
}
