// MemoriVault Agent — autonomous treasury agent with hierarchical self-pruning memory

import { BlockchainService, ContractAddresses } from './blockchain.js';
import { LLMService } from './llm.js';
import { AgentWebSocket } from './websocket.js';
import { queryAPass, isConfigured as isCleanverseConfigured } from './cleanverse.js';
import {
  analyzeInvoice,
  applyMarketAdjustment,
  updateMarketRegime,
  applyRegimeAdjustment,
  getCurrentRegime,
  resetOptimizerState,
  recordDecision as optimizerRecordDecision,
  getLearningStats,
  getRegimeStats,
} from './optimizer.js';
import {
  AgentConfig,
  AgentThought,
  Strategy,
  AnalysisResult,
  MarketConditions,
  MarketAlert,
  InvoiceStatus,
} from './types.js';
import { STRATEGY_NAMES, AGENT_THRESHOLDS, ANALYSIS_INTERVAL_MS } from './constants.js';
import { MemorySystem } from './memory/index.js';

// Derive meaningful risk metrics from invoice timing when the contract still
// holds the default 50/50 mint values. updateRiskMetrics on InvoiceNFT is only
// callable by the AgentRouter contract or oracle — not the agent wallet — so we
// derive improved scores in-process so the optimizer has real data to work with.
function deriveRiskMetrics(daysUntilDue: number): { riskScore: number; paymentProbability: number } {
  if (daysUntilDue >= 90) return { riskScore: 82, paymentProbability: 88 };
  if (daysUntilDue >= 60) return { riskScore: 76, paymentProbability: 82 };
  if (daysUntilDue >= 30) return { riskScore: 70, paymentProbability: 76 };
  if (daysUntilDue >= 14) return { riskScore: 62, paymentProbability: 68 };
  if (daysUntilDue >= 0)  return { riskScore: 52, paymentProbability: 55 };
  return { riskScore: 30, paymentProbability: 25 }; // overdue
}

export class VinoAgent {
  private blockchain: BlockchainService;
  private llm: LLMService;
  private ws: AgentWebSocket;
  private config: AgentConfig;
  private memory: MemorySystem;
  private isRunning = false;
  private analysisLoop: NodeJS.Timeout | null = null;

  private lastAnalysisTime: Map<string, number> = new Map();
  // Tracks the last time executeDecision succeeded for each tokenId.
  // AgentRouter.decisionCooldown = 5 minutes — attempting recordDecision before
  // that elapses reverts with "Decision cooldown not elapsed".
  private lastExecutionTime: Map<string, number> = new Map();
  private readonly EXECUTION_COOLDOWN_MS = 5 * 60 * 1000 + 10_000; // 5 min + 10s buffer

  // Cooldown slightly shorter than the 30-second analysis interval so each
  // invoice is analyzed every cycle without risk of double-analysis from
  // concurrent WS triggers and scheduled cycles.
  private readonly ANALYSIS_COOLDOWN_MS = 25 * 1000;

  // Run outcome resolution every N cycles to avoid excess RPC calls
  private cycleCount = 0;
  private readonly OUTCOME_CHECK_EVERY_N_CYCLES = 5;

  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private circuitBreakerOpen = false;
  private circuitBreakerResetTime = 0;
  private readonly CIRCUIT_BREAKER_TIMEOUT_MS = 60 * 1000;

