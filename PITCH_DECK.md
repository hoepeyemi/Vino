# vino — Investor Pitch Deck
### AI-Managed Invoice Yield · Monad Testnet × Cleanverse CVI/CVA
**Cleanverse Build: Trusted Assets Hackathon · Track 01 RWA · Aug 2026**

Live demo: **https://dkwc0vn4y827h.cloudfront.net**

---

## Judging Criteria Mapping

| Criterion | Weight | How vino satisfies it |
|---|---|---|
| Concept | 20% | Closes the $40T SME invoice financing gap (30–90 day cash-flow lock) with a compliant, on-chain DeFi solution |
| CVI · CVA Integration Depth | 30% | 7 live Cleanverse API endpoints + `MockCVI.verify()` on-chain; KYB gate → CVA token selection → payment request → FATF Travel Rule report; every call shows live vs fallback source |
| Build Quality | 25% | TypeScript monorepo — 0 TS errors, 0 ESLint warnings; Next.js 15 App Router + Node agent + Aave V3 on Monad; rate-limited API routes; hierarchical MemoriVault (L1/L2/L3) |
| UX & Demo | 15% | Terminal Bloomberg aesthetic; mint TX hash auto-fills Travel Rule form; every Cleanverse call shows ✓ live/fallback badge; `MockCVI.verify()` tx + A-Pass record ID surfaced post-onboard |
| Scalability | 10% | Monad 10k TPS / ~0.5s finality; concurrent agent with nonce mutex; 5-min A-Token cache; Redis-ready hierarchical memory |

---

## The Problem

Asia sits on **$2.5 trillion** of locked invoice capital.

SMEs globally issue invoices and wait 30–90 days for payment, locking working capital they cannot redeploy. The APAC trade finance gap reached **$2.5 trillion** in 2022 (Asian Development Bank), driven by bank rejection rates above 40% for SME applicants.

**Traditional invoice factoring:** 3–5% monthly fees, 60-day approval cycles, opaque pricing, collateral requirements that exclude 80% of SMEs, no audit trail for cross-border FATF compliance.

**Existing DeFi protocols:** No KYB verification. No FATF Travel Rule support. No CVA-verified stablecoin settlement. No institutional compliance layer — rejected outright by regulated Asian markets.

### APAC Trade Finance Gap by Market

| Market | Est. Invoice Gap | SME Pain Point | Regulatory Signal |
|---|---|---|---|
| 🇸🇬 Singapore | $30B+ | ASEAN hub; cross-border SME invoices in USD/SGD/USDC — compliance is the bottleneck | MAS Sandbox-friendly; Project Guardian tokenised finance |
| 🇭🇰 Hong Kong | $65B+ | China-linked supply chain; USD stablecoin settlement demand; VASP licensing creating compliant moat | Project Ensemble; HashKey licensed exchange |
| 🇰🇷 South Korea | $40B+ | K-manufacturing exports (semis, autos, shipbuilding); 30–90 day DSOs standard | FSC digital asset framework; Monad Korea community |
| 🇯🇵 Japan | $80B+ | JPY weakness forcing exporters to hold USD receivables; SME digital adoption accelerating | 2023 Stablecoin Act; JFSA progressive stance |
| 🇻🇳🇮🇩🇹🇭 Southeast Asia | $300B+ | Manufacturing boom (China+1); cross-border SME invoices with no compliant digital settlement rail | $300B digital economy 2025 (Google/Temasek/Bain); RCEP trade corridors |

---

## Market Opportunity

Asia doesn't need another payments app. It needs a compliance-native yield layer.

Invoice financing in APAC is a **$300B+ serviceable market**. Capturing 0.1% of annual invoice volume at a 0.3% protocol fee generates $90M ARR — before yield management fees and enterprise licensing.

