# vino Contracts

Hardhat workspace for the vino protocol contracts on Monad Testnet.

---

## Deployed Contracts

**Network:** Monad Testnet · Chain ID `10143`  
**Deployed:** `2026-07-30T06:07:36Z`  
**Deployer:** `0x9404966338eB27aF420a952574d777598Bbb58c4`  
**Authoritative source:** [`deployments/monadTestnet.json`](deployments/monadTestnet.json)

| Contract | Address | Explorer |
|---|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` | [View](https://testnet.monadexplorer.com/address/0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3) |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` | [View](https://testnet.monadexplorer.com/address/0x827f01e7c3111cbB7b690E12B365eC0E14b144f6) |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` | [View](https://testnet.monadexplorer.com/address/0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5) |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` | [View](https://testnet.monadexplorer.com/address/0x410494FC48f1cC24904fC3cc57F608ba498b12EA) |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` | [View](https://testnet.monadexplorer.com/address/0x6872DC335eDF9A1525b005c38820641AdF78d9A1) |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` | [View](https://testnet.monadexplorer.com/address/0x70231d59379687CaBab203b99481baC7300a19ca) |

---

## Contract Overview

### MockCVI
Cleanverse CVI (A-Pass) gate for Monad Testnet.

- `isVerified(address) → bool` — view function; used by InvoiceNFT and YieldVault as KYB gate
- `verify(address)` — write function; called by the relay wallet during the Cleanverse onboarding flow (`POST /api/cleanverse/onboard` step 3)
- Owner is the deployer wallet (`RELAY_PRIVATE_KEY`)
- On mainnet, replace with the official Cleanverse on-chain CVI contract once deployed on Monad mainnet

### InvoiceNFT
ERC-721 tokenized invoices with privacy-preserving commitments.

- `mint(dataCommitment, amountCommitment, dueDate)` — CVI-gated; stores `keccak256(data + salt)` and `keccak256(amount + salt)` on-chain; no plaintext data stored
- `getActiveInvoices() → uint256[]` — returns all token IDs with status `Active` or `InYield`
- `getInvoice(tokenId)` — returns full invoice struct
- `updateStatus(tokenId, status)` — called by YieldVault when depositing/withdrawing
- `totalInvoices() → uint256` — returns `_nextTokenId` (count of all minted tokens)

### YieldVault
Aave V3 strategy router for invoice yield optimization.

- `deposit(tokenId, strategy, simulatedPrincipal)` — CVI-gated; transfers invoice NFT to vault, records principal, starts yield accrual
- `withdraw(tokenId)` — returns NFT to owner, pays accrued yield
- `getAccruedYield(tokenId) → uint256` — view function; computes `storedYield + (principal × APY × timeElapsed) / (365 days × 10000)`. Called by the server-side API route every 5 minutes.
- `totalValueLocked() → uint256` — sum of all deposit principals (18-decimal)
- `totalYieldGenerated() → uint256` — only increments on withdrawal; use `getAccruedYield` for live yield
- `getActiveDeposits() → uint256[]` and `getActiveDepositsCount() → uint256`
- Strategies: `Hold` (0%), `Conservative` (3.5% APY), `Aggressive` (7% APY)
- MAX_PRINCIPAL cap enforced per deposit

### AgentRouter
Records and executes AI-driven strategy decisions on-chain.

- `recordDecision(tokenId, strategy, confidence)` — authorized agent wallets only; enforces 5-min cooldown
- `authorizeAgent(address)` — owner only; must be called once after first deploy
- `getDecisionHistory(tokenId)` — returns array of past decisions
- `decisionCooldown` — 5 minutes between decisions per token (agent pre-checks `lastAnalysis` to avoid gas waste)
- `maxGasPrice` — raised to 500 Gwei by `ensureRouterConfig()` on agent startup (default 100 Gwei too low for Monad testnet base fee)

### PrivacyRegistry
Selective disclosure registry for invoice data reveals.

- `authorizeReveal(tokenId, address)` — invoice owner authorizes a specific address to see committed data
- Linked to InvoiceNFT by tokenId

### MockOracle
Price and risk feed stand-in (Monad testnet does not have Pyth deployed).

- Used by the agent to read MON/USD price and risk scores
- In production on mainnet, replace with Pyth oracle

---

## Architecture

```
                          MockCVI
                        (CVI Gate)
                        /        \
                       /          \
               InvoiceNFT      YieldVault ──► AgentRouter
                    |               |
             PrivacyRegistry   MockOracle
```

**Deployment wiring:**
1. MockCVI deployed → address recorded
2. InvoiceNFT deployed with `mockCVI` address → CVI gate active on `mint()`
3. YieldVault deployed with `invoiceNFT` + `mockCVI` addresses → CVI gate active on `deposit()`
4. AgentRouter deployed with `yieldVault` address → agent can record decisions
5. InvoiceNFT configured with `yieldVault` address → YieldVault can call `updateStatus()`
6. Agent wallet authorized: `AgentRouter.authorizeAgent(<agent wallet>)`

---

## Setup

```bash
cd contracts
npm install
npm run build
npm test
```

---

## Deployment

### Monad Testnet

```bash
npm run deploy:monad --prefix contracts
```

This deploys all 6 contracts, wires them together, enables the CVI gate, and writes the manifest to `deployments/monadTestnet.json`.

Required env var in `contracts/.env`:

```env
MONAD_PRIVATE_KEY=0x...   # deployer wallet private key
```

### Local Network (Anvil)

```bash
npm run deploy:local --prefix contracts
```

---

## Verification

```bash
npm run verify:monad-testnet --prefix contracts
```

Required env var:

```env
ETHERSCAN_API_KEY=your_monad_explorer_api_key
```

Verifies: MockCVI, InvoiceNFT, YieldVault, AgentRouter, PrivacyRegistry, MockOracle.

---

## After Redeployment

If you redeploy any contract:

1. Update `deployments/monadTestnet.json` with new addresses
2. Update `Dockerfile.web` ENV instructions with new contract addresses
3. Update `server/.env.agent` template with new addresses
4. Re-authorize the agent wallet: `AgentRouter.authorizeAgent(<agentWalletAddress>)`
5. Push to main — CI rebuilds and redeploys both containers with new addresses baked in

> **The deployment manifest is the canonical source of truth.** The app and agent derive all addresses from it.

---

## Notes

- `totalYieldGenerated` on YieldVault only increments on withdrawal — use `getAccruedYield(tokenId)` for live yield per deposit
- `getActiveInvoices()` returns all invoices with status `Active` or `InYield` — invoices in the vault are included
- `AgentRouter.decisionCooldown = 5 minutes` — the agent reads `lastAnalysis` before submitting to avoid gas-wasting reverts
- Monad encodes contract reverts as "out of gas" — always pre-flight check cooldowns and gate conditions before sending txs