  constructor(
    rpcUrl: string,
    addresses: ContractAddresses,
    options: {
      privateKey?: string;
      qwenApiKey?: string;
      wsPort?: number;
      config?: Partial<AgentConfig>;
    } = {},
  ) {
    this.blockchain = new BlockchainService(rpcUrl, addresses, options.privateKey);
    this.llm = new LLMService(options.qwenApiKey);
    this.ws = new AgentWebSocket(options.wsPort || 8080);
    this.memory = new MemorySystem();

    this.config = {
      minConfidence: AGENT_THRESHOLDS.MIN_CONFIDENCE,
      analysisInterval: ANALYSIS_INTERVAL_MS,
      maxConcurrentAnalyses: 5,
      autoExecute: false, // caller must explicitly opt in; index.ts sets !!PRIVATE_KEY
      ...options.config,
    };

    this.ws.onAnalysisRequest = (tokenId) => {
      this.analyzeInvoice(tokenId).catch((e) =>
        console.error(`analyzeInvoice(${tokenId}) unhandled:`, e),
      );
    };

    // Relay memory events to connected WebSocket clients
    this.memory.onMemoryEvent((event) => {
      this.ws.broadcastMemoryEvent(event);
      const icon = { created: '🧠', recalled: '💭', pruned: '🗑️', condensed: '🧬' }[event.type];
      console.log(`${icon} [Memory:${event.tier}] ${event.summary}`);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('🤖 MemoriVault Agent starting...');

    this.ws.start();
    this.ws.setStatusCallback(() => ({
      running: this.isRunning,
      connectedClients: this.ws.getConnectedClients(),
    }));

    const agentAddress = this.blockchain.getAgentAddress();
    if (agentAddress) {
      const authorized = await this.blockchain.isAgentAuthorized(agentAddress);
      if (!authorized) {
        console.warn(`⚠️  Agent ${agentAddress} is not authorized on AgentRouter`);
      } else {
        console.log(`✅ Agent ${agentAddress} is authorized`);
        // Ensure AgentRouter.maxGasPrice is high enough for auto-execute to fire.
        // On Monad testnet the base fee can exceed the contract's default 100 Gwei
        // cap, causing recordDecision to silently skip the strategy change.
        await this.blockchain.ensureRouterConfig();
      }
    } else {
      console.warn('⚠️  No private key — read-only mode');
    }

    // Clear any stale module-level state from a previous run in this process
    // (hot-reload, test harness, or multiple VinoAgent instances).
    resetOptimizerState();

    // Start memory maintenance (decay, prune, condense) in the background
    this.memory.startMaintenance(this.llm);

    this.isRunning = true;
    this.setupEventListeners();

    this.broadcastThought({
      type: 'thinking',
      tokenId: 'system',
      message: '🏦 MemoriVault Agent is active — hierarchical memory online',
      timestamp: Date.now(),
      data: {
        memoryStats: this.memory.stats(),
      },
    });

    this.startAnalysisLoop();
    console.log('🤖 MemoriVault Agent started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    if (this.analysisLoop) {
      clearInterval(this.analysisLoop);
      this.analysisLoop = null;
    }
    this.memory.stopMaintenance();
    this.blockchain.destroy();
    this.ws.stop();
    this.isRunning = false;
    // Drain in-flight L2/L3 async writes before the process exits so no
    // memory state is lost on graceful shutdown (SIGTERM / SIGINT).
    await this.memory.flush();
    console.log('🤖 MemoriVault Agent stopped');
  }

  private setupEventListeners(): void {
    this.blockchain.onDecisionRecorded((tokenId, strategy, confidence) => {
      this.broadcastThought({
        type: 'execution',
        tokenId,
        message: `📡 On-chain: Decision recorded — ${STRATEGY_NAMES[strategy]} (${confidence}% confidence)`,
        timestamp: Date.now(),
        data: { strategy: STRATEGY_NAMES[strategy], confidence },
      });
    });

    this.blockchain.onDecisionExecuted((tokenId, strategy) => {
      this.broadcastThought({
        type: 'execution',
        tokenId,
        message: `📡 On-chain: Strategy changed to ${STRATEGY_NAMES[strategy]}`,
        timestamp: Date.now(),
        data: { strategy: STRATEGY_NAMES[strategy] },
      });
    });

    console.log('✅ Contract event listeners initialized');
  }

  private isRateLimited(tokenId: string): boolean {
    const last = this.lastAnalysisTime.get(tokenId);
    return last !== undefined && Date.now() - last < this.ANALYSIS_COOLDOWN_MS;
  }

  private checkCircuitBreaker(): boolean {
    if (!this.circuitBreakerOpen) return false;
    if (Date.now() > this.circuitBreakerResetTime) {
      this.circuitBreakerOpen = false;
      this.consecutiveFailures = 0;
      console.log('🔄 Circuit breaker reset');
      return false;
    }
    return true;
  }

  private tripCircuitBreaker(): void {
    this.circuitBreakerOpen = true;
    this.circuitBreakerResetTime = Date.now() + this.CIRCUIT_BREAKER_TIMEOUT_MS;
    console.warn(`⚠️ Circuit breaker tripped after ${this.consecutiveFailures} failures`);
  }

  private startAnalysisLoop(): void {
    this.runAnalysisCycle();
    this.analysisLoop = setInterval(() => this.runAnalysisCycle(), this.config.analysisInterval);
  }

  private currentMarketConditions: MarketConditions | null = null;
  private currentMarketAlert: MarketAlert | null = null;

  private async runAnalysisCycle(): Promise<void> {
    const CYCLE_TIMEOUT_MS = 60_000;
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Analysis cycle timeout')), CYCLE_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.runAnalysisCycleInternal(), timeoutPromise]);
      clearTimeout(timeoutHandle!);
    } catch (error) {
      clearTimeout(timeoutHandle!);
      if (error instanceof Error && error.message === 'Analysis cycle timeout') {
        console.error('⚠️ Cycle timed out');
        this.broadcastThought({
          type: 'error',
          tokenId: 'system',
          message: '⏱️ Analysis cycle timed out — retrying next interval',
          timestamp: Date.now(),
        });
        this.tripCircuitBreaker();
      } else {
        throw error;
      }
    }
  }

  private async runAnalysisCycleInternal(): Promise<void> {
    if (this.checkCircuitBreaker()) {
      console.log('⏸️ Circuit breaker open, skipping cycle');
      return;
    }

    try {
      this.broadcastThought({
        type: 'thinking',
        tokenId: 'system',
        message: '📡 Checking market conditions via Pyth Oracle...',
        timestamp: Date.now(),
      });

      this.currentMarketConditions = await this.blockchain.getMarketConditions();
      this.currentMarketAlert = this.blockchain.checkMarketAlert(this.currentMarketConditions);

      const regime = updateMarketRegime(this.currentMarketConditions);

      // Keep L1 working memory current
      this.memory.l1.setMarketRegime(regime);
      this.memory.l1.touchCycle();

      if (this.currentMarketAlert) {
        const alertEmoji =
          this.currentMarketAlert.level === 'critical'
            ? '🚨'
            : this.currentMarketAlert.level === 'warning'
              ? '⚠️'
              : 'ℹ️';

        this.broadcastThought({
          type: this.currentMarketAlert.level === 'critical' ? 'error' : 'analysis',
          tokenId: 'market',
          message: `${alertEmoji} ${this.currentMarketAlert.message}`,
          timestamp: Date.now(),
          data: {
            priceChange: this.currentMarketConditions.priceChange4h,
            volatility: this.currentMarketConditions.volatilityLevel,
            ethPrice: this.currentMarketConditions.ethPrice,
          },
        });

        await this.delay(800);

        this.broadcastThought({
          type: 'decision',
          tokenId: 'market',
          message: `🤖 ${this.currentMarketAlert.recommendation}`,
          timestamp: Date.now(),
        });

        // Log significant market events to episodic memory
        if (this.currentMarketAlert.level === 'critical') {
          await this.memory.logEpisode({
            content: `CRITICAL market alert: ${this.currentMarketAlert.message}. ETH price change: ${this.currentMarketConditions.priceChange4h.toFixed(1)}%. All strategies forced to Hold.`,
            tags: ['market-regime'],
            marketRegime: regime,
            metadata: {
              priceChange: this.currentMarketConditions.priceChange4h,
              volatility: this.currentMarketConditions.volatilityLevel,
            },
          });
        }
      } else {
        const priceInfo = this.currentMarketConditions.ethPrice
          ? `ETH: $${this.currentMarketConditions.ethPrice.toFixed(2)}`
          : 'Prices: Simulated mode';
        const regimeEmoji =
          regime === 'bull' ? '📈' : regime === 'bear' ? '📉' : regime === 'volatile' ? '🌊' : '⚖️';

        this.broadcastThought({
          type: 'thinking',
          tokenId: 'system',
          message: `✅ Market ${regime} ${regimeEmoji} (${priceInfo}) — volatility: ${this.currentMarketConditions.volatilityLevel}`,
          timestamp: Date.now(),
          data: { regime, volatility: this.currentMarketConditions.volatilityLevel },
        });
      }

      await this.delay(300);

      this.broadcastThought({
        type: 'thinking',
        tokenId: 'system',
        message: '🔍 Scanning blockchain for invoices...',
        timestamp: Date.now(),
      });

      const [invoicesResult, depositsResult] = await Promise.all([
        this.blockchain.getActiveInvoices(),
        this.blockchain.getActiveDeposits(),
      ]);

      if (invoicesResult.error || depositsResult.error) {
        const errors = [invoicesResult.error, depositsResult.error].filter(Boolean).join(', ');
        this.broadcastThought({
          type: 'error',
          tokenId: 'system',
          message: `⚠️ Contract call failed: ${errors}. Retrying next cycle.`,
          timestamp: Date.now(),
        });
        return;
      }

      const allTokenIds = [...new Set([...invoicesResult.ids, ...depositsResult.ids])];

      if (allTokenIds.length === 0) {
        this.broadcastThought({
          type: 'thinking',
          tokenId: 'system',
          message: '📭 No invoices found — waiting for new invoices to be minted...',
          timestamp: Date.now(),
        });
        return;
      }

      this.memory.l1.setActiveInvoices(allTokenIds);

      const depositCount = depositsResult.ids.length;
      const pendingCount = allTokenIds.length - depositCount;

      this.broadcastThought({
        type: 'thinking',
        tokenId: 'system',
        message: `📊 Found ${allTokenIds.length} invoice(s): ${depositCount} earning yield, ${pendingCount} pending. Analyzing...`,
        timestamp: Date.now(),
        data: { memoryStats: this.memory.stats() },
      });

      const analysisPromises = allTokenIds
        .slice(0, this.config.maxConcurrentAnalyses)
        .map((tokenId) => this.analyzeInvoice(tokenId));

      await Promise.allSettled(analysisPromises);

      const txCost = await this.blockchain.getEstimatedTxCost();

      this.broadcastThought({
        type: 'thinking',
        tokenId: 'system',
        message: `✅ Cycle complete. Next scan in ${this.config.analysisInterval / 1000}s | Tx: ${txCost.costUsd} | Memory: L2:${this.memory.stats().l2Count} L3:${this.memory.stats().l3Count}`,
        timestamp: Date.now(),
        data: { txCostUsd: txCost.costUsd, memoryStats: this.memory.stats() },
      });

      this.cycleCount++;
      if (this.cycleCount % this.OUTCOME_CHECK_EVERY_N_CYCLES === 0) {
        await this.updatePendingOutcomes();
      }

      this.consecutiveFailures = 0;
    } catch (error) {
      console.error('Error in analysis cycle:', error);
      // Truncate to the first line of the message only; ethers.js errors embed
      // contract addresses and ABI-decoded revert data that should not be sent
      // to WebSocket clients.
      const safeMsg = error instanceof Error
        ? error.message.split('\n')[0].slice(0, 120)
        : 'Unknown error';
      this.ws.broadcastError('system', `Analysis cycle error: ${safeMsg}`);
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.tripCircuitBreaker();
        this.broadcastThought({
          type: 'error',
          tokenId: 'system',
          message: `⚠️ Too many failures (${this.consecutiveFailures}). Pausing for 1 minute...`,
          timestamp: Date.now(),
        });
      }
    }
  }

