# vino — AI-Managed Invoice Yield with Cleanverse CVI + CVA Compliance

> **Hackathon Build · Monad Testnet × Cleanverse**

vino is a B2B invoice financing protocol where every invoice is tokenized as an NFT, an AI agent autonomously manages yield strategy, and all settlement is gated by Cleanverse CVI (identity) and CVA (verified asset) verification.

---

## Judging Criteria Mapping

| Criterion | Weight | How vino satisfies it |
|---|---|---|
| **Concept** | 20% | Closes the $40T SME invoice financing gap (30–90 day cash-flow lock) with a compliant, on-chain DeFi solution |
| **CVI · CVA Integration Depth** | 30% | 7 live Cleanverse API endpoints + `MockCVI.verify()` on-chain; KYB gate → CVA token selection → payment request → FATF Travel Rule report; every call shows live vs fallback source |
| **Build Quality** | 25% | TypeScript monorepo — 0 TS errors, 0 ESLint warnings; Next.js 15 App Router + Node agent + Aave V3 on Monad; rate-limited API routes; hierarchical MemoriVault (L1/L2/L3) |
| **UX & Demo** | 15% | Terminal Bloomberg aesthetic; mint TX hash auto-fills Travel Rule form; every Cleanverse call shows ✓ live/fallback badge; `MockCVI.verify()` tx + A-Pass record ID surfaced post-onboard |
| **Scalability** | 10% | Monad 10k TPS / ~0.5s finality; concurrent agent with nonce mutex; 10-min A-Token cache; Redis-ready hierarchical memory |

---

## CVI + CVA Integration — 7 Endpoints

### 1 · generate_apass · AES-CBC
```
POST /api/cleanverse/onboard
  └─► Cleanverse /generate_apass  {customerId, expirationTime, wallet}
        ─► cvRecordId returned and displayed post-onboard
```

### 2 · query_apass · plain JSON
```
POST /api/cleanverse/onboard  (step 2 of 3)
POST /api/cleanverse/verify   (every page load — checks A-Pass status)
  └─► Cleanverse /query_apass  {chain, address}
        ─► tier + expirationTime rendered in verified banner
```

### 3 · MockCVI.verify() · on-chain Monad tx
```
POST /api/cleanverse/onboard  (step 3 of 3)
  └─► walletClient.writeContract MockCVI.verify(address)
        ─► txHash returned + displayed as clickable Monad Explorer link
```

### 4 · query_deposit_atoken_list · AES-CBC
```
POST /api/cleanverse/atoken-list
  └─► Cleanverse /query_deposit_atoken_list  {chain}
        ─► USDC · USDT · EURC with issuer + kybRequired badge
        ─► "✓ live Cleanverse" vs "demo tokens" badge shown in UI
```

### 5 · verify_apass · AES-CBC
```
POST /api/cleanverse/verify-atoken
  └─► Cleanverse /verify_apass  {chain, atoken, address}
        ─► eligibility per token; fallback: MockCVI.isVerified() on-chain
        ─► source shown: "verify_apass: Cleanverse API ✓" or "MockCVI.isVerified(): on-chain ✓"
```

### 6 · create_payment_request · AES-CBC
```
POST /api/cleanverse/cva-payment
  └─► Cleanverse /create_payment_request  {invoiceNft, settlement, amount, issuer}
        ─► "✓ Cleanverse API" badge when live; "local format" badge on fallback
        ─► inline preview: settlement asset, send_to, amount, compliance note
```

### 7 · download_travel_rule · AES-CBC
```
POST /api/cleanverse/travel-rule
  └─► Cleanverse /download_travel_rule  {txHash, wallet}
        ─► "✓ Cleanverse API" badge when live; "local format" badge on fallback
        ─► FATF Rec-16 inline preview: originator, beneficiary, CVA settlement asset, compliance
```

---

## Protocol Flow

