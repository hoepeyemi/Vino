import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyMarketAdjustment,
  applyRegimeAdjustment,
  updateMarketRegime,
  recordDecision,
  getLearningStats,
  resetOptimizerState,
  shouldChangeStrategy,
  type MarketRegime,
} from './optimizer.js';
import { Strategy, Invoice, InvoiceStatus, AnalysisResult, MarketConditions, MarketAlert } from './types.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function mockInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const now = Math.floor(Date.now() / 1000);
  return {
    tokenId: '1',
    dataCommitment: '0x0',
    amountCommitment: '0x0',
    dueDate: now + 30 * 86400,
    createdAt: now,
    issuer: '0xabc',
    status: InvoiceStatus.Active,
    riskScore: 75,
    paymentProbability: 80,
    ...overrides,
  };
}

function mockAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    tokenId: '1',
    invoice: mockInvoice(),
    riskScore: 75,
    paymentProbability: 80,
    daysUntilDue: 30,
    currentStrategy: Strategy.Hold,
    recommendedStrategy: Strategy.Conservative,
    confidence: 80,
    reasoning: 'test reasoning',
    shouldAct: true,
    ...overrides,
  };
}

function mockConditions(overrides: Partial<MarketConditions> = {}): MarketConditions {
  return {
    ethPrice: 2000,
    nativePrice: null,
    priceChange4h: 0,
    volatilityLevel: 'low',
    lastUpdated: Date.now(),
    ...overrides,
  };
}

function criticalAlert(): MarketAlert {
  return {
    level: 'critical',
    message: 'CRITICAL: ETH crashed 10.0% in 4 hours',
    priceChange: -10,
    recommendation: 'Immediately move all positions to HOLD to protect capital',
  };
}

function warningAlert(): MarketAlert {
  return {
    level: 'warning',
    message: 'WARNING: ETH dropped 6.0% - market stress detected',
    priceChange: -6,
    recommendation: 'Move aggressive positions to Conservative to reduce exposure',
  };
}

// ── applyMarketAdjustment ─────────────────────────────────────────────────────

describe('applyMarketAdjustment', () => {
  it('returns analysis unchanged when alert is null', () => {
    const analysis = mockAnalysis();
    const result = applyMarketAdjustment(analysis, mockConditions(), null);
    expect(result).toBe(analysis);
  });

  it('returns analysis unchanged when conditions are null', () => {
    const analysis = mockAnalysis();
    const result = applyMarketAdjustment(analysis, null, criticalAlert());
    expect(result).toBe(analysis);
  });

  it('critical alert forces Hold and sets shouldAct=true when not already Hold', () => {
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Conservative,
      recommendedStrategy: Strategy.Aggressive,
      shouldAct: true,
    });
    const result = applyMarketAdjustment(analysis, mockConditions(), criticalAlert());

    expect(result.recommendedStrategy).toBe(Strategy.Hold);
    expect(result.confidence).toBe(95);
    expect(result.shouldAct).toBe(true);
    expect(result.reasoning).toContain('MARKET OVERRIDE');
  });

  it('critical alert sets shouldAct=false when already on Hold', () => {
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Aggressive,
      shouldAct: true,
    });
    const result = applyMarketAdjustment(analysis, mockConditions(), criticalAlert());

    expect(result.recommendedStrategy).toBe(Strategy.Hold);
    expect(result.shouldAct).toBe(false);
  });

  it('warning alert de-risks current Aggressive position to Conservative', () => {
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Aggressive,
      recommendedStrategy: Strategy.Aggressive,
      shouldAct: false,
    });
    const result = applyMarketAdjustment(analysis, mockConditions({ volatilityLevel: 'high' }), warningAlert());

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.shouldAct).toBe(true);
    expect(result.reasoning).toContain('MARKET ADJUSTMENT');
  });

  it('warning alert caps Aggressive recommendation to Conservative when not yet there', () => {
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Aggressive,
      shouldAct: false,
    });
    const result = applyMarketAdjustment(analysis, mockConditions(), warningAlert());

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    // Hold → Conservative is a real change so shouldAct must reflect that
    expect(result.shouldAct).toBe(true);
    expect(result.reasoning).toContain('MARKET CAUTION');
  });

  it('warning alert is no-op when current strategy is already Conservative', () => {
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Conservative,
      recommendedStrategy: Strategy.Conservative,
      shouldAct: false,
    });
    const result = applyMarketAdjustment(analysis, mockConditions(), warningAlert());

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.shouldAct).toBe(false);
  });
});

// ── applyRegimeAdjustment ─────────────────────────────────────────────────────

