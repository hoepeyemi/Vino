# vino Agent

The vino agent monitors the Monad Testnet deployment, analyzes invoice and yield state, and can trigger on-chain strategy updates through `AgentRouter`.

## What the agent does

- Reads deployed contract state from Monad Testnet
- Analyzes invoice risk and due dates
- Decides between conservative and aggressive yield strategies
- Broadcasts live status to the frontend over WebSocket
- Can execute approved strategy changes on-chain via `AgentRouter`

## Production deployment

- WebSocket: `ws://agent.eduworld.world`
- Health endpoint: `http://agent.eduworld.world/health`
- Default port: `8080`

The agent runs as a Docker container on Ubuntu via GitHub Actions CI/CD. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full setup.

## Contract addresses (Monad Testnet, chainId: 10143)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |

## Quick start (local)

```bash
cd agent
pnpm install
pnpm dev
```

## Docker (local)

Build from the repo root:

```bash
docker build -f Dockerfile.mcp -t vino-agent .
```

Run the container:

```bash
docker run -p 8080:8080 --env-file agent/.env.local vino-agent
```

## Required environment variables

```bash
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
WS_PORT=8080
DEPLOYMENT_NETWORK=monadTestnet

# Active contract addresses
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca

# Secrets — never commit these
AGENT_PRIVATE_KEY=0x...
QWEN_API_KEY=sk-...
```

## Agent data persistence

The agent writes persistent data (decisions, analysis history) to `/app/agent/data` inside the container. In production this is mounted to `~/vino/agent-data` on the host so data survives container restarts:

```bash
-v ~/vino/agent-data:/app/agent/data
```

## WebSocket API

**Connection**: `ws://localhost:8080` locally, `ws://agent.eduworld.world` in production

The agent broadcasts analysis, execution, and error messages to the frontend dashboard. See [docs/TECHNICAL_MVP.md](../docs/TECHNICAL_MVP.md) for the full message protocol.

## Production notes

- Keep `AGENT_PRIVATE_KEY` only in `~/vino/.env.agent` on the server — never in the frontend or in GitHub secrets
- The Docker container exposes `/health` for readiness checks
- Agent data is persisted via volume mount; the directory must exist on the host before the container starts
- See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full Ubuntu + GitHub Actions setup

## Deployment

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Ubuntu server + Docker + GitHub Actions
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) — CI/CD pipeline