```
TAM   $2.5T   APAC trade finance gap
SAM   $300B   SME invoice financing, digital-ready
SOM   $3B     Year 3 target — Singapore, HK, Korea

SG    Launch market (MAS Sandbox)
HK    Year 1 expansion (HashKey / VASP)
KR    Year 2 (Monad home market)
JP    Year 2 (Stablecoin Act compliant)
SEA   Year 3 (RCEP corridors)
```

**Why now:**
- Monad's ~0.5s finality and 10k TPS makes real-time trade settlement viable for the first time
- Cleanverse CVI + CVA gives the institutional compliance layer other DeFi protocols lack
- MAS, HKMA, FSC progressively licensing stablecoin settlement in 2025–2026
- Post-RCEP: intra-ASEAN trade growing 12% YoY
- USD stablecoin (USDC, USDT) adoption in Asia reached 60M wallets (Chainalysis 2024)

---

## The Solution

**vino** tokenizes B2B invoices as ERC-721 NFTs on Monad, deposits them into a yield vault, and lets an autonomous AI agent autonomously select and execute the optimal yield strategy per invoice — all gated by Cleanverse CVI (identity) and CVA (verified asset) compliance.

```
Step 1 · IDENTITY   Wallet connects → query_apass checks KYB status in real-time
          ↓
Step 2 · ONBOARD    If unverified → generate_apass → MockCVI.verify() on Monad
          ↓
Step 3 · ASSET      query_deposit_atoken_list → select USDC / USDT / EURC CVA token
          ↓
Step 4 · MINT       Invoice NFT minted (ERC-721, keccak256 commitment) — CVI-gated
          ↓
Step 5 · YIELD      Deposited to YieldVault → AI agent assigns Hold / Conservative / Aggressive
          ↓
Step 6 · PAYMENT    create_payment_request → CVA-verified stablecoin settlement instructions
          ↓
Step 7 · AUDIT      download_travel_rule → FATF Rec-16 report auto-generated from mint TX
```

### Core Components

**InvoiceNFT · ERC-721**
Only `keccak256(data + salt)` stored on-chain. No plaintext invoice data on the public ledger — PDPA / PIPL compliant for Singapore and China cross-border use.

**YieldVault · Aave V3**
Hold (0%) · Conservative (3.5% APY) · Aggressive (7% APY). Strategy selected per-invoice by the MemoriVault agent based on risk score, market regime, and depositor's CVA eligibility.

**MemoriVault Agent**
L1 working context · L2 episodic memory (RAG recall) · L3 distilled rules. Calls `verify_apass` every 5-minute cycle — CVA gate always active at the agent layer. Powered by Qwen 70B + text-embedding-v3 (1024-dim).

**AgentRouter · On-chain**
Every AI strategy decision recorded on Monad via `recordDecision()`. 5-minute cooldown enforced. Pre-flight cooldown check avoids Monad's revert-as-OOG gas waste.

---

## CVI · CVA Integration — 7 Endpoints

Compliance is not a checkbox. It's the product moat.

Regulated Asian financial institutions cannot touch a DeFi protocol without KYB, AML, and Travel Rule support. vino is the only invoice financing protocol that integrates all three through a live Cleanverse API stack — making it the only option for bank partnerships and institutional distribution in APAC.

| # | Endpoint | Encoding | Role |
|---|---|---|---|
| 1 | `generate_apass` | AES-CBC | KYB registration; returns `cvRecordId` shown in compliance audit trail |
| 2 | `query_apass` | Plain JSON | Real-time A-Pass status on every page load; drives KYB gate on mint/deposit/settlement |
| 3 | `MockCVI.verify()` | On-chain tx | CVI relay on Monad; txHash surfaced as Monad Explorer link in audit trail |
| 4 | `query_deposit_atoken_list` | AES-CBC | USDC · USDT · EURC with issuer, `kybRequired`, per-wallet eligibility |
| 5 | `verify_apass` | AES-CBC | Per-wallet × per-token CVA eligibility; called at token selection **and** every agent cycle; forces Hold if A-Pass inactive |
| 6 | `create_payment_request` | AES-CBC | CVA-verified settlement instructions; source badge: live vs fallback |
| 7 | `download_travel_rule` | AES-CBC | FATF Rec-16 report; mint txHash auto-populated; mandatory for MAS PSN02 / HKMA VASP |