```
Wallet connects
      │
      ▼  useCleanverseCVI() → POST /api/cleanverse/verify → query_apass
      │
unverified?──► "Complete KYB" button
      │              │
      │              ▼  POST /api/cleanverse/onboard
      │              │  1. generate_apass (AES-CBC)
      │              │  2. query_apass    (plain JSON)  ← tier + expirationTime
      │              │  3. MockCVI.verify(wallet)       ← txHash displayed + explorer link
      │              │     └─► cvRecordId displayed in verified banner
      │              ▼
      │        CVI Banner: "A-Pass · Tier N · expires MMM DD YYYY"
      │        capabilities: mint_invoices · cva_settlement · travel_rule
      │
verified──► Mint page unlocked
      │
      ▼  POST /api/cleanverse/atoken-list → query_deposit_atoken_list
         USDC · USDT · EURC with issuer, kybRequired, eligibility check
         Each token: POST /api/cleanverse/verify-atoken → verify_apass
      │
User mints invoice NFT (ERC-721, keccak256 commitment)
saveInvoiceMetadata(tokenId, { settlementToken, settlementSymbol, settlementContractAddress,
                               mintTxHash, cviTxHash, cviRecordId })
      │  cviTxHash  = MockCVI.verify() Monad tx — shown as Explorer link in compliance trail
      │  cviRecordId = Cleanverse A-Pass record ID — links on-chain CVI proof to identity record
      ▼  Invoice Detail page
         Compliance Audit Trail: CVI → Invoice → CVA → Payment → Travel Rule
         CVI VERIFIED step: record:<cvRecordId> + "MockCVI.verify() ↗" Monad Explorer link
         CVA Settlement: settlement badge + contract address → Monad Explorer link
      │
"Request Payment" → POST /api/cleanverse/cva-payment → create_payment_request
      │  source badge: ✓ Cleanverse API | local format
      ▼
"Generate" Travel Rule → POST /api/cleanverse/travel-rule → download_travel_rule
      │  source badge: ✓ Cleanverse API | local format
      │  inline FATF Rec-16 preview: tx, originator, beneficiary, CVA asset
      ▼
Download report JSON (mintTxHash auto-populated from localStorage)
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js 15 App (app/)                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ /dashboard   │  │ /mint        │  │ /invoice/:id       │ │
│  │ CVI status   │  │ CVI gate     │  │ CVA settlement     │ │
│  │ CVA badges   │  │ CVA select   │  │ payment request    │ │
│  │ portfolio    │  │ source badges│  │ FATF preview       │ │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Cleanverse API Routes (7 endpoints)                  │  │
│  │  /api/cleanverse/verify       → query_apass           │  │
│  │  /api/cleanverse/onboard      → generate_apass        │  │
│  │  /api/cleanverse/atoken-list  → query_deposit_atoken  │  │
│  │  /api/cleanverse/verify-atoken → verify_apass         │  │
│  │  /api/cleanverse/cva-payment  → create_payment_request│  │
│  │  /api/cleanverse/travel-rule  → download_travel_rule  │  │
│  │  All write endpoints: AES-CBC encrypted body          │  │
│  │  All read endpoints:  plain JSON                      │  │
│  │  Fallback hierarchy:  Cleanverse → MockCVI → local    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │  wagmi / viem
┌─────────────────────────▼─────────────────────────────────┐
│  Monad Testnet  (Chain ID 10143 · 10,000 TPS · ~0.5s)     │
│  InvoiceNFT  — ERC-721, keccak256 commitment storage      │
│  YieldVault  — Aave V3 strategy (Hold / Conservative / Agg)│
│  AgentRouter — records + executes AI decisions on-chain   │
│  MockCVI     — isVerified(addr) view + verify(addr) write │
└────────────────────────────────────────────────────────────┘
                          │  RPC / events
┌─────────────────────────▼─────────────────────────────────┐
│  MemoriVault Agent (agent/)                               │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ optimizer.ts │  │  llm.ts    │  │  memory/         │  │
│  │ risk scoring │  │ Qwen 70B   │  │  L1 working mem  │  │
│  │ market regime│  │ text-emb-v3│  │  L2 episodic/pg  │  │
│  │ Hold/Cons/Ag │  │ 1024-dim   │  │  L3 semantic     │  │
│  └──────────────┘  └────────────┘  └──────────────────┘  │
│  • nonce-mutex (txLock) — concurrent analysis safe       │
│  • pre-flight cooldown check — no wasted gas on revert   │
│  • baseFee × 1.2 + 1 Gwei EIP-1559 gas formula          │
│  • ensureRouterConfig() raises maxGasPrice to 500 Gwei   │
│  • CVI gate: MockCVI.isVerified() before each settlement │
│  • CVA gate: verify_apass eligibility per deposit cycle  │
└────────────────────────────────────────────────────────────┘
```

---

## Demo Path (< 5 minutes)

1. **Connect wallet** — MetaMask on Monad Testnet (Chain ID 10143)
2. **KYB onboard** — click "Complete KYB Verification"
   - `generate_apass` → `query_apass` → `MockCVI.verify()` on Monad
   - Banner turns green: Tier, expiry, on-chain tx hash + A-Pass record ID shown