  async analyzeInvoice(tokenId: string): Promise<AnalysisResult | null> {
    if (this.isRateLimited(tokenId)) {
      console.log(`⏳ Invoice #${tokenId} rate-limited`);
      return null;
    }

    // Reserve the slot immediately so concurrent WS + cycle calls don't both proceed
    this.lastAnalysisTime.set(tokenId, Date.now());

    try {
      const [invoice, deposit] = await Promise.all([
        this.blockchain.getInvoice(tokenId),
        this.blockchain.getDeposit(tokenId),
      ]);

      if (!invoice) {
        // Release the rate-limit slot so this token can be retried next cycle
        this.lastAnalysisTime.delete(tokenId);
        this.ws.broadcastError(tokenId, `Invoice #${tokenId} not found`);
        return null;
      }

      const isDeposited = deposit !== null;
      const regime = getCurrentRegime();

      // ── CVA gate: verify_apass before each strategy cycle (Cleanverse API) ──
      // Only check when Cleanverse is configured and the invoice is in vault —
      // uneposited invoices haven't yet reached the settlement layer.
      if (isDeposited && isCleanverseConfigured()) {
        try {
          const apass = await queryAPass(deposit!.owner);
          const cvaEligible = apass !== null && apass.status === 1;
          this.broadcastThought({
            type: 'thinking',
            tokenId,
            message: cvaEligible
              ? `✅ CVA gate: ${deposit!.owner.slice(0, 8)}… A-Pass active (Tier ${apass!.tier})`
              : `⚠️ CVA gate: ${deposit!.owner.slice(0, 8)}… A-Pass inactive or missing`,
            timestamp: Date.now(),
            data: { cvaEligible, tier: apass?.tier },
          });
          if (!cvaEligible) {
            // A-Pass not active — hold strategy for this deposit until eligibility is restored.
            this.broadcastThought({
              type: 'decision',
              tokenId,
              message: `🔒 CVA hold: depositor not eligible — forcing Hold strategy`,
              timestamp: Date.now(),
            });
            return null;
          }
        } catch (err) {
          // Cleanverse API unavailable — continue without blocking; log and proceed.
          console.warn(`[agent] CVA gate skipped for #${tokenId}:`, (err as Error).message);
        }
      }

      this.broadcastThought({
        type: 'thinking',
        tokenId,
        message: `🔍 Analyzing Invoice #${tokenId}${isDeposited ? ' (earning yield)' : ' (awaiting deposit)'}...`,
        timestamp: Date.now(),
        data: { step: 1, total: 5, isDeposited },
      });

      // ── RAG: retrieve relevant memories before reasoning ──────────────────
      const queryText = [
        `invoice ${tokenId}`,
        `risk score ${invoice.riskScore}`,
        `payment probability ${invoice.paymentProbability}`,
        `market ${regime}`,
        isDeposited ? `strategy ${STRATEGY_NAMES[deposit!.strategy]}` : 'undeposited',
      ].join(' ');

      const memoryResult = await this.memory.query(queryText, 3);

      if (memoryResult.l3Rules.length > 0 || memoryResult.l2Episodes.length > 0) {
        this.broadcastThought({
          type: 'thinking',
          tokenId,
          message: `🧠 Memory: recalled ${memoryResult.l3Rules.length} rules + ${memoryResult.l2Episodes.length} past episodes`,
          timestamp: Date.now(),
          data: {
            l3Rules: memoryResult.l3Rules.map((r) => r.rule),
            l2Count: memoryResult.l2Episodes.length,
          },
        });
      }

      await this.delay(200);

      const currentTimestamp = Math.floor(Date.now() / 1000);

      // ── Derive better risk metrics locally when contract still has defaults ─
      // updateRiskMetrics on InvoiceNFT is only callable by the AgentRouter
      // contract or oracle address, not the agent wallet directly. Instead we
      // derive improved scores in-process so the optimizer has meaningful data.
      if (invoice.riskScore === 50 && invoice.paymentProbability === 50) {
        const daysUntilDue = Math.floor((invoice.dueDate - currentTimestamp) / (24 * 60 * 60));
        const derived = deriveRiskMetrics(daysUntilDue);
        invoice.riskScore = derived.riskScore;
        invoice.paymentProbability = derived.paymentProbability;
      }

      let analysis = analyzeInvoice(invoice, deposit || undefined, currentTimestamp, this.config.minConfidence);
      const originalStrategy = analysis.recommendedStrategy;

      analysis = applyMarketAdjustment(analysis, this.currentMarketConditions, this.currentMarketAlert);
      analysis = applyRegimeAdjustment(analysis, this.config.minConfidence);
      const wasAdjusted = originalStrategy !== analysis.recommendedStrategy;

      await this.delay(400);
      this.broadcastThought({
        type: 'analysis',
        tokenId,
        message: `📈 Risk: ${analysis.riskScore}/100 | Payment: ${analysis.paymentProbability}% | Days to due: ${analysis.daysUntilDue}`,
        timestamp: Date.now(),
        data: {
          riskScore: analysis.riskScore,
          paymentProbability: analysis.paymentProbability,
          daysUntilDue: analysis.daysUntilDue,
        },
      });

      await this.delay(400);

      if (wasAdjusted && this.currentMarketAlert) {
        this.broadcastThought({
          type: 'analysis',
          tokenId,
          message: `⚡ MARKET OVERRIDE: ${STRATEGY_NAMES[analysis.currentStrategy]} → ${STRATEGY_NAMES[analysis.recommendedStrategy]} (was ${STRATEGY_NAMES[originalStrategy]})`,
          timestamp: Date.now(),
          data: {
            currentStrategy: STRATEGY_NAMES[analysis.currentStrategy],
            recommendedStrategy: STRATEGY_NAMES[analysis.recommendedStrategy],
            confidence: analysis.confidence,
            marketOverride: true,
          },
        });
      } else {
        this.broadcastThought({
          type: 'analysis',
          tokenId,
          message: `🎯 Strategy: ${STRATEGY_NAMES[analysis.currentStrategy]} → ${STRATEGY_NAMES[analysis.recommendedStrategy]} (${analysis.confidence}% confidence)`,
          timestamp: Date.now(),
          data: {
            currentStrategy: STRATEGY_NAMES[analysis.currentStrategy],
            recommendedStrategy: STRATEGY_NAMES[analysis.recommendedStrategy],
            confidence: analysis.confidence,
            shouldAct: analysis.shouldAct,
          },
        });
      }

      // ── LLM explanation with memory context ──────────────────────────────
      await this.delay(400);
      const explanation = await this.llm.generateExplanation(
        analysis,
        memoryResult.contextString || undefined,
      );

      this.broadcastThought({
        type: 'decision',
        tokenId,
        message: explanation,
        timestamp: Date.now(),
        data: {
          shouldAct: analysis.shouldAct,
          strategy: analysis.recommendedStrategy,
          memoryInfluenced: memoryResult.contextString.length > 0,
        },
      });

      if (analysis.shouldAct && this.config.autoExecute) {
        const lastExec = this.lastExecutionTime.get(tokenId);
        const execCooledDown = !lastExec || Date.now() - lastExec >= this.EXECUTION_COOLDOWN_MS;

        if (isDeposited && execCooledDown) {
          await this.executeDecision(tokenId, analysis, regime);
        } else if (isDeposited && !execCooledDown) {
          const remainingSec = Math.ceil((this.EXECUTION_COOLDOWN_MS - (Date.now() - lastExec!)) / 1000);
          this.broadcastThought({
            type: 'thinking',
            tokenId,
            message: `⏳ Invoice #${tokenId}: decision recorded — on-chain cooldown active (${remainingSec}s remaining)`,
            timestamp: Date.now(),
            data: { cooldownRemainingMs: this.EXECUTION_COOLDOWN_MS - (Date.now() - lastExec!) },
          });
        } else {
          this.broadcastThought({
            type: 'thinking',
            tokenId,
            message: `💡 Invoice #${tokenId} not yet deposited. Deposit it to activate ${STRATEGY_NAMES[analysis.recommendedStrategy]} strategy.`,
            timestamp: Date.now(),
            data: { recommendedStrategy: STRATEGY_NAMES[analysis.recommendedStrategy], awaitingDeposit: true },
          });
        }
      }

      return analysis;
    } catch (error) {
      // Release the rate-limit slot — a transient error shouldn't block this token for 5 min
      this.lastAnalysisTime.delete(tokenId);
      console.error(`Error analyzing invoice ${tokenId}:`, error);
      const safeMsg = error instanceof Error
        ? error.message.split('\n')[0].slice(0, 120)
        : 'Unknown error';
      this.ws.broadcastError(tokenId, `Analysis failed: ${safeMsg}`);
      return null;
    }
  }