**Fallback hierarchy (all routes):** Cleanverse API → `MockCVI.isVerified()` on-chain → local structured format. Source always surfaced in the UI badge.

> MAS Notice PSN02 and HKMA's VASP licensing both require Travel Rule compliance for virtual asset transfers above $1,000. vino's auto-generated FATF Rec-16 report is the only path to institutional distribution in Singapore and Hong Kong.

---

## Revenue Model

Four streams, all denominated in CVA-settled stablecoins (USDC / USDT / EURC).

| Stream | Rate | TAM |
|---|---|---|
| Protocol fee on invoice volume | 0.20–0.50% per deposit | $300B SAM |
| Yield management spread | 10% of yield generated | $35M+ at $500M TVL |
| KYB-as-a-Service · enterprise licensing | $2K–$20K / month | B2B SaaS, ASEAN banks |
| Travel Rule report generation | $0.50–$5.00 / report | 800M+ APAC tx/yr |

### Year 1 · Singapore Launch
```
TVL Target      $5M
Invoice Volume  $12M / quarter
Protocol Fee    $72K ARR
Yield Spread    $35K ARR
Enterprise KYB  2 pilot banks
─────────────────────────────
Net Revenue     ~$150K ARR
```

### Year 3 · APAC Scale
```
TVL Target      $500M
Markets         SG · HK · KR · JP · SEA
Protocol Fee    $30M ARR
Yield Spread    $35M ARR
Enterprise KYB  $6M ARR
─────────────────────────────
Net Revenue     ~$71M ARR
```

---

## Technology

### Chain
| Property | Value |
|---|---|
| Network | Monad Testnet |
| Chain ID | 10143 |
| Finality | ~0.5 seconds |
| Throughput | 10,000 TPS |
| Gas formula | `baseFee × 1.2 + 1 Gwei` (reads live `block.baseFeePerGas`) |

### Agent Architecture
```
MemoriVault · Hierarchical Memory

L1  In-process Map
    Active context, market regime
    Cycle-scoped

L2  JSON episodic store (→ PostgreSQL)
    Past decisions + outcomes
    Qwen text-embedding-v3 · 1024-dim · RAG cosine recall

L3  Distilled semantic rules
    Pattern-extracted from L2 · Persistent across restarts

LLM:   Qwen 70B (Alibaba Cloud / DashScope)
Cycle: 5 min · nonce-mutex serialized
Gate:  verify_apass per deposit per cycle
```

### Key Technical Decisions

| Decision | Rationale |
|---|---|
| `baseFee × 1.2 + 1 Gwei` gas formula | Monad base fee ~100 Gwei; `getFeeData()` returns 2× = rejected. Dynamic from `block.baseFeePerGas`. |
| Nonce mutex (`txLock`) | `Promise.allSettled` concurrent analysis → same pending nonce → rejection. Mutex serializes all on-chain submissions. |
| Pre-flight cooldown check | `AgentRouter.decisionCooldown = 5 min`; Monad encodes contract reverts as "out of gas". Reading `lastAnalysis` first avoids wasted gas. |
| `ensureRouterConfig()` on startup | Contract `maxGasPrice = 100 Gwei` default causes auto-execute to silently skip. Raised to 500 Gwei at agent start. |
| AES-CBC for all write Cleanverse calls | API contract: write endpoints require encrypted body. Read endpoints use plain JSON. |
| Fallback hierarchy on all routes | Testnet UAT may not have all endpoints enabled; fallback to `MockCVI.isVerified()` then local format. Source always shown in UI. |
| `keccak256` commitment only on-chain | No plaintext invoice data on the public ledger — PDPA / PIPL compliant for APAC cross-border use. |

### Stack
`Next.js 15` · `Node.js Agent` · `Hardhat` · `wagmi / viem` · `Cleanverse API v5.6` · `Qwen Cloud` · `Docker` · `AWS CloudFront + EC2`

