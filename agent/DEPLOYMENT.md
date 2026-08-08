# vino Agent — Production Deployment

The agent is deployed as a Docker container on an Ubuntu server via GitHub Actions. Each push to `main` automatically builds, pushes, and redeploys both the agent and the app.

---

## Overview

```
GitHub push to main
  → GitHub Actions: build Dockerfile.mcp → push to Docker Hub
  → SSH to Ubuntu server
  → pull new image
  → docker stop/rm vino-agent
  → docker run vino-agent with ~/vino/.env.agent
  → wait for /health
```

---

## Prerequisites

- Ubuntu server with Docker installed
- Docker Hub account
- GitHub repository with Actions enabled

---

## One-time server setup

SSH into your server and run:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Create directories
mkdir -p ~/vino/agent-data

# Create the agent env file (fill in real values)
cat > ~/vino/.env.agent << 'EOF'
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
WS_PORT=8080
DEPLOYMENT_NETWORK=monadTestnet
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca
AGENT_PRIVATE_KEY=0x...your-agent-wallet-key...
QWEN_API_KEY=sk-...your-qwen-key...
EOF

# Strip any accidental trailing whitespace (Docker --env-file includes it as part of the value)
sed -i 's/[[:space:]]*$//' ~/vino/.env.agent

# Create the Docker network shared by both containers
docker network create vino-net
```

---

## GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DOCKER_USERNAME` | Your Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token |
| `SSH_HOST` | Server IP or hostname |
| `SSH_USERNAME` | SSH user on the server |
| `SSH_PRIVATE_KEY` | Private key for SSH access |

No contract addresses or private keys go in GitHub secrets — those live in `~/vino/.env.agent` on the server.

---

## Manual deployment (without CI)

```bash
# On the server
docker pull <your-dockerhub-user>/vino-agent:latest

docker stop vino-agent 2>/dev/null; docker rm vino-agent 2>/dev/null

docker run -d \
  --name vino-agent \
  --restart unless-stopped \
  --network vino-net \
  -p 8080:8080 \
  --env-file ~/vino/.env.agent \
  -v ~/vino/agent-data:/app/agent/data \
  <your-dockerhub-user>/vino-agent:latest

# Verify health
curl http://localhost:8080/health
```

---

## Checking logs and status

```bash
# Live logs
docker logs -f vino-agent

# Check env vars loaded correctly
docker exec vino-agent env | grep -v PRIVATE_KEY

# Verify agent is connected to the right contracts
docker logs vino-agent 2>&1 | grep "contract\|address\|connected"

# Health check
curl http://localhost:8080/health

# WebSocket test (requires wscat)
npm install -g wscat
wscat -c ws://localhost:8080
# Expect: {"type":"status","payload":{"status":"connected"}}
```

---

## Troubleshooting

### Agent crashes on startup

Check for missing env vars:

```bash
docker logs vino-agent 2>&1 | tail -50
```

The most common causes:
- `AGENT_PRIVATE_KEY` is missing or malformed
- `MONAD_TESTNET_RPC_URL` is unreachable
- Trailing whitespace in `.env.agent` values — fix with `sed -i 's/[[:space:]]*$//' ~/vino/.env.agent`

### Data not persisting across restarts

Ensure the volume mount is included in the `docker run` command and the host directory exists:

```bash
ls -la ~/vino/agent-data/
```

### Agent can't reach the app container

Both containers must be on the same Docker network:

```bash
docker network inspect vino-net
# Both vino-agent and vino-app should appear under "Containers"
```

### `$USER` variable unset in SSH session

GitHub Actions SSH sessions are non-login shells where `$USER` may be unset. Use `$HOME` instead:

```bash
# Correct
$HOME/vino/.env.agent

# May fail
/home/$USER/vino/.env.agent
```

---

## Authorizing the agent wallet on-chain

The agent wallet must be authorized on `AgentRouter` before it can record decisions.
Run this once after deploying, replacing the addresses with the values from `contracts/deployments/monadTestnet.json`:

```bash
cast send 0x410494FC48f1cC24904fC3cc57F608ba498b12EA \
  "authorizeAgent(address)" \
  <AGENT_WALLET_ADDRESS> \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key <DEPLOYER_PRIVATE_KEY>
```

---

## Contract addresses (Monad Testnet)

| Contract | Address |
|---|---|
| MockCVI | `0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3` |
| InvoiceNFT | `0x827f01e7c3111cbB7b690E12B365eC0E14b144f6` |
| YieldVault | `0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5` |
| AgentRouter | `0x410494FC48f1cC24904fC3cc57F608ba498b12EA` |
| PrivacyRegistry | `0x6872DC335eDF9A1525b005c38820641AdF78d9A1` |
| MockOracle | `0x70231d59379687CaBab203b99481baC7300a19ca` |
