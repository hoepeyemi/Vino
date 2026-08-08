# vino — Technical Documentation

> Turn Invoices into Yield. Automatically.

**Version**: 1.1.0
**Network**: Monad Testnet (chainId: 10143)
**Last Updated**: July 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Smart Contracts](#3-smart-contracts)
4. [Agent Service](#4-agent-service)
5. [Frontend Application](#5-frontend-application)
6. [Privacy Layer](#6-privacy-layer)
7. [API Reference](#7-api-reference)
8. [Deployment](#8-deployment)
9. [Configuration](#9-configuration)
10. [Testing](#10-testing)
11. [Security Considerations](#11-security-considerations)
12. [Known Issues & Lessons Learned](#12-known-issues--lessons-learned)
13. [Future Roadmap](#13-future-roadmap)

---

## 1. Executive Summary

### 1.1 Problem Statement

Small businesses and freelancers face a $3T+ global cash flow problem: invoices typically have 30–90 day payment terms, locking capital while waiting for payment. Traditional invoice factoring is expensive (2–5% fees), bureaucratic, and exposes sensitive business data.

### 1.2 Solution

vino tokenizes invoices as Real-World Assets (RWAs) on Monad Testnet, then deploys an autonomous AI agent to:

- **Optimize yield** on tokenized invoices (3–8% APY)
- **Protect privacy** using cryptographic commitments
- **Automate management** with continuous AI-driven strategy optimization
- **Reduce costs** by leveraging Monad's low gas fees

### 1.3 Key Innovation

The "Living Agent" architecture streams AI reasoning in real-time via WebSocket, allowing users to observe the agent's decision-making process as it analyzes invoices and executes yield strategies.

### 1.4 Track Alignment

| Track | Implementation |
|---|---|
| **RWA/RealFi** | Invoice NFTs as yield-generating real-world assets |
| **AI & Oracles** | Autonomous agent with oracle-fed risk assessment |
| **ZK & Privacy** | Hash commitments + Merkle proofs (ZK-ready architecture) |

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                           │
│                        (Next.js Frontend)                       │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │
│  │  Invoice  │  │ Portfolio │  │   Stats   │  │Agent Activity│  │
│  │   Form    │  │ Dashboard │  │  Display  │  │ (Live Stream)│  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘  │
└────────┼──────────────┼──────────────┼────────────────┼─────────┘
         │ wagmi/viem   │              │                │ WebSocket
         ▼              ▼              ▼                │
┌─────────────────────────────────────────────────────┼───────────┐
│                    Monad Testnet (10143)             │           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐        │           │
│  │InvoiceNFT │  │YieldVault │  │ Privacy   │        │           │
│  │ (ERC-721) │◄─┤           │  │ Registry  │        │           │
│  └───────────┘  └─────┬─────┘  └───────────┘        │           │
│                       │                              │           │
│  ┌───────────┐  ┌─────▼─────┐                        │           │
│  │MockOracle │  │AgentRouter│◄───────────────────────┘           │
│  └───────────┘  └───────────┘                                    │
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ ethers.js / viem
                              │
┌─────────────────────────────┴────────────────────────────────────┐
│                        AGENT SERVICE                              │
│                      (TypeScript/Node.js)                        │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │Optimizer  │  │    LLM    │  │ WebSocket │  │  Blockchain  │  │
│  │(Rule-based│  │(Qwen/etc) │  │  Server   │  │   Service    │  │
│  └───────────┘  └───────────┘  └───────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
1. TOKENIZATION FLOW
   User → InvoiceForm → InvoiceNFT.mint() → NFT Created
                     ↓
             PrivacyRegistry.registerCommitment()

2. YIELD FLOW
   User → Approve NFT → YieldVault.deposit() → Strategy Activated
                                ↓
                     Agent monitors via getActiveDeposits()

3. AGENT DECISION FLOW
   Agent Loop → Fetch Invoice Data → Analyze Risk → Generate Recommendation
       ↓                                                 ↓
   WebSocket ←── Stream Reasoning ←── LLM Explanation ←─┘
       ↓
   AgentRouter.recordDecision() → YieldVault.executeAgentAction()

4. WITHDRAWAL FLOW
   User → YieldVault.withdraw() → NFT Returned + Yield Claimed
```

### 2.3 Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Network | Monad Testnet (chainId: 10143) | Low-cost L2 execution |
| Contracts | Solidity 0.8.24 + Foundry | Smart contract development |
| Agent | TypeScript + Node.js | Autonomous agent runtime |
| LLM | Qwen API | Natural language explanations |
| Frontend | Next.js 15 + React 19 | User interface |
| Web3 | wagmi + viem | Blockchain interactions |
| Styling | Tailwind CSS 4 | UI components |
| Real-time | WebSocket (ws) | Live agent streaming |
| Deployment | Docker + GitHub Actions + Ubuntu | CI/CD |

---

## 3. Smart Contracts

### 3.1 Contract Addresses (Monad Testnet)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

Explorer: [https://testnet.monadexplorer.com](https://testnet.monadexplorer.com)

### 3.2 InvoiceNFT.sol

**Purpose**: Tokenizes invoices as ERC-721 NFTs with privacy-preserving metadata.

#### Data Structures

```solidity
struct Invoice {
    bytes32 dataCommitment;      // keccak256(invoiceData ++ salt)
    bytes32 amountCommitment;    // keccak256(amount ++ salt)
    uint256 dueDate;             // Unix timestamp
    uint256 createdAt;           // Mint timestamp
    address issuer;              // Original owner
    InvoiceStatus status;        // Active, InYield, Paid, etc.
    uint8 riskScore;             // 0-100 (from oracle)
    uint8 paymentProbability;    // 0-100 (from oracle)
}

enum InvoiceStatus {
    Active,     // Available for deposit
    InYield,    // Currently in YieldVault
    Paid,       // Invoice settled
    Defaulted,  // Payment failed
    Cancelled   // Invoice voided
}
```

#### Key Functions

| Function | Access | Description |
|---|---|---|
| `mint(dataCommitment, amountCommitment, dueDate)` | Public | Creates new invoice NFT |
| `updateStatus(tokenId, status)` | YieldVault/Owner | Updates invoice status |
| `updateRiskMetrics(tokenId, riskScore, paymentProb)` | Oracle/Agent | Updates risk data |
| `authorizeReveal(tokenId, address)` | Owner | Grants reveal permission |
| `verifyReveal(tokenId, data, salt)` | View | Verifies commitment reveal |
| `getActiveInvoices()` | View | Returns all active token IDs |

#### Events

```solidity
event InvoiceMinted(uint256 indexed tokenId, address indexed issuer, bytes32 dataCommitment, uint256 dueDate);
event InvoiceStatusUpdated(uint256 indexed tokenId, InvoiceStatus oldStatus, InvoiceStatus newStatus);
event RiskScoreUpdated(uint256 indexed tokenId, uint8 riskScore, uint8 paymentProbability);
event RevealAuthorized(uint256 indexed tokenId, address indexed authorizedAddress);
```

### 3.3 YieldVault.sol

**Purpose**: Manages yield strategies for deposited invoice NFTs.

#### Data Structures

```solidity
enum Strategy {
    Hold,           // 0% APY
    Conservative,   // 3.5% APY
    Aggressive      // 7% APY
}

struct Deposit {
    uint256 tokenId;
    address owner;
    Strategy strategy;
    uint256 depositTime;
    uint256 principal;
    uint256 accruedYield;
    uint256 lastYieldUpdate;
    bool active;
}
```

#### Key Functions

| Function | Access | Description |
|---|---|---|
| `deposit(tokenId, strategy, principal)` | NFT Owner | Deposits invoice for yield |
| `withdraw(tokenId)` | Deposit Owner | Withdraws NFT + claims yield |
| `changeStrategy(tokenId, strategy)` | Owner/Agent | Updates yield strategy |
| `executeAgentAction(tokenId, strategy, reason)` | AgentRouter | Agent-initiated change |
| `updateAllYields()` | Public | Batch updates yield accrual |
| `getAccruedYield(tokenId)` | View | Returns current yield |

#### Yield Calculation

```solidity
uint256 public constant HOLD_APY = 0;
uint256 public constant CONSERVATIVE_APY = 350;   // 3.5%
uint256 public constant AGGRESSIVE_APY = 700;     // 7%

yield = (principal * apy * timeElapsed) / (365 days * 10000)
```

### 3.4 PrivacyRegistry.sol

**Purpose**: Manages cryptographic commitments and Merkle proofs for invoice privacy.

#### Commitment Scheme

```solidity
commitment = keccak256(abi.encodePacked(data, salt))
// Verify: keccak256(data, salt) == stored_commitment
```

#### Key Functions

| Function | Access | Description |
|---|---|---|
| `registerCommitment(commitment)` | Public | Registers new commitment |
| `revealCommitment(id, data, salt)` | Owner | Reveals commitment data |
| `verifyCommitment(id, data, salt)` | View | Verifies without revealing |
| `addVerifiedInvoice(hash)` | Verifier | Adds to Merkle tree |
| `verifyInclusion(hash, proof)` | View | Verifies Merkle proof |

### 3.5 AgentRouter.sol

**Purpose**: Routes and executes AI agent decisions on-chain.

#### Key Functions

| Function | Access | Description |
|---|---|---|
| `recordDecision(tokenId, strategy, confidence, reasoning)` | Agent | Records agent decision |
| `executeDecision(tokenId, decisionIndex)` | Public | Manually execute decision |
| `authorizeAgent(address)` | Owner | Authorizes agent address |
| `updateConfig(...)` | Owner | Updates agent parameters |

---

## 4. Agent Service

### 4.1 Architecture

```
agent/
├── src/
│   ├── index.ts          # Entry point
│   ├── agent.ts          # Main agent class + loop
│   ├── optimizer.ts      # Rule-based strategy optimizer
│   ├── llm.ts            # LLM integration (Qwen)
│   ├── websocket.ts      # WebSocket server
│   ├── blockchain.ts     # Contract interactions
│   └── types.ts          # TypeScript interfaces
├── data/                 # Persisted agent data (volume-mounted)
├── package.json
└── tsconfig.json
```

### 4.2 Agent Loop

```typescript
class VinoAgent {
  async runLoop() {
    while (running) {
      const deposits = await blockchain.getActiveDeposits()

      for (const tokenId of deposits) {
        const analysis = await this.analyzeInvoice(tokenId)
        await this.streamThoughts(analysis)

        if (analysis.shouldAct && config.autoExecute) {
          await this.executeDecision(analysis)
        }
      }

      await sleep(config.analysisInterval) // Default: 30s
    }
  }
}
```

### 4.3 Strategy Optimizer

```typescript
function optimizeStrategy(context: OptimizationContext): StrategyRecommendation {
  let score = 0

  // Factor 1: Risk Score (0-100)
  if (riskScore >= 80) score += 30
  else if (riskScore >= 60) score += 15
  else if (riskScore >= 40) score += 5
  else score -= 10

  // Factor 2: Payment Probability
  if (paymentProb >= 90) score += 25
  else if (paymentProb >= 75) score += 15
  else if (paymentProb >= 50) score += 5
  else score -= 15

  // Factor 3: Time until due
  if (daysUntilDue >= 60) score += 20
  else if (daysUntilDue >= 30) score += 15
  else if (daysUntilDue >= 14) score += 5
  else if (daysUntilDue < 0) score -= 30

  if (score >= 60) return Strategy.Aggressive
  if (score >= 30) return Strategy.Conservative
  return Strategy.Hold
}
```

### 4.4 WebSocket Protocol

**Endpoint**: `ws://localhost:8080` locally, `ws://agent.eduworld.world` in production

#### Message Types

```typescript
interface WebSocketMessage {
  type: 'thought' | 'decision' | 'execution' | 'status' | 'error'
  payload: AgentThought | AgentDecision | { status: string }
}
```

#### Example Message Sequence

```json
{"type": "status", "payload": {"status": "connected"}}

{"type": "thought", "payload": {
  "type": "thinking", "tokenId": "0",
  "message": "Analyzing Invoice #0..."
}}

{"type": "thought", "payload": {
  "type": "analysis", "tokenId": "0",
  "message": "Risk Score: 85/100 | Payment Probability: 92%",
  "data": {"riskScore": 85, "paymentProbability": 92, "daysUntilDue": 45}
}}

{"type": "thought", "payload": {
  "type": "decision", "tokenId": "0",
  "message": "Upgrading to Aggressive strategy — strong fundamentals."
}}

{"type": "execution", "payload": {
  "type": "execution", "tokenId": "0",
  "message": "Strategy updated to Aggressive",
  "data": {"txHash": "0x..."}
}}
```

---

## 5. Frontend Application

### 5.1 Component Structure

```
app/src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── dashboard/
│   │   ├── page.tsx
│   │   ├── mint/page.tsx
│   │   ├── portfolio/page.tsx
│   │   └── settings/page.tsx
│   └── api/
│       ├── invoices/route.ts
│       ├── quickbooks/auth/route.ts
│       └── quickbooks/callback/route.ts
├── components/
│   ├── providers.tsx
│   └── ...
├── hooks/
│   ├── use-invoice-nft.ts    # Core minting + polling logic
│   └── ...
└── lib/
    ├── wagmi.ts              # Web3 config + chain definition
    ├── monad-rpc.ts         # RPC URL list + transport
    └── contracts/
        ├── addresses.ts      # Address registry by chainId
        ├── abis.ts           # Contract ABIs
        └── server.ts         # Server-side contract reads
```

### 5.2 Invoice Minting

The mint flow (`use-invoice-nft.ts → useMintInvoice`) uses `writeContractAsync` directly:

```typescript
await writeContractAsync({
  address: contractAddress,
  abi: InvoiceNFTABI,
  functionName: "mint",
  args: [dataCommitment, amountCommitment, dueDateUnix],
  chainId: MONAD_TESTNET_CHAIN_ID,
})
```

No `simulateContract` call. The wallet handles EIP-1559 gas estimation natively. This is required because `simulateContract` with a `gasPrice` override creates a legacy type-0 transaction, which MetaMask blocks on HTTPS production domains under EIP-1559 fee validation.

Receipt confirmation uses `useWaitForTransactionReceipt` with `pollingInterval: 3_000`. A 3-minute timeout fires `forceSettle`, which queries each RPC URL independently (bypassing viem's `fallback()` transport, which only retries on network errors — not on null receipts).

### 5.3 Server-Side Contract Reads

API routes (`/api/invoices`) call contract read functions server-side via `app/src/lib/contracts/server.ts`. Contract addresses are available server-side because `NEXT_PUBLIC_*` vars are baked into server route bundles at build time alongside client chunks.

Diagnostics are logged at startup:

```
[contracts/server] chainId: 10143
[contracts/server] invoiceNFT: 0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
[contracts/server] getActiveInvoices → 5 ids: [1, 2, 3, 4, 5]
```

### 5.4 QuickBooks OAuth

The OAuth flow in `api/quickbooks/auth/route.ts` constructs the redirect URI server-side. A guard prevents crashing when the `NEXT_PUBLIC_APP_URL` placeholder hasn't been replaced yet:

```typescript
const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
const appUrl = (configuredUrl && !configuredUrl.startsWith("__"))
  ? configuredUrl
  : origin  // fallback to request origin

const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || `${appUrl}/api/quickbooks/callback`
```

---

## 6. Privacy Layer

### 6.1 Commitment Scheme

Invoice data is never stored on-chain in plain text:

```
COMMITMENT CREATION:
1. User enters invoice data: {client: "Acme", amount: 10000, ...}
2. Generate random salt: salt = crypto.getRandomValues(32 bytes)
3. dataCommitment  = keccak256(data || salt)
4. amountCommitment = keccak256(amount || salt)
5. Only commitments go on-chain — salt stays local

VERIFICATION (without revealing):
1. Verifier has: commitment (on-chain)
2. Owner provides: data + salt (off-chain)
3. Verifier computes: keccak256(data || salt)
4. Compare: computed == stored → valid
```

### 6.2 ZK-Ready Architecture

Current implementation uses keccak256 commitments. The architecture is designed for a ZK upgrade (Noir circuits) that would prove properties about invoice values without revealing them.

---

## 7. API Reference

### 7.1 REST Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/invoices` | Returns active invoice IDs from contract |
| GET | `/api/quickbooks/auth` | Initiates QuickBooks OAuth flow |
| GET | `/api/quickbooks/callback` | Handles OAuth redirect, exchanges code for token |
| GET | `/health` | Returns `{ status: "ok" }` |

### 7.2 WebSocket API

**Endpoint**: `ws://agent.eduworld.world` (production), `ws://localhost:8080` (local)

See Section 4.4 for the full message protocol.

---

## 8. Deployment

### 8.1 Local Development

```bash
# Install dependencies (repo root)
pnpm install

# Start agent
cd agent && pnpm dev

# Start frontend (separate terminal)
cd app && pnpm dev
# → http://localhost:3000
```

### 8.2 Production (Docker + Ubuntu + GitHub Actions)

See [DEPLOY.md](../DEPLOY.md) for the full guide. Summary:

1. Set GitHub Secrets: `DOCKER_USERNAME`, `DOCKER_PASSWORD`, `SSH_HOST`, `SSH_USERNAME`, `SSH_PRIVATE_KEY`
2. Create `~/vino/.env.app` and `~/vino/.env.agent` on the server (no trailing whitespace)
3. Push to `main` → CI builds images, SSHes to server, redeploys containers

### 8.3 Contract Deployment

Contracts are already deployed. To redeploy from scratch:

```bash
cd contracts
export PRIVATE_KEY=your_deployer_key
export MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz

forge script script/Deploy.s.sol \
  --rpc-url $MONAD_TESTNET_RPC \
  --broadcast \
  --verify
```

After redeployment, update addresses in:
- `Dockerfile.web` (ENV declarations)
- `app/.env.example`
- `app/src/lib/contracts/addresses.ts`
- `agent/src/blockchain.ts` (or the agent env file)

---

## 9. Configuration

### 9.1 Agent Parameters

| Parameter | Default | Description |
|---|---|---|
| `minConfidence` | 70 | Minimum confidence to auto-execute |
| `analysisInterval` | 30000ms | Time between analysis cycles |
| `autoExecute` | true | Auto-execute high-confidence decisions |

### 9.2 Yield Rates

| Strategy | APY | Risk Level |
|---|---|---|
| Hold | 0% | None |
| Conservative | 3.5% | Low |
| Aggressive | 7% | Medium |

### 9.3 Network

| Network | Chain ID | RPC |
|---|---|---|
| Monad Testnet | 10143 | `https://testnet-rpc.monad.xyz` |
| Fallback 1 | 10143 | `https://testnet-rpc.monad.xyz` |
| Fallback 2 | 10143 | `https://testnet-rpc.monad.xyz/` |

wagmi is configured with `pollingInterval: 12_000` (12s) and `batch: { multicall: true }` to avoid rate-limiting Monad Testnet's public RPC.

---

## 10. Testing

### 10.1 Smart Contract Tests

```bash
cd contracts
forge test
forge test -vvv          # verbose
forge test --gas-report  # gas usage
```

### 10.2 Agent

```bash
cd agent
pnpm exec tsc --noEmit  # type check
pnpm dev                # manual test (watch logs)
```

### 10.3 Frontend

```bash
cd app
pnpm exec tsc --noEmit  # type check
pnpm build              # production build
```

---

## 11. Security Considerations

### 11.1 Smart Contract Security

| Risk | Mitigation |
|---|---|
| Reentrancy | `ReentrancyGuard` on YieldVault |
| Access Control | `Ownable` + role-based modifiers |
| Integer Overflow | Solidity 0.8+ built-in checks |
| Unauthorized agent | `authorizeAgent` allowlist on AgentRouter |

### 11.2 Privacy

| Data | Storage | Access |
|---|---|---|
| Invoice details | Off-chain (user's device) | User only |
| Commitments | On-chain | Public (meaningless without salt) |
| Salts | localStorage | User only |
| Risk scores | On-chain | Public |

### 11.3 Agent Security

- `AGENT_PRIVATE_KEY` lives only in `~/vino/.env.agent` on the server
- Never in the frontend, GitHub secrets, or Docker image
- Agent wallet must be explicitly authorized on `AgentRouter`

### 11.4 Known Limitations (MVP)

1. **Simulated yield**: No actual DeFi integration yet (future: Lendle)
2. **Mock Oracle**: Risk data is simulated
3. **Local salt storage**: Production would use encrypted storage
4. **Single agent**: No redundancy or failover

---

## 12. Known Issues & Lessons Learned

### 12.1 `NEXT_PUBLIC_*` Variable Baking

`NEXT_PUBLIC_*` vars are embedded in the JS bundle at build time — runtime env files cannot override them. They appear in **two** places:

- `.next/static/chunks/*.js` (client-side)
- `.next/server/**/*.js` (server-side route bundles)

The entrypoint `sed` replacement must cover both directories. Replacing only client chunks leaves server-side API routes with stale placeholder values (e.g. `__VINO_APP_URL__`), causing `new URL()` crashes.

### 12.2 EIP-1559 Gas on Production HTTPS

Using `simulateContract` with a `gasPrice` override creates a legacy type-0 transaction. MetaMask enforces EIP-1559 fee validation more strictly on HTTPS origins than on `localhost`, causing these transactions to get stuck in the mempool indefinitely. Fix: use `writeContractAsync` with no gas override and let the wallet use native EIP-1559 fee estimation.

### 12.3 viem `fallback()` Transport and Receipt Polling

`fallback()` only switches RPC providers on network-level errors. A successful HTTP 200 response containing `null` (when a transaction hasn't been indexed yet) does not trigger a fallback. For receipt polling, query each RPC URL independently.

### 12.4 Docker `--env-file` Trailing Whitespace

Docker's `--env-file` parser includes trailing whitespace as part of the value. A value like `CLIENT_ID=abc  ` becomes `abc  ` (with spaces), which breaks authentication. Strip trailing whitespace before using an env file:

```bash
sed -i 's/[[:space:]]*$//' ~/vino/.env.app
```

### 12.5 `$USER` in SSH Sessions

`$USER` is unset in non-login shell sessions used by GitHub Actions SSH. Use `$HOME` instead of `/home/$USER/...`.

### 12.6 Contract Address Consistency

Two contract deployments exist on Monad Testnet. The **active** deployment is the one with addresses in Section 3.1. The Dockerfile, local `.env`, server `.env.app`, and agent `.env.agent` must all reference the same deployment. Mixing addresses causes the invoice table to show a different count than what exists on-chain.

---

## 13. Future Roadmap

### Phase 1: MVP (Complete)
- [x] Invoice tokenization with commitments
- [x] Yield vault with simulated APY
- [x] Autonomous agent with live reasoning
- [x] Privacy-preserving architecture
- [x] Ubuntu + Docker + GitHub Actions CI/CD
- [x] QuickBooks OAuth integration
- [x] Production deployment at `https://vino.eduworld.world`

### Phase 2: Real DeFi Integration
- [ ] Lendle protocol integration for actual yield
- [ ] mETH staking for idle capital
- [ ] RedStone oracle integration for real risk data

### Phase 3: ZK Privacy
- [ ] Noir circuit for amount range proofs
- [ ] zkPass integration for KYC
- [ ] Private invoice verification

### Phase 4: Production Scale
- [ ] Multi-sig custody
- [ ] Secondary market for invoice NFTs
- [ ] Institutional compliance features
- [ ] Multi-chain deployment

---

## Appendix A: Error Reference

### Smart Contracts

| Error | Contract | Meaning |
|---|---|---|
| `"Only YieldVault"` | InvoiceNFT | Caller is not YieldVault |
| `"Only Agent or Oracle"` | InvoiceNFT | Unauthorized risk update |
| `"Not token owner"` | InvoiceNFT | Caller doesn't own NFT |
| `"Already deposited"` | YieldVault | Invoice already in vault |
| `"Not active"` | YieldVault | Deposit not active |
| `"Not authorized agent"` | AgentRouter | Agent not authorized |

### Frontend / Mint Flow

| Error | Meaning |
|---|---|
| `tx stuck in mempool` | Legacy type-0 tx — remove `gasPrice` from `simulateContract` |
| `chain check failed: could not be found` | Wrong chain or RPC unreachable — `forceSettle` handles this |
| `__VINO_APP_URL__ is not a valid URL` | Entrypoint sed didn't replace server bundles |
| `clientId='undefined'` | Trailing whitespace in `.env.app` QUICKBOOKS_CLIENT_ID |

### Agent

| Error | Meaning |
|---|---|
| `"Agent not active"` | Agent is disabled |
| `"No private key"` | Running in read-only mode |
| `"WebSocket error"` | Connection issue |

---

## Appendix B: Gas Estimates (Monad Testnet)

| Operation | Estimated Gas | Cost @ 0.02 gwei |
|---|---|---|
| `mint()` | ~250,000 | ~0.000005 MON |
| `deposit()` | ~300,000 | ~0.000006 MON |
| `withdraw()` | ~200,000 | ~0.000004 MON |
| `recordDecision()` | ~150,000 | ~0.000003 MON |
| `changeStrategy()` | ~100,000 | ~0.000002 MON |
