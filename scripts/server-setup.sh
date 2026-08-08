#!/usr/bin/env bash
# Run once on a fresh Ubuntu 22.04/24.04 server as root or a sudo user.
# Usage: sudo bash server-setup.sh

set -euo pipefail

echo "=== vino server setup ==="

# ── Docker ─────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  apt-get update -q
  apt-get install -y --no-install-recommends ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -q
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "Docker installed."
else
  echo "Docker already installed: $(docker --version)"
fi

# Allow current user to run docker without sudo
DEPLOY_USER="${SUDO_USER:-$USER}"
if ! groups "$DEPLOY_USER" | grep -q docker; then
  usermod -aG docker "$DEPLOY_USER"
  echo "Added $DEPLOY_USER to the docker group (re-login or run: newgrp docker)"
fi

# ── App directory ───────────────────────────────────────────────────────────
APP_DIR="/home/${DEPLOY_USER}/vino"
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# ── .env.app ─────────────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env.app" ]; then
  cat > "$APP_DIR/.env.app" <<'EOF'
# ─────────────────────────────────────────────────────────────────────────────
# vino app — production environment
# All NEXT_PUBLIC_* values are injected into the pre-built JS bundle at
# container startup. Edit this file and redeploy to change them.
# ─────────────────────────────────────────────────────────────────────────────

# ── Blockchain ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_NETWORK_MODE=testnet

NEXT_PUBLIC_MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz

# ── Contract addresses ────────────────────────────────────────────────────────
NEXT_PUBLIC_INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
NEXT_PUBLIC_YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
NEXT_PUBLIC_AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
NEXT_PUBLIC_PRIVACY_REGISTRY_ADDRESS=0x6872DC335eDF9A1525b005c38820641AdF78d9A1
NEXT_PUBLIC_MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca

# ── Agent WebSocket — CHANGE to your server's public IP or domain ─────────────
NEXT_PUBLIC_AGENT_WS_URL=ws://YOUR_SERVER_IP:8080

# ── App URL — CHANGE to your server's public IP or domain ────────────────────
NEXT_PUBLIC_APP_URL=http://YOUR_SERVER_IP:3000

# ── WalletConnect — get a project ID at https://cloud.walletconnect.com/ ──────
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# ── QuickBooks OAuth (optional) ───────────────────────────────────────────────
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REDIRECT_URI=http://YOUR_SERVER_IP:3000/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env.app"
  chmod 600 "$APP_DIR/.env.app"
  echo "Created $APP_DIR/.env.app"
else
  echo "$APP_DIR/.env.app already exists — skipping."
fi

# ── .env.agent ───────────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env.agent" ]; then
  cat > "$APP_DIR/.env.agent" <<'EOF'
# ─────────────────────────────────────────────────────────────────────────────
# vino agent — production environment
# ─────────────────────────────────────────────────────────────────────────────

WS_PORT=8080

# Qwen Cloud API key (required for AI decisions)
QWEN_API_KEY=

# Wallet private key for on-chain transactions (no 0x prefix)
AGENT_PRIVATE_KEY=

# Monad Testnet RPC
MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz

# Deployed contract addresses
INVOICE_NFT_ADDRESS=0x827f01e7c3111cbB7b690E12B365eC0E14b144f6
YIELD_VAULT_ADDRESS=0xd4DE5d9DC3fFd4c728dE13aaE57C74628cd441b5
AGENT_ROUTER_ADDRESS=0x410494FC48f1cC24904fC3cc57F608ba498b12EA
MOCK_ORACLE_ADDRESS=0x70231d59379687CaBab203b99481baC7300a19ca
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env.agent"
  chmod 600 "$APP_DIR/.env.agent"
  echo "Created $APP_DIR/.env.agent"
else
  echo "$APP_DIR/.env.agent already exists — skipping."
fi

# ── Firewall ────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment "SSH"   2>/dev/null || true
  ufw allow 3000/tcp comment "vino app" 2>/dev/null || true
  ufw allow 8080/tcp comment "vino agent" 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
  echo "UFW firewall rules applied."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo "=== Setup complete ==="
echo ""
echo "Your server IP: $SERVER_IP"
echo ""
echo "REQUIRED — edit these two files before your first deploy:"
echo "  $APP_DIR/.env.app    ← fill in YOUR_SERVER_IP, WalletConnect ID, etc."
echo "  $APP_DIR/.env.agent  ← fill in ANTHROPIC_API_KEY, AGENT_PRIVATE_KEY"
echo ""
echo "REQUIRED — add these secrets to GitHub (Settings → Secrets → Actions):"
echo "  DOCKER_USERNAME   → your Docker Hub username"
echo "  DOCKER_PASSWORD   → Docker Hub access token (not your login password)"
echo "  SSH_HOST          → $SERVER_IP"
echo "  SSH_USERNAME      → $DEPLOY_USER"
echo "  SSH_PRIVATE_KEY   → contents of your private SSH key (~/.ssh/id_rsa)"
echo ""
echo "That's it. Push to main and CI will deploy automatically."
