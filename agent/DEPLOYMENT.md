# vino Agent — Production Deployment

The agent is deployed as a Docker container on an Ubuntu EC2 server via GitHub Actions. Each push to `main` automatically builds, pushes, and redeploys both the agent and the app.

---

## Overview

```
GitHub push to main
  → Job 1: lint + typecheck + test agent + lint app
  → Job 2: docker build Dockerfile.mcp → push <user>/vino-agent:latest
  → Job 3: SSH to Ubuntu server
           ├── preflight: docker info (fails fast if not in docker group)
           ├── validate ~/vino/.env.agent exists
           ├── docker pull vino-agent:latest
           ├── docker stop/rm vino-agent
           ├── docker run vino-agent (port 8080, --env-file, volume mount)
           └── wait for GET /health → 200 (max 2 min)
```

---

## Prerequisites

- Ubuntu 22.04 / 24.04 server (EC2 `t3.small` or larger recommended)
- Docker Hub account
- GitHub repository with Actions enabled

---

## One-Time Server Setup

SSH into the server and run the setup script:

```bash
bash scripts/server-setup.sh
```

Or fetch it directly:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/hoepeyemi/Vino/main/scripts/server-setup.sh)
```

### What the script does

1. Installs Docker (official repo) if not already installed
2. Adds the current user to the `docker` group
3. **Exits and asks you to log out + back in** so the group takes effect — then re-run
4. Creates `~/vino/agent-data/`
5. Writes `~/vino/.env.app` and `~/vino/.env.agent` stubs with contract addresses pre-filled
6. Generates an Ed25519 SSH deploy key at `~/.ssh/vino_deploy`
7. Adds the key to `~/.ssh/authorized_keys`
8. Opens UFW ports 22 (SSH), 3000 (app), 8080 (agent WebSocket)
9. Prints the 5 GitHub Secrets you need to add with their values

### After the script

Fill in the blank values:

```bash
nano ~/vino/.env.agent
nano ~/vino/.env.app
```

Strip any accidental trailing whitespace (Docker `--env-file` includes it):

```bash
sed -i 's/[[:space:]]*$//' ~/vino/.env.agent ~/vino/.env.app
```

---

## GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DOCKER_USERNAME` | Your Docker Hub username |
| `DOCKER_PASSWORD` | Docker Hub password or access token (hub.docker.com → Account Settings → Security → New Access Token) |
| `SSH_HOST` | Server public IP (e.g. `54.91.79.0`) |
| `SSH_USERNAME` | SSH user on the server (e.g. `ubuntu`) |
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/vino_deploy` (printed by setup script) |

No contract addresses or private keys go in GitHub secrets — those live only in `~/vino/.env.agent` on the server.

---

## Docker Permission Fix

If the CI pipeline fails with:

```
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

Run on the server:

```bash
sudo usermod -aG docker $USER
```

Then **log out and back in** (or start a new SSH session). The CI pipeline includes a preflight check that fails fast with this exact error message and fix instructions.

---

## Manual Deployment (without CI)

```bash
# Pull latest image
docker pull <your-dockerhub-user>/vino-agent:latest

# Stop and remove old container
docker stop vino-agent 2>/dev/null; docker rm vino-agent 2>/dev/null

# Ensure network and data directory exist
docker network create vino-net 2>/dev/null || true
mkdir -p ~/vino/agent-data

# Start agent
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

## Checking Logs and Status

```bash
# Live logs
docker logs -f vino-agent

# Check env vars loaded (hides keys)
docker exec vino-agent env | grep -v PRIVATE_KEY | grep -v API_KEY

# Health check
curl http://localhost:8080/health
# → {"status":"healthy","uptime":...,"deposits":5,"lastCycle":"..."}

# WebSocket test (requires wscat: npm install -g wscat)
wscat -c ws://localhost:8080
# → {"type":"status","payload":{"status":"connected"}}

# Via CloudFront
wscat -c wss://dkwc0vn4y827h.cloudfront.net/ws

# Check agent memory data
ls -la ~/vino/agent-data/
```

---

## Troubleshooting

### Agent crashes on startup

```bash
docker logs vino-agent 2>&1 | tail -50
```

Common causes:
- `AGENT_PRIVATE_KEY` missing or malformed (must be `0x` + 64 hex chars)
- `MONAD_TESTNET_RPC_URL` unreachable from the server
- `QWEN_API_KEY` invalid or quota exceeded
- Trailing whitespace in `.env.agent` values — fix: `sed -i 's/[[:space:]]*$//' ~/vino/.env.agent`

### Data not persisting across restarts

Check the volume mount is present and the host directory exists:

```bash
ls -la ~/vino/agent-data/
docker inspect vino-agent --format='{{json .Mounts}}' | jq
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

### WebSocket not reachable via CloudFront

Verify the `/ws*` behavior in CloudFront:
1. Origin must point to EC2 **port 8080** (not the default EC2 origin on 3000)
2. Cache policy must be **CachingDisabled** (not `UseOriginCacheControlHeaders`)
3. EC2 security group must allow inbound TCP 8080

---

## Authorizing the Agent Wallet On-Chain

The agent wallet must be authorized on `AgentRouter` before it can record decisions on-chain. Run this **once** after deploying, from the deployer wallet:

```bash
cast send 0x410494FC48f1cC24904fC3cc57F608ba498b12EA \
  "authorizeAgent(address)" \
  <AGENT_WALLET_ADDRESS> \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key <DEPLOYER_PRIVATE_KEY>
```

To find the agent wallet address from the private key:

```bash
cast wallet address <AGENT_PRIVATE_KEY>
```

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