3. **Mint invoice** — fill client name / amount / due date, select **USDC (CVA)** → mint NFT
4. **Invoice detail** — Compliance Audit Trail: CVI → Invoice → CVA → Payment → Travel Rule
   - **CVI VERIFIED** step: `record:<cvRecordId>` + clickable `MockCVI.verify() ↗` Monad Explorer link
   - CVA Settlement panel: USDC badge + Monad Explorer contract link
   - Click **"Request Payment"** → source badge shows `create_payment_request ✓` or `CVA local format`
5. **Travel Rule** — TX hash is **auto-populated** from mint metadata → click "generate"
   - Source badge: ✓ Cleanverse API or local format
   - Inline FATF Rec-16 preview: originator, beneficiary, CVA asset, compliance note
6. **Agent page** — Decision Cycle: CVI → CVA → MEM → LLM → GAS; watch strategy execute

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| `baseFee × 1.2 + 1 Gwei` gas formula | Monad base fee ~100 Gwei; `getFeeData()` returns 2× = rejected. Dynamic from `block.baseFeePerGas`. |
| Promise-chain nonce mutex (`txLock`) | `Promise.allSettled` concurrent analysis → same pending nonce → "higher priority" rejection. Mutex serializes submissions. |
| Pre-flight cooldown check | `AgentRouter.decisionCooldown = 5 min`; Monad encodes contract reverts as "out of gas". Reading `lastAnalysis` first avoids wasted gas. |
| `ensureRouterConfig()` on startup | Contract `maxGasPrice = 100 Gwei` default causes auto-execute to silently skip when `tx.gasprice > 100 Gwei`. Raised to 500 Gwei. |
| AES-CBC for all write Cleanverse calls | API contract: write endpoints (generate_apass, verify_apass, etc.) require AES-CBC encrypted body. Read endpoints (query_apass) use plain JSON. |
| Fallback hierarchy (Cleanverse → MockCVI → local) | Testnet UAT may not have all endpoints enabled; verify_apass falls back to `MockCVI.isVerified()`; payment/travel-rule fall back to local structured format. |
| `source` field on all fallback-capable routes | Lets the UI show "✓ Cleanverse API" vs "local format" badges — judges and auditors can see exactly which data came from the live Cleanverse backend. |
| Qwen `text-embedding-v3` (1024-d) | `text-embedding-v2` is not on the free-tier quota. v3 is available and produces high-quality vectors for MemoriVault RAG recall. |
| localStorage for invoice metadata | On-chain stores only keccak256 commitment. Client-side metadata (CVA token, contract address, `mintTxHash`, `cviTxHash`, `cviRecordId`) persisted by tokenId. `cviTxHash` is the `MockCVI.verify()` Monad tx shown as an Explorer link in the compliance trail; `cviRecordId` is the Cleanverse A-Pass record ID — together they form the end-to-end CVI proof chain. `mintTxHash` auto-populates the Travel Rule form. |

---

## Running Locally

```bash
# App
cd app
cp .env.example .env   # fill NEXT_PUBLIC_* + CLEANVERSE_* vars
pnpm install
pnpm dev               # http://localhost:3000

# Agent (separate terminal)
cd agent
cp .env.example .env   # fill RPC_URL, PRIVATE_KEY, QWEN_API_KEY
pnpm install
pnpm build
pnpm start
```

### Required env vars

```
# Cleanverse
CLEANVERSE_API_ID=your_institution_id
CLEANVERSE_API_KEY=base64_encoded_aes_key    # 32-byte key, base64-encoded

# On-chain relay (MockCVI.verify sender)
RELAY_PRIVATE_KEY=0x...                       # deployer / CVI admin wallet
MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3

# Monad Testnet
NEXT_PUBLIC_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_INVOICE_NFT_ADDRESS=0x...
NEXT_PUBLIC_YIELD_VAULT_ADDRESS=0x...
NEXT_PUBLIC_AGENT_ROUTER_ADDRESS=0x...
```

---

## Contracts (Monad Testnet · Chain ID 10143)

See `app/.env` for the live deployed addresses of `InvoiceNFT`, `YieldVault`, `AgentRouter`, and `MockCVI`.

| Contract | Role |
|---|---|
| `InvoiceNFT` | ERC-721; stores keccak256 data + amount commitments; gated by `MockCVI.isVerified()` |
| `YieldVault` | Aave V3 strategy router; Hold / Conservative / Aggressive |
| `AgentRouter` | Records AI decisions on-chain; enforces cooldown + gas caps |
| `MockCVI` | `isVerified(addr) view` + `verify(addr)` write; owner = relay wallet |