  private async executeDecision(
    tokenId: string,
    analysis: AnalysisResult,
    marketRegime: string,
  ): Promise<void> {
    this.broadcastThought({
      type: 'execution',
      tokenId,
      message: `⚡ Executing: Change to ${STRATEGY_NAMES[analysis.recommendedStrategy]} strategy...`,
      timestamp: Date.now(),
    });

    const result = await this.blockchain.recordDecision(
      tokenId,
      analysis.recommendedStrategy,
      analysis.confidence,
      analysis.reasoning,
    );

    if (result.success) {
      // Record when this decision was executed so subsequent cycles don't try
      // to re-execute before the on-chain 5-minute cooldown has elapsed.
      this.lastExecutionTime.set(tokenId, Date.now());
      this.ws.broadcastExecution(tokenId, true, result.txHash);
      this.broadcastThought({
        type: 'execution',
        tokenId,
        message: `✅ Strategy updated to ${STRATEGY_NAMES[analysis.recommendedStrategy]}`,
        timestamp: Date.now(),
        data: { txHash: result.txHash },
      });

      // ── Log outcome to L2 episodic memory ──────────────────────────────
      await this.memory.logEpisode({
        content: [
          `Invoice #${tokenId}: Changed strategy from ${STRATEGY_NAMES[analysis.currentStrategy]}`,
          `to ${STRATEGY_NAMES[analysis.recommendedStrategy]}.`,
          `Market: ${marketRegime}. Risk score: ${analysis.riskScore}/100.`,
          `Payment probability: ${analysis.paymentProbability}%.`,
          `Days until due: ${analysis.daysUntilDue}. Confidence: ${analysis.confidence}%.`,
          result.txHash ? `Tx: ${result.txHash.slice(0, 10)}...` : '',
        ]
          .filter(Boolean)
          .join(' '),
        tags: ['yield-strategy', 'invoice-outcome'],
        tokenId,
        strategy: STRATEGY_NAMES[analysis.recommendedStrategy],
        outcome: 'pending',
        marketRegime,
        metadata: {
          fromStrategy: STRATEGY_NAMES[analysis.currentStrategy],
          toStrategy: STRATEGY_NAMES[analysis.recommendedStrategy],
          riskScore: analysis.riskScore,
          confidence: analysis.confidence,
          txHash: result.txHash,
        },
      });

      this.memory.recordDecision(tokenId, STRATEGY_NAMES[analysis.recommendedStrategy]);

      // Feed the outcome into the optimizer's in-process learning store so
      // pattern insights and decision history are populated for regime detection.
      optimizerRecordDecision(
        tokenId,
        analysis.recommendedStrategy,
        analysis.confidence,
        analysis.riskScore,
        analysis.daysUntilDue,
        this.currentMarketConditions?.volatilityLevel ?? 'low',
      );
    } else {
      this.ws.broadcastExecution(tokenId, false);
      this.broadcastThought({
        type: 'error',
        tokenId,
        message: '❌ Strategy update failed — will retry next cycle',
        timestamp: Date.now(),
      });
    }
  }

