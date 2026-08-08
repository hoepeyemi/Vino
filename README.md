# vino

> Autonomous AI treasury for B2B invoices on Monad Testnet

vino turns invoices into on-chain assets, lets users mint and manage them in the frontend, and lets an AI agent monitor and execute strategy changes on-chain through the deployed contracts.

Live demo:
- [Frontend](https://vino.eduworld.world)

## Submission checklist

- Smart contracts are deployed on Monad Testnet
- Smart contracts are verified on Monad Explorer
- At least one AI-powered function is callable on-chain through the agent and AgentRouter flow
- Frontend is publicly accessible
- Deployment addresses are included below and in the deployment manifest
- Demo video should be at least 2 minutes and walk through the core use case
- README documents setup, architecture, and deployed addresses

## What vino does

1. User connects a wallet on Monad Testnet.
2. User mints an invoice NFT.
3. User deposits or manages the invoice in the yield vault flow.
4. The AI agent monitors invoices and can execute strategy changes on-chain.
5. The frontend shows portfolio, agent activity, invoice detail pages, and chain status.

## Architecture

- `app/` - Next.js frontend for minting, portfolio, issuer controls, and agent monitoring
- `agent/` - TypeScript WebSocket service that analyzes invoice state and executes actions
- `contracts/` - Hardhat workspace with the Monad Testnet smart contracts and verification scripts
- `contracts/deployments/monadTestnet.json` - canonical live deployment manifest

## Deployed contracts on Monad Testnet

Chain ID: `10143`

| Contract | Address | Status |
| --- | --- | --- |
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` | Verified |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` | Verified |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` | Verified |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` | Verified |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` | Verified |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` | Verified |

Deployment manifest:
- [`contracts/deployments/monadTestnet.json`](contracts/deployments/monadTestnet.json)

Explorer:
- [Monad Testnet Explorer](https://testnet.monadexplorer.com)

## Setup

### Prerequisites

- Node.js 18+
- pnpm
- MetaMask or another wallet connected to Monad Testnet

### Local development

```bash
pnpm install
pnpm dev
```

This starts the app and agent in parallel from the workspace root.

### Frontend

```bash
cd app
pnpm dev
```

### Agent

```bash
cd agent
pnpm dev
```

### Contracts

```bash
cd contracts
npm run build
npm test
npm run verify:monad-testnet
```

## Docker deployment

- [`Dockerfile.mcp`](Dockerfile.mcp) builds the agent image
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) handles agent tests and Docker deployment

Local build:

```bash
pnpm run docker:build:agent
```

## Network configuration

- Network: Monad Testnet
- Chain ID: `10143`
- Native token symbol: `MON`
- Frontend health endpoint: `/health`
- Agent health endpoint: `/health`

## Cleanverse KYB integration

vino uses the Cleanverse A-Pass Management module (API v5.6) to gate invoice minting and yield-vault deposits behind on-chain KYB verification.

**How it works**

1. User connects a wallet and navigates to the mint page.
2. The app calls `POST /api/cleanverse/verify` (server-side `query_apass`) to check the wallet's A-Pass status.
3. If not verified, a banner offers "Complete KYB Verification" which calls `POST /api/cleanverse/onboard`:
   - Generates an A-Pass via `POST /generate_apass` (AES-CBC encrypted body)
   - Confirms it's active via `POST /query_apass`
   - Calls `MockCVI.verify(wallet)` on-chain via a server-held relay key
4. `InvoiceNFT.mint()` and `YieldVault.deposit()` both check `MockCVI.isVerified(msg.sender)` — unverified wallets revert.

**Why MockCVI instead of the Cleanverse on-chain CVI**

The Cleanverse Validator module (on-chain CVI) is not yet deployed on Monad testnet. Only the A-Pass Management module is live. `MockCVI` is an owner-managed allowlist that implements the same `ICleanverseCVI` interface — it is wired to the real Cleanverse API for A-Pass checks; only the final on-chain record uses our own contract. When Cleanverse deploys their on-chain CVI to Monad mainnet, replacing `MockCVI` requires a single `setCVI()` call on `InvoiceNFT` and `YieldVault`.

**Admin KYB relay (manual)**

```bash
# Register an A-Pass for a wallet
WALLET=0xAbc... npm run generate-apass --prefix contracts

# Approve on-chain once A-Pass is confirmed
WALLET=0xAbc... npm run relay-kyb-approval --prefix contracts
```

## AI-powered on-chain function

The AI-powered path is the agent-to-contract flow:

- the agent observes invoice state and market data
- it decides whether to keep or change strategy
- it can write the decision through `AgentRouter`
- the result is recorded on-chain and visible in the frontend

## Notes

- The frontend is configured for Monad Testnet by default
- The repo is organized for public deployment, not localhost-only usage
