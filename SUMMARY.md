# vino — One-Page Summary
**B2B Invoice Yield Protocol · Monad Testnet × Cleanverse CVI/CVA**
Cleanverse Build: Trusted Assets Hackathon · Track 01 RWA · Aug 2026

---

## Problem

SMEs issue invoices and wait 30–90 days for payment, locking working capital they cannot redeploy. The APAC trade finance gap reached **$2.5 trillion** in 2022 (Asian Development Bank), driven by bank rejection rates above 40% for SME applicants.

Existing on-chain invoice protocols address the yield opportunity but not the compliance requirement. Without KYB identity verification, verified-asset settlement, and Travel Rule reporting, they are inaccessible to regulated institutions — the very buyers whose purchasing volume creates the financing demand.

---

## Solution

vino tokenizes B2B invoices as ERC-721 NFTs on Monad, storing only a `keccak256(data + salt)` commitment on-chain — no plaintext invoice data on the public ledger. Each NFT is deposited into a yield vault with three strategy tiers: **Hold** (0%), **Conservative** (3.5% APY), **Aggressive** (7% APY).

An autonomous AI agent — MemoriVault — selects and executes the optimal strategy per invoice every five minutes, guided by on-chain risk scores, market regime analysis, Qwen 70B reasoning, and a three-tier hierarchical memory (L1 working context · L2 episodic RAG · L3 distilled rules). Every deposit and settlement is gated by Cleanverse **CVI** (Verified Identity) and **CVA** (Verified Assets), and every cross-border transfer auto-generates a **FATF Rec-16 Travel Rule** report from the mint transaction hash — no manual data entry required.

---

## CVI · CVA Integration Points

| # | Endpoint | Encoding | Role |
|---|---|---|---|
| 1 | `generate_apass` | AES-CBC | KYB registration; returns `cvRecordId` shown in compliance audit trail as Cleanverse proof anchor |
| 2 | `query_apass` | Plain JSON | Real-time A-Pass status on every page load; drives the KYB gate on mint, deposit, and settlement; renders as the CVI banner in nav |
| 3 | `MockCVI.verify()` | On-chain tx | CVI relay — API calls `MockCVI.verify(wallet)` on Monad; txHash stored as `cviTxHash`, shown as Monad Explorer link in audit trail; `isVerified()` gates mint and deposit at the contract level |
| 4 | `query_deposit_atoken_list` | AES-CBC | Returns CVA-approved settlement tokens — USDC · USDT · EURC — with issuer, `kybRequired`, and per-wallet eligibility flag |
| 5 | `verify_apass` | AES-CBC | Per-wallet × per-token CVA eligibility cross-check; called at token selection in UI **and** on every 5-minute agent analysis cycle; forces Hold strategy if A-Pass inactive |
| 6 | `create_payment_request` | AES-CBC | CVA-verified settlement instructions — `send_to` address, CVA asset, compliance note; source badge: ✓ Cleanverse API or local format |
| 7 | `download_travel_rule` | AES-CBC | FATF Rec-16 report; mint txHash auto-populated from localStorage; inline preview with originator, beneficiary, CVA asset; mandatory for MAS PSN02 / HKMA VASP |

**Fallback hierarchy (all routes):** Cleanverse API → `MockCVI.isVerified()` on-chain → local structured format. Source always surfaced in the UI.

---

## Deployed Chain

**Monad Testnet** · Chain ID `10143` · Finality ~0.5 s · 10,000 TPS · Deployed 2026-07-30

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

Explorer: https://testnet.monadexplorer.com  
Live demo: **https://dkwc0vn4y827h.cloudfront.net**
