# vino Frontend

Next.js frontend for vino, deployed on Monad Testnet.

## What this app does

- Mints invoice NFTs with privacy-preserving commitments
- Shows portfolio and invoice detail pages
- Connects to the AI agent over WebSocket
- Supports QuickBooks OAuth for invoice import
- Displays live yield data from the YieldVault contract

## Production deployment

- Live: [https://vino.eduworld.world](https://vino.eduworld.world)
- Health endpoint: [https://agent.eduworld.world/health](https://agent.eduworld.world/health)

The app is deployed as a Docker container via GitHub Actions CI/CD. See [DEPLOY.md](../DEPLOY.md) for the full setup.

## Contract addresses (Monad Testnet, chainId: 10143)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

Copy and fill in your local env:

```bash
cp .env.example .env
```

## Environment variables

### `.env.example` (reference)

```bash
# Contract addresses (Monad Testnet)
NEXT_PUBLIC_INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
NEXT_PUBLIC_YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
NEXT_PUBLIC_AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS=0x6872DC335eDF9A1525b005c38820641AdF78d9A1

# Agent WebSocket
NEXT_PUBLIC_AGENT_WS_URL=ws://localhost:8080

# App URL (used for QuickBooks OAuth redirect)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id

# Monad Testnet RPC fallbacks
NEXT_PUBLIC_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_MONAD_TESTNET_RPC_FALLBACK_1=https://monad-testnet.drpc.org
NEXT_PUBLIC_MONAD_TESTNET_RPC_FALLBACK_2=https://testnet-rpc.monad.xyz/

# QuickBooks OAuth (optional — falls back to demo mode)
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REDIRECT_URI=http://localhost:3000/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
```

### Important: `NEXT_PUBLIC_*` baking in Docker

`NEXT_PUBLIC_*` vars are embedded in the JS bundle at build time. In the Docker image:

- **Contract addresses** are baked directly with their real values in `Dockerfile.web`
- **`NEXT_PUBLIC_AGENT_WS_URL`**, **`NEXT_PUBLIC_APP_URL`**, and **`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`** are baked as placeholder strings and replaced at container startup via `docker-entrypoint.sh`
- Replacement runs on both client chunks (`.next/static/chunks/`) and server route bundles (`.next/server/`), so server-side API routes also get the correct values

## Invoice minting

The mint flow uses `writeContractAsync` directly — there is no `simulateContract` call. This is intentional:

- `simulateContract` + a `gasPrice` override creates a legacy EIP-155 (type-0) transaction
- On HTTPS production domains, MetaMask enforces EIP-1559 fee validation more strictly than localhost, causing type-0 txs to get stuck in mempool indefinitely
- `writeContractAsync` with no gas override lets the wallet use native EIP-1559 fee estimation, which works correctly on both localhost and production

## QuickBooks OAuth setup

1. Register your app at [developer.intuit.com](https://developer.intuit.com/)
2. Add `https://vino.eduworld.world/api/quickbooks/callback` as a redirect URI
3. Copy the client ID/secret into `~/vino/.env.app` on the server (no trailing spaces)
4. Set `QUICKBOOKS_ENVIRONMENT=sandbox` for testing, `production` for real data

## Build and scripts

```bash
pnpm dev       # Start dev server
pnpm build     # Production build
pnpm lint      # ESLint
pnpm tsc       # Type check
```
