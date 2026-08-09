# vino Agent — MemoriVault

The vino AI agent monitors the Monad Testnet deployment, analyzes invoice risk and yield state, and autonomously executes strategy decisions on-chain via `AgentRouter`. It also exposes a WebSocket server so the dashboard can display live activity.

**WebSocket:** `wss://dkwc0vn4y827h.cloudfront.net/ws`  
**Health:** `https://dkwc0vn4y827h.cloudfront.net/ws/health`  
**Local port:** `8080`

---

## What the Agent Does

- Reads all active invoice and deposit state from Monad Testnet every 5 minutes
- Scores each invoice: risk (0-100), payment probability (0-100), days to due date
- Calls `MockCVI.isVerified()` on-chain before each settlement — CVI gate always active
- Calls `verify_apass` (Cleanverse API) each cycle to check CVA eligibility per depositor
- Sends risk scores + market regime to Qwen 70B for strategy analysis
- Decides: Hold / Conservative (3.5% APY) / Aggressive (7% APY)
- Auto-executes approved changes via `AgentRouter` when confidence ≥ 70% and auto-execute is enabled
- Broadcasts live activity to the frontend over WebSocket
- Persists decisions in MemoriVault (L1/L2/L3 hierarchical memory)

---

## Contract Addresses (Monad Testnet · Chain ID 10143)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

---

## Quick Start (Local)

```bash
cd agent
cp .env.example .env   # fill in AGENT_PRIVATE_KEY, QWEN_API_KEY
pnpm install
pnpm build
pnpm start
```

Health check: `curl http://localhost:8080/health`

---

## Docker (Local)

Build from the repo root (monorepo context):

```bash
docker build -f Dockerfile.mcp -t vino-agent .
```

Run:

```bash
docker run -p 8080:8080 \
  --env-file agent/.env \
  -v $(pwd)/agent-data:/app/agent/data \
  vino-agent
```

---

## Environment Variables

```env
# ── RPC ──────────────────────────────────────────────────────
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz

# ── Agent wallet ─────────────────────────────────────────────
# 0x + 64 hex chars. Omit to run in read-only (no on-chain txs) mode.
AGENT_PRIVATE_KEY=0x...

# ── AI — Qwen Cloud ──────────────────────────────────────────
QWEN_API_KEY=sk-...
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
# Optional model overrides:
# QWEN_MAX_MODEL=qwen-max
# QWEN_TURBO_MODEL=qwen-turbo

# ── WebSocket ─────────────────────────────────────────────────
WS_PORT=8080

# ── Contract addresses ────────────────────────────────────────
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca

# ── Cleanverse (same creds as app — optional but recommended) ─
CLEANVERSE_API_ID=
CLEANVERSE_API_KEY=
CLEANVERSE_API_URL=https://uatapi.cleanverse.com/api/cooperate

# ── Memory backends (optional upgrades) ──────────────────────
# L1: default is in-process Map — upgrade to Redis for multi-instance
# REDIS_URL=redis://localhost:6379
# L2: default is JSON file at /app/agent/data/l2-episodic.json
# DATABASE_URL=postgresql://user:pass@host:5432/memorivault
```

---

## MemoriVault — Hierarchical Memory

The agent uses a three-tier memory system:

| Tier | Storage | Content | Lifetime |
|---|---|---|---|
| **L1** | In-process `Map` | Active working context (current cycle risk scores, market regime) | Per cycle |
| **L2** | JSON file (`/app/agent/data/l2-episodic.json`) | Episode store: past decisions, outcomes, strategy changes. Qwen `text-embedding-v3` 1024-dim vectors for RAG recall | Persistent across restarts |
| **L3** | Distilled rules | Patterns extracted from L2 episodes — generalized risk/yield rules | Persistent, updated by distillation |

RAG recall uses cosine similarity on L2 embeddings to surface relevant past decisions before each new analysis cycle.

---