  private broadcastThought(thought: AgentThought): void {
    this.ws.broadcastThought(thought);
    const prefix = { thinking: '💭', analysis: '📊', decision: '🎯', execution: '⚡', error: '❌' }[
      thought.type
    ];
    console.log(`${prefix} [${thought.tokenId}] ${thought.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve L2 episodes whose outcome is still 'pending' by checking the
   * current on-chain invoice status. Runs every OUTCOME_CHECK_EVERY_N_CYCLES
   * cycles so each invoice is confirmed without hammering the RPC on every tick.
   *
   * Outcome rules:
   *   Paid / Defaulted / Cancelled → 'success' or 'suboptimal' based on strategy
   *   Overdue + the executed strategy was Aggressive → 'suboptimal'
   *   Otherwise → leave 'pending' until next check
   */
  private async updatePendingOutcomes(): Promise<void> {
    const pending = this.memory.l2.getPendingOutcomes(10);
    if (pending.length === 0) return;

    let resolved = 0;
    for (const episode of pending) {
      try {
        const invoice = await this.blockchain.getInvoice(episode.tokenId!);
        if (!invoice) continue;

        const now = Math.floor(Date.now() / 1000);
        const daysUntilDue = Math.floor((invoice.dueDate - now) / (24 * 60 * 60));
        const wasAggressive = episode.strategy === 'Aggressive';

        let outcome: 'success' | 'suboptimal' | null = null;

        if (invoice.status === InvoiceStatus.Paid) {
          outcome = 'success';
        } else if (invoice.status === InvoiceStatus.Defaulted) {
          outcome = 'suboptimal';
        } else if (invoice.status === InvoiceStatus.Cancelled) {
          // Cancelled before payment — strategy couldn't be proven correct
          outcome = 'suboptimal';
        } else if (daysUntilDue < -7 && wasAggressive) {
          // Over a week overdue with an aggressive strategy — likely a bad call
          outcome = 'suboptimal';
        }

        if (outcome) {
          this.memory.l2.updateOutcome(episode.id, outcome);
          resolved++;
          console.log(`🧠 [Memory:L2] Outcome resolved for invoice #${episode.tokenId}: ${outcome}`);
        }
      } catch {
        // Transient RPC error — leave as pending, retry next check
      }
    }

    if (resolved > 0) {
      this.broadcastThought({
        type: 'thinking',
        tokenId: 'system',
        message: `🧠 Resolved ${resolved} pending memory outcome(s) from on-chain invoice status`,
        timestamp: Date.now(),
        data: { resolved },
      });
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      connectedClients: this.ws.getConnectedClients(),
      config: this.config,
      memoryStats: this.memory.stats(),
      learning: getLearningStats(),
      regime: getRegimeStats(),
    };
  }
}
