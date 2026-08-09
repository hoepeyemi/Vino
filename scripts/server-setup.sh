#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# vino — Ubuntu server one-shot setup script
#
# Run ONCE on a fresh Ubuntu 22.04 / 24.04 server as a non-root sudo user:
#   bash scripts/server-setup.sh
#
# What it does:
#   1. Installs Docker (official repo) if not present
#   2. Creates ~/vino/ with .env.app and .env.agent pre-filled with defaults
#   3. Generates an Ed25519 SSH deploy key for CI
#   4. Opens UFW firewall ports 22/3000/8080
#   5. Prints the 5 GitHub Actions secrets you need to add
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn] ${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && err "Run as a normal user with sudo privileges, not as root."
command -v curl &>/dev/null || sudo apt-get install -y curl

# ── 1. Install Docker ─────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  warn "IMPORTANT: Log out and back in (or run: newgrp docker) for the docker"
  warn "group to take effect, then re-run this script."
  exit 0
fi
docker info &>/dev/null || { warn "Docker daemon not ready — re-login and re-run."; exit 0; }

# ── 2. Detect server IP ────────────────────────────────────────────────────────
SERVER_IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
log "Public IP: $SERVER_IP"

VINO_DIR="$HOME/vino"
mkdir -p "$VINO_DIR/agent-data"
log "Created $VINO_DIR"

# ── 3. Write .env.app ─────────────────────────────────────────────────────────
APP_ENV="$VINO_DIR/.env.app"
if [[ -f "$APP_ENV" ]]; then
  warn ".env.app already exists — skipping (delete it to regenerate)"
else
  log "Writing $APP_ENV..."
  cat > "$APP_ENV" << EOF
# ─────────────────────────────────────────────────────────────────────────────
# vino Next.js app — runtime env    (generated $(date -u '+%Y-%m-%d %H:%M UTC'))
# Fill in every blank value, then push to main to deploy.
# ─────────────────────────────────────────────────────────────────────────────

# ── Server URLs (injected into pre-built JS bundle at startup) ────────────────
NEXT_PUBLIC_AGENT_WS_URL=ws://${SERVER_IP}:8080
NEXT_PUBLIC_APP_URL=http://${SERVER_IP}:3000

# WalletConnect Cloud project ID → https://cloud.walletconnect.com/
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# ── Cleanverse KYB ───────────────────────────────────────────────────────────
CLEANVERSE_API_ID=
CLEANVERSE_API_KEY=
CLEANVERSE_API_URL=https://uatapi.cleanverse.com/api/cooperate

# ── MockCVI on-chain relay ────────────────────────────────────────────────────
# Private key of the wallet that OWNS MockCVI (same key used in: npm run deploy:monad)
# Must be: 0x + 64 hex chars
RELAY_PRIVATE_KEY=
MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3
NEXT_PUBLIC_MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3

# ── QuickBooks (optional) ─────────────────────────────────────────────────────
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_ENVIRONMENT=sandbox
EOF
  chmod 600 "$APP_ENV"
  warn "Edit $APP_ENV and fill in the blank values."
fi

# ── 4. Write .env.agent ───────────────────────────────────────────────────────
AGENT_ENV="$VINO_DIR/.env.agent"
if [[ -f "$AGENT_ENV" ]]; then
  warn ".env.agent already exists — skipping (delete it to regenerate)"
else
  log "Writing $AGENT_ENV..."
  cat > "$AGENT_ENV" << EOF
# ─────────────────────────────────────────────────────────────────────────────
# vino MemoriVault agent — runtime env  (generated $(date -u '+%Y-%m-%d %H:%M UTC'))
# Fill in every blank value.
# ─────────────────────────────────────────────────────────────────────────────

# ── RPC ───────────────────────────────────────────────────────────────────────
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz

# ── Agent wallet ──────────────────────────────────────────────────────────────
# 0x + 64 hex chars.  Omit for read-only (no on-chain txs) mode.
AGENT_PRIVATE_KEY=

# ── AI — Qwen Cloud ──────────────────────────────────────────────────────────
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# ── WebSocket ─────────────────────────────────────────────────────────────────
WS_PORT=8080

# ── Contract addresses (Monad Testnet — chain 10143) ──────────────────────────
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca

# ── Cleanverse KYB (optional — same creds as app) ────────────────────────────
CLEANVERSE_API_ID=
CLEANVERSE_API_KEY=
CLEANVERSE_API_URL=https://uatapi.cleanverse.com/api/cooperate
EOF
  chmod 600 "$AGENT_ENV"
  warn "Edit $AGENT_ENV and fill in the blank values."
fi

# ── 5. SSH deploy key ─────────────────────────────────────────────────────────
DEPLOY_KEY="$HOME/.ssh/vino_deploy"
if [[ -f "$DEPLOY_KEY" ]]; then
  warn "Deploy key already exists at $DEPLOY_KEY — skipping"
else
  log "Generating Ed25519 SSH deploy key..."
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -C "vino-ci@$(hostname)" -f "$DEPLOY_KEY" -N ""
  cat "${DEPLOY_KEY}.pub" >> "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  log "Deploy key created and authorized."
fi

# ── 6. Firewall ───────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  log "Configuring UFW..."
  sudo ufw allow OpenSSH   >/dev/null 2>&1 || true
  sudo ufw allow 3000/tcp  >/dev/null 2>&1 || true
  sudo ufw allow 8080/tcp  >/dev/null 2>&1 || true
  sudo ufw --force enable  >/dev/null 2>&1 || true
  sudo ufw status | grep -E "22|3000|8080"
fi

# ── 7. Summary ────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  DONE — add these 5 secrets in GitHub:${NC}"
echo -e "${CYAN}  repo → Settings → Secrets and variables → Actions → New secret${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}DOCKER_USERNAME${NC}    Your Docker Hub username"
echo -e "  ${YELLOW}DOCKER_PASSWORD${NC}    Docker Hub access token"
echo -e "                     hub.docker.com → Account Settings → Security → New Access Token"
echo ""
echo -e "  ${YELLOW}SSH_HOST${NC}           ${SERVER_IP}"
echo -e "  ${YELLOW}SSH_USERNAME${NC}       $(whoami)"
echo -e "  ${YELLOW}SSH_PRIVATE_KEY${NC}    (paste the entire block below)"
echo ""
echo -e "${CYAN}── SSH_PRIVATE_KEY value (copy everything between the lines) ───${NC}"
cat "$DEPLOY_KEY"
echo -e "${CYAN}────────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "${GREEN}After adding secrets:${NC}"
echo "  1. Fill blanks in:"
echo "       nano $APP_ENV"
echo "       nano $AGENT_ENV"
echo "  2. Push any commit to main → CI builds images → deploys to this server"
echo ""
echo -e "${GREEN}Manual redeploy (no CI):${NC}"
echo "  cd $VINO_DIR"
echo "  DOCKER_USERNAME=<hub-user> docker compose pull && docker compose up -d"
echo ""