## Decision Cycle (every 5 minutes)

```
1. CVI gate    → MockCVI.isVerified() for each depositor (on-chain)
2. CVA gate    → verify_apass eligibility per deposit (Cleanverse API)
3. Risk score  → invoice age, days to due, payment probability, market regime
4. MEM recall  → MemoriVault RAG — retrieve relevant past episodes from L2
5. LLM analyze → Qwen 70B with risk context + memory context
6. Gas check   → AgentRouter.lastAnalysis cooldown (5 min); baseFee × 1.2
7. Decision    → Hold / Conservative / Aggressive, confidence score
8. Execute     → If confidence ≥ 0.70 and auto-execute ON: AgentRouter.recordDecision()
9. Broadcast   → WebSocket push to all connected dashboard clients
10. Store      → L2 episode; distill to L3 if pattern threshold met
```

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| **Nonce mutex (`txLock`)** | `Promise.allSettled` concurrent analysis → same pending nonce → "higher priority" rejection. Mutex serializes all on-chain submissions. |
| **Pre-flight cooldown check** | `AgentRouter.decisionCooldown = 5 min`; Monad encodes contract reverts as "out of gas". Reading `lastAnalysis` first avoids wasted gas. |
| **`baseFee × 1.2 + 1 Gwei` gas formula** | Monad base fee ~100 Gwei; `getFeeData()` returns 2× and gets rejected. Formula reads `block.baseFeePerGas` dynamically. |
| **`ensureRouterConfig()` on startup** | Contract `maxGasPrice = 100 Gwei` default causes auto-execute to silently skip when `tx.gasprice > 100 Gwei`. Raised to 500 Gwei at agent start. |
| **Qwen `text-embedding-v3` (1024-d)** | `text-embedding-v2` is not on the free-tier quota. v3 is available and produces high-quality vectors for MemoriVault RAG recall. |

---

## Agent Data Persistence

The agent writes L2 episodic memory to `/app/agent/data` inside the container. In production this is mounted to `~/vino/agent-data` on the host so data survives container restarts and image upgrades:

```bash
-v ~/vino/agent-data:/app/agent/data
```

The host directory must exist before the container starts:

```bash
mkdir -p ~/vino/agent-data
```

---

## WebSocket Protocol

**Connection:**
- Local: `ws://localhost:8080`
- Production: `wss://dkwc0vn4y827h.cloudfront.net/ws` (via CloudFront `/ws*` behavior → EC2:8080)

**Health endpoint:** `GET /health` returns `{"status":"healthy","uptime":...}`

**Message types broadcast by agent:**

```typescript
{ type: "status",   payload: { status: "connected" | "analyzing" | "executing" } }
{ type: "analysis", payload: { tokenId, riskScore, paymentProbability, daysUntilDue, strategy, confidence } }
{ type: "decision", payload: { tokenId, strategy, confidence, autoExecute } }
{ type: "execute",  payload: { tokenId, txHash, strategy, gasUsed } }
{ type: "memory",   payload: { event: "store" | "recall" | "prune" | "distill", tier, summary } }
{ type: "error",    payload: { message, context } }
```

---

## Production Notes

- Keep `AGENT_PRIVATE_KEY` only in `~/vino/.env.agent` on the server — never in the frontend or in GitHub secrets
- The Docker container exposes `/health` for readiness probes
- The agent is deployed **before** the app in CI — the app health check depends on the agent being up
- Agent memory persists via volume mount; `~/vino/agent-data/` must exist on the host before first run
- After first deploy, authorize the agent wallet: `AgentRouter.authorizeAgent(<agentWalletAddress>)` from the deployer wallet

---

## Deployment

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Ubuntu server + Docker + GitHub Actions full guide
- [../DEPLOY.md](../DEPLOY.md) — Top-level deployment guide including CloudFront setup
- [../.github/workflows/ci.yml](../.github/workflows/ci.yml) — CI/CD pipeline
