# vino — Deployment Guide

Both the **app** and the **agent** are deployed as Docker containers to an Ubuntu server via GitHub Actions CI/CD.

---

## Contract Addresses (Monad Testnet)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

These are baked into `Dockerfile.web` as `ENV` vars so the client-side bundle uses the correct addresses without needing secrets in CI.

---

## Production Infrastructure

| Service | URL |
|---|---|
| App | `https://vino.eduworld.world` |
| Agent WebSocket | `ws://agent.eduworld.world` |
| Agent Health | `http://agent.eduworld.world/health` |
| Monad Testnet Explorer | `https://testnet.monadexplorer.com` |

Both containers run on the same Ubuntu server behind the `vino-net` Docker bridge network.

---

## GitHub Secrets Required

Set these once in **Settings → Secrets → Actions**:

| Secret | Description |
|---|---|
| `DOCKER_USERNAME` | Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `SSH_HOST` | Server IP or hostname |
| `SSH_USERNAME` | SSH login user |
| `SSH_PRIVATE_KEY` | Private key for SSH access |

No contract addresses, RPC URLs, or `NEXT_PUBLIC_*` values belong in GitHub secrets — they are either baked into the Docker image at build time or live in `~/vino/.env.app` on the server.

---

## Server Setup (one-time)

SSH into the server and run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/hoepeyemi/vino/main/scripts/server-setup.sh)
```

This installs Docker, creates the `~/vino/` directory, and generates `.env.app` and `.env.agent` stubs for you to fill in.

### `~/vino/.env.app`

```bash
# Contract addresses
NEXT_PUBLIC_INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
NEXT_PUBLIC_YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
NEXT_PUBLIC_AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS=0x6872DC335eDF9A1525b005c38820641AdF78d9A1

# Runtime-injected values (sed-replaced into JS bundle at container startup)
NEXT_PUBLIC_AGENT_WS_URL=ws://agent.eduworld.world
NEXT_PUBLIC_APP_URL=https://vino.eduworld.world
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id

# QuickBooks OAuth (optional)
QUICKBOOKS_CLIENT_ID=your-client-id
QUICKBOOKS_CLIENT_SECRET=your-client-secret
QUICKBOOKS_REDIRECT_URI=https://vino.eduworld.world/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
```

### `~/vino/.env.agent`

```bash
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
WS_PORT=8080
DEPLOYMENT_NETWORK=monadTestnet
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca
AGENT_PRIVATE_KEY=0x...
QWEN_API_KEY=sk-...
```

> **After first deploy**: call `AgentRouter.authorizeAgent(<AGENT_PRIVATE_KEY address>)` from the deployer wallet so the agent can write decisions on-chain.

> **Important**: No trailing spaces in any value — Docker's `--env-file` parser includes trailing whitespace as part of the value, causing silent failures (e.g. `clientId='undefined'` in QuickBooks OAuth).

---

## How CI/CD Works

On every push to `main`, the pipeline runs three jobs:

### Job 1 — Test
- Typechecks and tests the agent
- Runs a build smoke test

### Job 2 — Build & Push
- Builds `Dockerfile.web` → pushes as `<user>/vino-app:latest`
- Builds `Dockerfile.mcp` → pushes as `<user>/vino-agent:latest`
- Contract addresses and RPC URLs are baked in at build time (not secrets)
- Three `NEXT_PUBLIC_*` vars use placeholder strings replaced at runtime:
  - `__VINO_AGENT_WS_URL__` → `NEXT_PUBLIC_AGENT_WS_URL`
  - `__VINO_APP_URL__` → `NEXT_PUBLIC_APP_URL`
  - `__VINO_WC_PROJECT_ID__` → `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

### Job 3 — Deploy
- SSHes to the Ubuntu server
- Deploys agent first, waits for `/health`
- Deploys app, waits for `/health`
- Cleans up old images

---

## How `NEXT_PUBLIC_*` Variables Work in Production

`NEXT_PUBLIC_*` vars are baked into the JS bundle at build time — they cannot be changed at runtime via `.env.app`. The solution:

1. Three server-specific vars are baked as placeholder strings (e.g. `__VINO_AGENT_WS_URL__`)
2. All other `NEXT_PUBLIC_*` vars (RPC URLs, contract addresses) are baked with real values in `Dockerfile.web`
3. At container startup, `docker-entrypoint.sh` runs `sed` to replace the three placeholders in **both** client chunks (`/srv/standalone/app/.next/static/chunks/*.js`) and server route bundles (`/srv/standalone/app/.next/server/**/*.js`)

---

## Manual Deployment (without CI)

```bash
# On the server
docker pull <user>/vino-agent:latest
docker pull <user>/vino-app:latest

docker network create vino-net 2>/dev/null || true
mkdir -p ~/vino/agent-data

docker stop vino-agent vino-app 2>/dev/null; docker rm vino-agent vino-app 2>/dev/null

docker run -d --name vino-agent --restart unless-stopped \
  --network vino-net -p 8080:8080 \
  --env-file ~/vino/.env.agent \
  -v ~/vino/agent-data:/app/agent/data \
  <user>/vino-agent:latest

docker run -d --name vino-app --restart unless-stopped \
  --network vino-net -p 3000:3000 \
  --env-file ~/vino/.env.app \
  <user>/vino-app:latest
```

---

## Debugging

```bash
# Live logs
docker logs -f vino-app
docker logs -f vino-agent

# Check env vars are injected correctly
docker exec vino-app env | grep NEXT_PUBLIC
docker exec vino-app env | grep QUICKBOOKS

# Verify contract addresses in use
docker logs vino-app 2>&1 | grep "\[contracts/server\]"

# Verify placeholder replacement happened
docker logs vino-app 2>&1 | grep "\[entrypoint\]"

# Check agent data persistence
ls -la ~/vino/agent-data/
```

---

## Known Issues & Fixes Applied

| Issue | Fix |
|---|---|
| `Cannot find module '/app/server.js'` | Added `outputFileTracingRoot` in `next.config.ts`; standalone copies to `/srv/standalone/`; server starts with `node standalone/app/server.js` |
| `EACCES: permission denied, mkdir '/app/agent/data'` | `mkdir -p + chown` in Dockerfile before `USER` switch; volume mount persists data |
| `$USER` unset in SSH action | Use `$HOME` instead of `/home/$USER/vino` |
| `POST http://server:3000/ 405` | RPC placeholder treated as relative URL — RPC URLs now baked directly (not placeholders) |
| `__VINO_APP_URL__` in server routes | `docker-entrypoint.sh` now runs `sed` on both static chunks and `server/` route bundles |
| QuickBooks `clientId='undefined'` | Trailing spaces in `.env.app` — strip with `sed -i 's/[[:space:]]*$//'` |
| QuickBooks redirect URI mismatch | `QUICKBOOKS_REDIRECT_URI` must be `https://` not `http://` |
| Tx stuck in mempool | Removed `simulateContract` gasPrice injection (created legacy type-0 tx); now uses `writeContractAsync` with wallet-native EIP-1559 fee estimation |
| Invoice table empty / yield = $0 | Wrong contract addresses baked into image (old fallbacks); fixed by explicitly setting correct addresses in `Dockerfile.web` |
| UTF-8 BOM in JSON | PowerShell `WriteAllText` adds BOM prefix; fixed with `New-Object System.Text.UTF8Encoding $false` |
