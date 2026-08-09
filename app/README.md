# vino Frontend

Next.js 15 App Router frontend for vino, deployed on Monad Testnet.

**Live:** [https://dkwc0vn4y827h.cloudfront.net](https://dkwc0vn4y827h.cloudfront.net)  
**Health:** [https://dkwc0vn4y827h.cloudfront.net/health](https://dkwc0vn4y827h.cloudfront.net/health)

---

## What this app does

- **Portfolio** (`/dashboard`) — Lists all active on-chain invoices with live yield, strategy, and APY. Loads public chain data without requiring wallet connection; wallet is only needed for write actions.
- **Mint** (`/dashboard/mint`) — CVI-gated invoice NFT minting with Cleanverse KYB flow; CVA token selection; QuickBooks invoice import
- **Invoice Detail** (`/dashboard/invoice/:tokenId`) — Full compliance audit trail: CVI → Invoice → CVA → Payment → Travel Rule
- **Agent** (`/dashboard/agent`) — Live AI agent decision feed, MemoriVault memory graph, Cleanverse integration health panel
- **Issuer** (`/dashboard/issuer`) — Issuer tools and KYB onboarding
- **Admin** (`/dashboard/admin`) — Protocol administration

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

## Local Development

```bash
cd app
cp .env.example .env   # fill in blanks
pnpm install
pnpm dev               # http://localhost:3000
```

---

## Environment Variables

### `.env.example` (reference)

```env
# Contract addresses (Monad Testnet) — already baked into Docker image
NEXT_PUBLIC_INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
NEXT_PUBLIC_YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
NEXT_PUBLIC_AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS=0x6872DC335eDF9A1525b005c38820641AdF78d9A1

# MockCVI
MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3
NEXT_PUBLIC_MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3

# Agent WebSocket (use wss:// in production, ws:// locally)
NEXT_PUBLIC_AGENT_WS_URL=ws://localhost:8080

# App URL (used for QuickBooks OAuth redirect)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id

# Monad Testnet RPC
NEXT_PUBLIC_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz

# Cleanverse KYB
CLEANVERSE_API_ID=your-institution-id
CLEANVERSE_API_KEY=your-base64-aes-key
CLEANVERSE_API_URL=https://uatapi.cleanverse.com/api/cooperate

# MockCVI relay (private key of the MockCVI contract owner)
RELAY_PRIVATE_KEY=0x...

# QuickBooks OAuth (optional — falls back to demo mode)
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_ENVIRONMENT=sandbox
```

---

## `NEXT_PUBLIC_*` Baking in Docker

`NEXT_PUBLIC_*` vars are embedded in the JS bundle at **build time**. The Docker build strategy:

| Variable group | Strategy |
|---|---|
| Contract addresses, chain ID, RPC URLs | Baked with **real values** in `Dockerfile.web` before `RUN pnpm build` |
| `NEXT_PUBLIC_AGENT_WS_URL` | Baked as `__VINO_AGENT_WS_URL__` placeholder; replaced at startup via `docker-entrypoint.sh` from `.env.app` |
| `NEXT_PUBLIC_APP_URL` | Baked as `__VINO_APP_URL__` placeholder; replaced at startup |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Baked as `__VINO_WC_PROJECT_ID__` placeholder; replaced at startup |

`docker-entrypoint.sh` runs `sed` replacement on both:
- Client chunks: `.next/static/chunks/*.js`
- Server bundles: `.next/server/**/*.js`

This means the 3 server-specific vars can be updated by editing `~/vino/.env.app` and restarting the container — no image rebuild needed.

---

## API Routes

| Route | Method | Description |
|---|---|---|
| `/api/invoices` | GET | Returns all active on-chain invoices with deposit + yield data. Reads public chain state — no wallet required. |
| `/api/cleanverse/verify` | POST | `query_apass` — checks A-Pass status for a wallet address |
| `/api/cleanverse/onboard` | POST | Full KYB flow: `generate_apass` → `query_apass` → `MockCVI.verify()` on-chain |
| `/api/cleanverse/atoken-list` | POST | `query_deposit_atoken_list` — returns USDC/USDT/EURC CVA tokens |
| `/api/cleanverse/verify-atoken` | POST | `verify_apass` — checks CVA eligibility per token per wallet |
| `/api/cleanverse/cva-payment` | POST | `create_payment_request` — creates CVA-compliant payment request |
| `/api/cleanverse/travel-rule` | POST | `download_travel_rule` — generates FATF Rec-16 report |
| `/api/quickbooks/auth` | GET | Initiates QuickBooks OAuth flow |
| `/api/quickbooks/callback` | GET | QuickBooks OAuth callback |
| `/api/quickbooks/invoices` | GET | Fetches invoices from connected QuickBooks account |
| `/health` | GET | Container health check |

---

## Invoice Minting

The mint flow uses `writeContractAsync` directly — no `simulateContract` call. This is intentional:

- `simulateContract` + a `gasPrice` override creates a legacy EIP-155 (type-0) transaction
- On HTTPS production domains, MetaMask enforces EIP-1559 fee validation more strictly than localhost, causing type-0 txs to get stuck in mempool indefinitely
- `writeContractAsync` with no gas override lets the wallet use native EIP-1559 fee estimation, which works correctly on both localhost and production HTTPS

The mint function additionally:
- Switches the wallet to Monad Testnet (chain 10143) if on the wrong chain before submitting
- Polls multiple RPC endpoints in parallel to confirm the receipt (Monad testnet can lag on a single node)
- Provides a "force settle" fallback after 3 min if wagmi's `useWaitForTransactionReceipt` doesn't resolve

---

## Invoice Metadata (localStorage)

The on-chain `InvoiceNFT` stores only `keccak256(data + salt)` and `keccak256(amount + salt)` commitments — no plaintext data on-chain. Client-side metadata is persisted to `localStorage` keyed by `tokenId`:

```typescript
{
  tokenId: string
  settlementToken: string        // CVA contract address
  settlementSymbol: string       // "USDC" | "USDT" | "EURC"
  settlementContractAddress: string
  mintTxHash: string             // auto-populates Travel Rule form
  cviTxHash: string              // MockCVI.verify() Monad tx → shown as Explorer link
  cviRecordId: string            // Cleanverse A-Pass record ID
  salt: string                   // keccak256 salt (for future selective disclosure)
}
```

`cviTxHash` + `cviRecordId` together form the end-to-end CVI proof chain in the compliance audit trail.

---

## QuickBooks OAuth Setup

1. Register at [developer.intuit.com](https://developer.intuit.com/)
2. Add `https://dkwc0vn4y827h.cloudfront.net/api/quickbooks/callback` as a redirect URI
3. Set `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` in `~/vino/.env.app`
4. Set `QUICKBOOKS_ENVIRONMENT=sandbox` for testing, `production` for real data
5. No trailing spaces — Docker `--env-file` includes whitespace as part of the value

---

## Build Scripts

```bash
pnpm dev        # Start dev server (http://localhost:3000)
pnpm build      # Production build
pnpm lint       # ESLint (0 warnings enforced in CI)
pnpm tsc        # TypeScript check (0 errors enforced in CI)
```

---

## Deployment

The app is deployed as a Docker container via GitHub Actions CI/CD. See [DEPLOY.md](../DEPLOY.md) for the full infrastructure setup including CloudFront configuration.