---

## Traction

- ✅ Live demo deployed: https://dkwc0vn4y827h.cloudfront.net
- ✅ 5 invoices active on Monad Testnet · $50K TVL · +$35 accrued yield (live)
- ✅ All 7 Cleanverse API endpoints integrated and tested end-to-end
- ✅ `MockCVI.verify()` on-chain relay live — txHash in compliance audit trail
- ✅ FATF Rec-16 Travel Rule report auto-generation working end-to-end
- ✅ AI agent (MemoriVault) running 5-min analysis cycles with on-chain decision recording
- ✅ 0 TypeScript errors · 0 ESLint warnings across 15K+ line monorepo
- ✅ CI/CD pipeline: Test → Docker Build+Push → SSH Deploy on every push to `main`

### Roadmap

| Date | Milestone |
|---|---|
| Aug 2026 | ✅ Hackathon MVP — 7 Cleanverse endpoints · Monad Testnet · AI agent · Travel Rule live |
| Q4 2026 | Singapore Pilot — MAS sandbox · 3 SME pilot customers · USDC CVA settlement live |
| Q2 2027 | HK + Korea Expansion — HashKey CVA integration · Korean SME corridors · Monad mainnet |
| 2028 | ASEAN + Japan — RCEP corridor coverage · $500M TVL target · KYB-as-a-Service enterprise |

---

## Demo Path (< 5 minutes)

1. **Connect wallet** — MetaMask on Monad Testnet (Chain ID 10143)
2. **CVI status badge** appears automatically via `query_apass`
3. **KYB onboard** — click "Complete KYB Verification" if not yet verified
   - `generate_apass` → `query_apass` → `MockCVI.verify()` on Monad
   - Banner turns green: Tier, expiry, on-chain tx hash + A-Pass record ID shown
4. **Mint invoice** — fill client name / amount / due date, select USDC (CVA) → mint NFT
5. **Invoice detail** — Compliance Audit Trail: CVI → Invoice → CVA → Payment → Travel Rule
   - CVI VERIFIED step: `record:<cvRecordId>` + clickable `MockCVI.verify()` tx Monad Explorer link
   - CVA Settlement panel: USDC badge + Monad Explorer contract link
6. **Request Payment** → source badge shows `create_payment_request ✓` or CVA local format
7. **Travel Rule** — TX hash auto-populated → click "generate"
   - Source badge: ✓ Cleanverse API or local format
   - Inline FATF Rec-16 preview: originator, beneficiary, CVA asset, compliance note
8. **Agent page** — watch live strategy decisions: CVI → CVA → MEM → LLM → GAS cycle

---

## The Ask

**$750K pre-seed · SAFE at $6M cap · 18-month runway**

MAS is actively issuing sandbox licenses for compliant digital asset platforms in 2026. The regulatory window that lets a protocol like vino enter Singapore's institutional market with a compliant first-mover advantage is open — and it won't stay open.

### Use of Funds
- Monad mainnet deployment and smart contract audit — $80K
- MAS sandbox licensing and Singapore legal — $120K
- Cleanverse production API integration and full CVA support — $60K
- 3 Singapore SME pilot customers and go-to-market — $150K
- Engineering team: 2 full-stack + 1 compliance engineer — $340K

### Why vino Wins
- **Compliance is the moat.** CVI + CVA + Travel Rule is a triple-lock no other DeFi invoice protocol has. Institutional distribution in Singapore and Hong Kong requires all three. We have all three, live.
- **Monad mainnet + Cleanverse production** infrastructure exists today. We are 6 months from revenue.
- **First-mover window.** MAS, HKMA, and FSC regulatory frameworks are going live in 2025–2026. This window won't wait.

---

## Contracts (Monad Testnet · Chain ID 10143)

Deployed `2026-07-30`. Authoritative source: `contracts/deployments/monadTestnet.json`

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

Explorer: https://testnet.monadexplorer.com
