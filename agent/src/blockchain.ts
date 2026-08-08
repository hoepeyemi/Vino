// Blockchain integration for reading/writing to contracts

import { ethers } from 'ethers';
import { Invoice, Deposit, Strategy, InvoiceStatus, MarketConditions, MarketAlert, AlertLevel } from './types.js';

// Retry configuration
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

// Helper for exponential backoff retry
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isRetryable = isRetryableError(error);

      if (attempt === config.maxAttempts || !isRetryable) {
        console.error(`${operationName} failed after ${attempt} attempts:`, error);
        throw error;
      }

      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt - 1),
        config.maxDelayMs
      );
      console.warn(`${operationName} attempt ${attempt} failed, retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  // Unreachable: the loop always returns or throws before completing.
  throw new Error(`${operationName}: exhausted ${config.maxAttempts} attempts`);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on network/RPC errors, not on contract reverts
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('rate limit') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504')
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Contract ABIs (minimal interfaces)
const INVOICE_NFT_ABI = [
  'function totalInvoices() view returns (uint256)',
  'function getActiveInvoices() view returns (uint256[])',
  'function getInvoice(uint256 tokenId) view returns (tuple(bytes32 dataCommitment, bytes32 amountCommitment, uint256 dueDate, uint256 createdAt, address issuer, uint8 status, uint8 riskScore, uint8 paymentProbability))',
  'function getDaysUntilDue(uint256 tokenId) view returns (int256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const YIELD_VAULT_ABI = [
  'function getActiveDeposits() view returns (uint256[])',
  'function getDeposit(uint256 tokenId) view returns (tuple(uint256 tokenId, address owner, uint8 strategy, uint256 depositTime, uint256 principal, uint256 accruedYield, uint256 lastYieldUpdate, bool active))',
  'function getAccruedYield(uint256 tokenId) view returns (uint256)',
];

const AGENT_ROUTER_ABI = [
  'function recordDecision(uint256 tokenId, uint8 strategy, uint256 confidence, string reasoning) returns (uint256)',
  'function getLatestDecision(uint256 tokenId) view returns (tuple(uint256 tokenId, uint8 recommendedStrategy, string reasoning, uint256 confidence, uint256 timestamp, bool executed))',
  'function isAgentAuthorized(address agent) view returns (bool)',
  'event DecisionRecorded(uint256 indexed tokenId, uint8 strategy, uint256 confidence, string reasoning)',
  'event DecisionExecuted(uint256 indexed tokenId, uint8 strategy, address indexed executor)',
];

const MOCK_ORACLE_ABI = [
  'function getRiskScore(uint256 tokenId) view returns (uint8)',
  'function getPaymentProbability(uint256 tokenId) view returns (uint8)',
  'function simulateRiskAssessment(uint256 tokenId)',
];

// Pyth Hermes HTTP API — real-time price feeds without requiring on-chain Pyth deployment.
// Works on any chain (including Monad Testnet where Pyth is not deployed).
const PYTH_HERMES_URL = 'https://hermes.pyth.network/v2/updates/price/latest';
const PYTH_ETH_USD_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

// Pyth Oracle ABI (for production)
const PYTH_ORACLE_ABI = [
  'function getRiskScore(uint256 tokenId) view returns (uint8)',
  'function getPaymentProbability(uint256 tokenId) view returns (uint8)',
  'function getRiskAssessment(uint256 tokenId) view returns (uint8 riskScore, uint8 paymentProbability, uint256 lastUpdated, int64 collateralPrice)',
  'function assessRisk(uint256 tokenId, uint256 dueDate, uint256 invoiceValue, uint256 collateralValue, bytes[] calldata priceUpdateData) payable',
  'function getEthUsdPrice() view returns (int64)',
  'function getNativeUsdPrice() view returns (int64)',
];

export interface ContractAddresses {
  invoiceNFT: string;
  yieldVault: string;
  agentRouter: string;
  // Oracle: use pythOracle in production, mockOracle for local dev
  mockOracle?: string;
  pythOracle?: string;
}

export class BlockchainService {
  private provider: ethers.Provider;
  private signer: ethers.Signer | null = null;

  private invoiceNFT: ethers.Contract;
  private yieldVault: ethers.Contract;
  private agentRouter: ethers.Contract;
  private mockOracle: ethers.Contract | null = null;
  private pythOracle: ethers.Contract | null = null;

  // Market monitoring
  private priceHistory: { timestamp: number; ethPrice: number; nativePrice: number; synthetic: boolean }[] = [];
  private lastMarketConditions: MarketConditions | null = null;
  private PRICE_HISTORY_DURATION = 4 * 60 * 60 * 1000; // 4 hours

  // Synthetic price for testnet: keeps market regime detection alive when Pyth
  // is unavailable. Uses a random walk (±0.4 % per 30 s cycle) so regime
  // transitions (bull / bear / volatile) still occur and are visible in the UI.
  // The real ethPrice field on MarketConditions stays null — the UI shows
  // "Simulated mode" while regime logic sees plausible movement.
  private syntheticBasePrice = 2500 + Math.random() * 500; // USD, randomised at startup

  constructor(rpcUrl: string, addresses: ContractAddresses, privateKey?: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    if (privateKey && ethers.isHexString(privateKey, 32)) {
      this.signer = new ethers.Wallet(privateKey, this.provider);
    } else if (privateKey) {
      console.warn('Ignoring AGENT_PRIVATE_KEY because it is not a valid 32-byte hex private key');
    }

    const signerOrProvider = this.signer || this.provider;

    this.invoiceNFT = new ethers.Contract(addresses.invoiceNFT, INVOICE_NFT_ABI, signerOrProvider);
    this.yieldVault = new ethers.Contract(addresses.yieldVault, YIELD_VAULT_ABI, signerOrProvider);
    this.agentRouter = new ethers.Contract(addresses.agentRouter, AGENT_ROUTER_ABI, signerOrProvider);

    // Oracle: prefer Pyth (production), fall back to MockOracle (local dev)
    if (addresses.pythOracle) {
      this.pythOracle = new ethers.Contract(addresses.pythOracle, PYTH_ORACLE_ABI, signerOrProvider);
      console.log('Using Pyth Oracle for real price data');
    } else if (addresses.mockOracle) {
      this.mockOracle = new ethers.Contract(addresses.mockOracle, MOCK_ORACLE_ABI, signerOrProvider);
      console.log('Using Mock Oracle (local dev)');
    }

  }

  async getActiveInvoices(): Promise<{ ids: string[]; error?: string }> {
    try {
      const ids: bigint[] = await this.invoiceNFT.getActiveInvoices();
      return { ids: ids.map((id) => id.toString()) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error fetching active invoices:', errorMsg);
      // Return error info so callers can distinguish between "no invoices" and "call failed"
      return { ids: [], error: errorMsg };
    }
  }

  async getInvoice(tokenId: string): Promise<Invoice | null> {
    try {
      const invoice = await this.invoiceNFT.getInvoice(tokenId);

      // A zero-value struct is returned by contracts that use storage defaults
      // for non-existent tokens (no revert). Treat it as "not found" to avoid
      // running a full analysis pass on garbage data.
      const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
      if (!Number(invoice.dueDate) && (!invoice.issuer || invoice.issuer === ZERO_ADDR)) {
        return null;
      }

      return {
        tokenId,
        dataCommitment: invoice.dataCommitment,
        amountCommitment: invoice.amountCommitment,
        dueDate: Number(invoice.dueDate),
        createdAt: Number(invoice.createdAt),
        issuer: invoice.issuer,
        status: Number(invoice.status) as InvoiceStatus,
        riskScore: Number(invoice.riskScore),
        paymentProbability: Number(invoice.paymentProbability),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('missing revert data') && !msg.includes('could not decode') && !msg.includes('CALL_EXCEPTION')) {
        console.warn(`[blockchain] getInvoice(${tokenId}) unexpected error: ${msg.split('\n')[0].slice(0, 120)}`);
      }
      return null;
    }
  }

  async getDeposit(tokenId: string): Promise<Deposit | null> {
    try {
      const deposit = await this.yieldVault.getDeposit(tokenId);

      if (!deposit.active) return null;

      return {
        tokenId: deposit.tokenId.toString(),
        owner: deposit.owner,
        strategy: Number(deposit.strategy) as Strategy,
        depositTime: Number(deposit.depositTime),
        principal: deposit.principal,
        accruedYield: deposit.accruedYield,
        lastYieldUpdate: Number(deposit.lastYieldUpdate),
        active: deposit.active,
      };
    } catch (error) {
      // Contract reverts with "missing revert data" when no deposit exists for this
      // tokenId — that's a normal state, not an error worth logging.
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('missing revert data') && !msg.includes('could not decode')) {
        console.warn(`[blockchain] getDeposit(${tokenId}) unexpected error: ${msg.split('\n')[0].slice(0, 120)}`);
      }
      return null;
    }
  }

  async getActiveDeposits(): Promise<{ ids: string[]; error?: string }> {
    try {
      const ids: bigint[] = await this.yieldVault.getActiveDeposits();
      return { ids: ids.map((id) => id.toString()) };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error fetching active deposits:', errorMsg);
      // Return error info so callers can distinguish between "no deposits" and "call failed"
      return { ids: [], error: errorMsg };
    }
  }

  async recordDecision(
    tokenId: string,
    strategy: Strategy,
    confidence: number,
    reasoning: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    if (!this.signer) {
      console.warn('No signer available for recording decision');
      return { success: false, error: 'No signer available' };
    }

    try {
      // Fetch live fee data and cap maxFeePerGas at 10 Gwei.
      // ethers.js auto-estimate can reach 200+ Gwei on Monad testnet, which
      // reserves 0.13+ MON per pending tx in the mempool — accumulated failed
      // retries quickly exhaust the wallet's effective balance even when the
      // on-chain balance is sufficient.
      const feeData = await this.provider.getFeeData();
      const MAX_FEE_GWEI = ethers.parseUnits('10', 'gwei');
      const rawMax = feeData.maxFeePerGas ?? feeData.gasPrice ?? MAX_FEE_GWEI;
      const maxFeePerGas = rawMax < MAX_FEE_GWEI ? rawMax : MAX_FEE_GWEI;
      const maxPriorityFeePerGas = ethers.parseUnits('1', 'gwei');

      // Only retry the transaction submission, never tx.wait().
      // If we wrapped send+wait together, a timeout between mempool submission
      // and receipt confirmation would re-submit a second transaction — the
      // contract is not idempotent so this would create a duplicate record.
      const tx = await withRetry(
        () => this.agentRouter.recordDecision(tokenId, strategy, confidence, reasoning, {
          maxFeePerGas,
          maxPriorityFeePerGas,
        }),
        `recordDecision-send(${tokenId})`,
        { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000 }
      );
      // Once we hold a tx object we have a hash — just wait for confirmation.
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error(`Transaction reverted (status=0): ${receipt.hash}`);
      }
      return { success: true, txHash: receipt.hash };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.split('\n')[0].slice(0, 160) : 'Unknown error';
      // "Decision cooldown not elapsed" is an expected contract guard — the agent
      // checks lastExecutionTime before calling, but race conditions can still
      // trigger it. Demote to warn so it doesn't spam the error log.
      if (errorMessage.includes('Decision cooldown not elapsed')) {
        console.warn(`[blockchain] recordDecision(${tokenId}): on-chain cooldown still active`);
      } else {
        console.error(`[blockchain] recordDecision(${tokenId}) failed: ${errorMessage}`);
      }
      return { success: false, error: errorMessage };
    }
  }

  async isAgentAuthorized(address: string): Promise<boolean> {
    try {
      return await this.agentRouter.isAgentAuthorized(address);
    } catch (error) {
      console.error('Error checking agent authorization:', error);
      return false;
    }
  }

  getAgentAddress(): string | null {
    if (!this.signer) return null;
    return (this.signer as ethers.Wallet).address;
  }

  destroy(): void {
    if (this.eventPollHandle) {
      clearInterval(this.eventPollHandle);
      this.eventPollHandle = null;
    }
  }

  // Subscribe to on-chain events via eth_getLogs polling instead of
  // eth_newFilter/eth_getFilterChanges. Many public RPCs (thirdweb, Alchemy
  // free tier) reject filter-based subscriptions with "filter not found" and
  // ethers v6's FilterId subscriber leaks console.log("@TODO", error) on every
  // failed poll. One shared setInterval calls getLogs for all registered events
  // in a single loop — no per-event timers, no duplicate block fetches.
  private eventPollHandle: ReturnType<typeof setInterval> | null = null;
  private lastEventBlock = 0;
  // topic0 → handler pairs registered before the loop starts
  private readonly eventHandlers: Array<{ topic0: string; handler: (log: ethers.Log) => void }> = [];

  onDecisionRecorded(callback: (tokenId: string, strategy: Strategy, confidence: number) => void): void {
    const topic0 = this.agentRouter.interface.getEvent('DecisionRecorded')!.topicHash;
    this.eventHandlers.push({
      topic0,
      handler: (log) => {
        const parsed = this.agentRouter.interface.parseLog(log);
        if (!parsed) return;
        callback(parsed.args[0].toString(), Number(parsed.args[1]) as Strategy, Number(parsed.args[2]));
      },
    });
    this._ensureEventLoop();
  }

  onDecisionExecuted(callback: (tokenId: string, strategy: Strategy) => void): void {
    const topic0 = this.agentRouter.interface.getEvent('DecisionExecuted')!.topicHash;
    this.eventHandlers.push({
      topic0,
      handler: (log) => {
        const parsed = this.agentRouter.interface.parseLog(log);
        if (!parsed) return;
        callback(parsed.args[0].toString(), Number(parsed.args[1]) as Strategy);
      },
    });
    this._ensureEventLoop();
  }

  private _ensureEventLoop(): void {
    if (this.eventPollHandle) return; // loop already running

    this.eventPollHandle = setInterval(async () => {
      if (this.eventHandlers.length === 0) return;
      try {
        const latestBlock = await this.provider.getBlockNumber();
        const fromBlock = this.lastEventBlock > 0 ? this.lastEventBlock + 1 : latestBlock;
        if (fromBlock > latestBlock) return;

        // Fetch logs for all registered topic0s in one getLogs call.
        // contract.target is the synchronous address string in ethers v6.
        const logs = await this.provider.getLogs({
          address: this.agentRouter.target as string,
          topics: [this.eventHandlers.map((e) => e.topic0)],
          fromBlock,
          toBlock: latestBlock,
        });

        this.lastEventBlock = latestBlock;

        for (const log of logs) {
          for (const { topic0, handler } of this.eventHandlers) {
            if (log.topics[0] === topic0) {
              try { handler(log); } catch { /* malformed log — skip */ }
            }
          }
        }
      } catch {
        // RPC hiccup — the 30s analysis loop is the authoritative signal
      }
    }, 60_000);
  }

  // Random-walk synthetic price used for regime tracking when all real price sources are unavailable.
  // ±0.4% per step biased slightly upward so regime transitions still occur in the UI.
  private getSyntheticTrackingPrice(): number {
    const drift = 0.0002; // +0.02% per step (gentle upward bias)
    const noise = (Math.random() - 0.5) * 0.008; // ±0.4%
    this.syntheticBasePrice = Math.max(500, this.syntheticBasePrice * (1 + drift + noise));
    return this.syntheticBasePrice;
  }

  // Fetch ETH/USD price from Pyth Hermes HTTP API (no on-chain Pyth deployment required).
  private async fetchHermesPrice(feedId: string): Promise<number | null> {
    try {
      const url = `${PYTH_HERMES_URL}?ids[]=${feedId}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return null;
      const data = await resp.json() as { parsed?: Array<{ price: { price: string; expo: number } }> };
      const feed = data.parsed?.[0];
      if (!feed) return null;
      return Number(feed.price.price) * Math.pow(10, feed.price.expo);
    } catch {
      return null;
    }
  }

  /// Get real price — tries on-chain Pyth oracle first, then Pyth Hermes HTTP API.
  async getRealPrice(feed: 'ETH' | 'NATIVE'): Promise<number | null> {
    // 1. On-chain Pyth oracle (production chains where Pyth is deployed)
    if (this.pythOracle) {
      try {
        const price = feed === 'ETH'
          ? await this.pythOracle.getEthUsdPrice()
          : await this.pythOracle.getNativeUsdPrice();
        return Number(price) / 1e8;
      } catch (error) {
        const msg = error instanceof Error ? error.message.split('\n')[0].slice(0, 120) : String(error);
        console.warn(`[oracle] ${feed} on-chain price unavailable, trying Hermes: ${msg}`);
      }
    }

    // 2. Pyth Hermes HTTP API (works on any chain including Monad Testnet)
    if (feed === 'ETH') {
      return this.fetchHermesPrice(PYTH_ETH_USD_FEED);
    }

    // No price source available for this feed
    return null;
  }

  /// Monitor market conditions and detect volatility
  async getMarketConditions(): Promise<MarketConditions> {
    const now = Date.now();

    const ethPrice = await this.getRealPrice('ETH');
    const nativePrice = await this.getRealPrice('NATIVE');

    // Always push a price to history so regime detection receives data every cycle.
    // When Pyth is unavailable (testnet) use a synthetic random-walk price that
    // keeps market regimes alive in the UI. The ethPrice field on the returned
    // conditions stays null — the UI correctly shows "Simulated mode".
    // Each entry is tagged synthetic/real so calculatePriceChange can skip
    // cross-type comparisons that would produce meaningless percentage swings
    // when Pyth first becomes available after a synthetic-only session.
    const usingReal = ethPrice !== null;
    const trackingPrice = usingReal ? ethPrice! : this.getSyntheticTrackingPrice();
    this.priceHistory.push({ timestamp: now, ethPrice: trackingPrice, nativePrice: nativePrice ?? 0, synthetic: !usingReal });
    this.priceHistory = this.priceHistory.filter((p) => now - p.timestamp < this.PRICE_HISTORY_DURATION);

    const priceChange = this.calculatePriceChange();
    const volatilityLevel = this.calculateVolatilityLevel(priceChange);

    this.lastMarketConditions = {
      ethPrice,
      nativePrice,
      priceChange4h: priceChange,
      volatilityLevel,
      lastUpdated: now,
    };

    return this.lastMarketConditions;
  }

  private calculatePriceChange(): number {
    if (this.priceHistory.length < 2) return 0;

    const recent = this.priceHistory[this.priceHistory.length - 1];
    const oldest = this.priceHistory[0];

    // Comparing a synthetic entry against a real one (or vice versa) would produce
    // a meaningless large percentage swing. Return 0 so no false market alert fires.
    if (recent.synthetic !== oldest.synthetic) return 0;
    if (oldest.ethPrice === 0) return 0;

    return ((recent.ethPrice - oldest.ethPrice) / oldest.ethPrice) * 100;
  }

  private calculateVolatilityLevel(priceChange: number): 'low' | 'medium' | 'high' | 'extreme' {
    const absChange = Math.abs(priceChange);
    if (absChange < 2) return 'low';
    if (absChange < 5) return 'medium';
    if (absChange < 10) return 'high';
    return 'extreme';
  }

  /// Check for market alerts that should trigger strategy changes
  checkMarketAlert(conditions: MarketConditions): MarketAlert | null {
    const priceChange = conditions.priceChange4h;
    const absChange = Math.abs(priceChange);

    if (absChange < 3) return null; // No significant movement

    if (priceChange <= -8) {
      return {
        level: 'critical',
        message: `CRITICAL: ETH crashed ${absChange.toFixed(1)}% in 4 hours`,
        priceChange,
        recommendation: 'Immediately move all positions to HOLD to protect capital',
      };
    }

    if (priceChange <= -5) {
      return {
        level: 'warning',
        message: `WARNING: ETH dropped ${absChange.toFixed(1)}% - market stress detected`,
        priceChange,
        recommendation: 'Move aggressive positions to Conservative to reduce exposure',
      };
    }

    if (priceChange <= -3) {
      return {
        level: 'info',
        message: `Market volatility: ETH down ${absChange.toFixed(1)}% - monitoring closely`,
        priceChange,
        recommendation: 'Consider reducing risk on high-value invoices',
      };
    }

    if (priceChange >= 5) {
      return {
        level: 'info',
        message: `Market rally: ETH up ${absChange.toFixed(1)}% - favorable conditions`,
        priceChange,
        recommendation: 'Conditions favorable for aggressive yield strategies',
      };
    }

    return null;
  }

  /// Get estimated transaction cost on the connected chain
  async getEstimatedTxCost(): Promise<{ costWei: bigint; costUsd: string }> {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 1000000000n; // 1 gwei default
      const estimatedGas = 150000n; // Typical gas for recordDecision

      const costWei = gasPrice * estimatedGas;

      // Convert to USD using ETH price or default
      const ethPrice = await this.getRealPrice('ETH');
      const costEth = Number(costWei) / 1e18;
      const costUsd = ethPrice ? (costEth * ethPrice).toFixed(4) : '~0.01';

      return {
        costWei,
        costUsd: `$${costUsd}`,
      };
    } catch {
      return {
        costWei: 150000000000000n, // ~0.00015 ETH
        costUsd: '$~0.01',
      };
    }
  }

}