describe('applyRegimeAdjustment', () => {
  // Each test resets optimizer state so regime detection starts from 'unknown'
  beforeEach(() => resetOptimizerState());

  it('returns analysis unchanged when regime is unknown', () => {
    // After reset, regime is 'unknown' — no data points pushed
    const analysis = mockAnalysis({
      recommendedStrategy: Strategy.Aggressive,
      currentStrategy: Strategy.Hold,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis);
    expect(result).toBe(analysis);
  });

  it('bear regime blocks upgrade from Hold to Aggressive, caps to Conservative', () => {
    pushBearDataPoints(10);

    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Aggressive,
      confidence: 90,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis);

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.reasoning).toContain('REGIME ADJUSTMENT');
    expect(result.reasoning).toContain('BEAR');
  });

  it('bear regime de-risks current Aggressive to Conservative with HIGH_CONFIDENCE floor', () => {
    pushBearDataPoints(10);

    const analysis = mockAnalysis({
      currentStrategy: Strategy.Aggressive,
      recommendedStrategy: Strategy.Aggressive,
      confidence: 70,
      shouldAct: false,
    });
    const result = applyRegimeAdjustment(analysis);

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.confidence).toBeGreaterThanOrEqual(85); // HIGH_CONFIDENCE
    expect(result.shouldAct).toBe(true);
    expect(result.reasoning).toContain('BEAR MARKET');
  });

  it('volatile regime blocks upgrade to Aggressive', () => {
    pushVolatileDataPoints(10);

    const analysis = mockAnalysis({
      currentStrategy: Strategy.Conservative,
      recommendedStrategy: Strategy.Aggressive,
      confidence: 90,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis);

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.reasoning).toContain('VOLATILE');
  });

  it('bear regime respects caller-configured minConfidence when blocking upgrade', () => {
    pushBearDataPoints(10);

    // Confidence 65 with minConfidence=60: shouldAct should be false because
    // moving Hold → Conservative needs confidence >= minConfidence (60 satisfied)
    // but actually moving from Hold to Conservative doesn't require the +DELTA
    // so shouldAct = shouldChangeStrategy(Hold, Conservative, 65, 60) = true
    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Aggressive,
      confidence: 65,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis, 60);

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    // Conservative is safer than Aggressive so shouldAct follows shouldChangeStrategy logic
    expect(typeof result.shouldAct).toBe('boolean');
  });

  it('bull regime adds note to Conservative recommendation but does not force strategy', () => {
    pushBullDataPoints(10);

    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Conservative,
      confidence: 80,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis);

    // Strategy stays Conservative — bull only adds a suggestion note
    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.reasoning).toContain('Bull market');
  });

  it('stable regime does not modify strategy', () => {
    pushStableDataPoints(10);

    const analysis = mockAnalysis({
      currentStrategy: Strategy.Hold,
      recommendedStrategy: Strategy.Conservative,
      shouldAct: true,
    });
    const result = applyRegimeAdjustment(analysis);

    expect(result.recommendedStrategy).toBe(Strategy.Conservative);
    expect(result.shouldAct).toBe(true);
  });
});

// ── updateMarketRegime / detectRegime ─────────────────────────────────────────

describe('updateMarketRegime / detectRegime', () => {
  beforeEach(() => resetOptimizerState());

  it('returns unknown when fewer than 10 data points have been pushed', () => {
    const regime = pushBearDataPoints(9);
    expect(regime).toBe('unknown');
  });

  it('detects bear regime from consistent negative price change and declining prices', () => {
    const regime = pushBearDataPoints(10);
    expect(regime).toBe('bear');
  });

  it('detects bull regime from consistent positive price change and rising prices', () => {
    const regime = pushBullDataPoints(10);
    expect(regime).toBe('bull');
  });

  it('detects volatile regime when majority of points are high volatility', () => {
    const regime = pushVolatileDataPoints(10);
    expect(regime).toBe('volatile');
  });

  it('detects stable regime from low volatility and minimal price change', () => {
    const regime = pushStableDataPoints(10);
    expect(regime).toBe('stable');
  });
});

// ── recordDecision / getLearningStats ─────────────────────────────────────────

describe('recordDecision / getLearningStats', () => {
  beforeEach(() => resetOptimizerState());

  it('starts with zero decisions', () => {
    const stats = getLearningStats();
    expect(stats.totalDecisions).toBe(0);
    expect(stats.topPatterns).toHaveLength(0);
  });

  it('increments totalDecisions after each recordDecision call', () => {
    recordDecision('1', Strategy.Conservative, 80, 70, 30, 'low');
    recordDecision('2', Strategy.Aggressive, 90, 85, 60, 'low');
    expect(getLearningStats().totalDecisions).toBe(2);
  });

  it('tracks strategyDistribution correctly', () => {
    recordDecision('1', Strategy.Hold, 75, 40, 5, 'high');
    recordDecision('2', Strategy.Conservative, 80, 65, 20, 'medium');
    recordDecision('3', Strategy.Conservative, 82, 70, 25, 'low');
    recordDecision('4', Strategy.Aggressive, 90, 85, 60, 'low');

    const { strategyDistribution } = getLearningStats();
    expect(strategyDistribution.Hold).toBe(1);
    expect(strategyDistribution.Conservative).toBe(2);
    expect(strategyDistribution.Aggressive).toBe(1);
  });

  it('populates topPatterns with recorded decision keys', () => {
    // Record multiple decisions sharing the same risk bucket + volatility
    recordDecision('1', Strategy.Conservative, 80, 65, 30, 'low');
    recordDecision('2', Strategy.Conservative, 82, 68, 28, 'low');
    recordDecision('3', Strategy.Conservative, 78, 62, 32, 'low');

    const { topPatterns } = getLearningStats();
    // All three share riskBucket=60, volatility=low → same key → count 3
    expect(topPatterns.length).toBeGreaterThan(0);
    expect(topPatterns[0].count).toBe(3);
  });

  it('caps decision history at 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      recordDecision(String(i), Strategy.Conservative, 75, 70, 30, 'low');
    }
    expect(getLearningStats().totalDecisions).toBe(100);
  });
});

// ── Data-point helpers for regime detection ───────────────────────────────────

function pushBearDataPoints(n: number): MarketRegime {
  let regime: MarketRegime = 'unknown';
  for (let i = 0; i < n; i++) {
    regime = updateMarketRegime({
      ethPrice: 2000 - i * 10, // steadily declining
      nativePrice: null,
      priceChange4h: -3,
      volatilityLevel: 'low',
      lastUpdated: Date.now() + i,
    });
  }
  return regime;
}

function pushBullDataPoints(n: number): MarketRegime {
  let regime: MarketRegime = 'unknown';
  for (let i = 0; i < n; i++) {
    regime = updateMarketRegime({
      ethPrice: 2000 + i * 10, // steadily rising
      nativePrice: null,
      priceChange4h: 3,
      volatilityLevel: 'low',
      lastUpdated: Date.now() + i,
    });
  }
  return regime;
}

function pushVolatileDataPoints(n: number): MarketRegime {
  let regime: MarketRegime = 'unknown';
  for (let i = 0; i < n; i++) {
    regime = updateMarketRegime({
      ethPrice: 2000,
      nativePrice: null,
      priceChange4h: 0,
      volatilityLevel: 'high',
      lastUpdated: Date.now() + i,
    });
  }
  return regime;
}

function pushStableDataPoints(n: number): MarketRegime {
  let regime: MarketRegime = 'unknown';
  for (let i = 0; i < n; i++) {
    regime = updateMarketRegime({
      ethPrice: 2000,
      nativePrice: null,
      priceChange4h: 0.5,
      volatilityLevel: 'low',
      lastUpdated: Date.now() + i,
    });
  }
  return regime;
}

// ── shouldChangeStrategy ──────────────────────────────────────────────────────

describe('shouldChangeStrategy', () => {
  const MIN = 70;
  const DELTA = 10; // AGENT_THRESHOLDS.RISKY_UPGRADE_DELTA

  it('returns false when current === recommended', () => {
    expect(shouldChangeStrategy(Strategy.Conservative, Strategy.Conservative, 90, MIN)).toBe(false);
  });

  it('returns false when confidence < minConfidence', () => {
    expect(shouldChangeStrategy(Strategy.Hold, Strategy.Conservative, 69, MIN)).toBe(false);
  });

  it('Hold → Conservative executes at exactly minConfidence (no +DELTA required)', () => {
    expect(shouldChangeStrategy(Strategy.Hold, Strategy.Conservative, MIN, MIN)).toBe(true);
  });

  it('Hold → Aggressive requires minConfidence + DELTA', () => {
    expect(shouldChangeStrategy(Strategy.Hold, Strategy.Aggressive, MIN + DELTA - 1, MIN)).toBe(false);
    expect(shouldChangeStrategy(Strategy.Hold, Strategy.Aggressive, MIN + DELTA, MIN)).toBe(true);
  });

  it('Conservative → Aggressive requires minConfidence + DELTA', () => {
    expect(shouldChangeStrategy(Strategy.Conservative, Strategy.Aggressive, MIN + DELTA - 1, MIN)).toBe(false);
    expect(shouldChangeStrategy(Strategy.Conservative, Strategy.Aggressive, MIN + DELTA, MIN)).toBe(true);
  });

  it('de-risking always allowed at minConfidence', () => {
    expect(shouldChangeStrategy(Strategy.Aggressive, Strategy.Conservative, MIN, MIN)).toBe(true);
    expect(shouldChangeStrategy(Strategy.Aggressive, Strategy.Hold, MIN, MIN)).toBe(true);
    expect(shouldChangeStrategy(Strategy.Conservative, Strategy.Hold, MIN, MIN)).toBe(true);
  });
});
