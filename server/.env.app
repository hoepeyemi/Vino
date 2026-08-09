# ─────────────────────────────────────────────────────────────────────────────
# vino — Next.js app runtime env   (lives at ~/vino/.env.app on the server)
# DO NOT COMMIT.  Copy this file and fill in every blank value.
# The Docker container reads it with --env-file at startup.
# docker-entrypoint.sh replaces the three NEXT_PUBLIC_* placeholders that were
# baked in at build time and starts the Next.js server.
# ─────────────────────────────────────────────────────────────────────────────

# ── Server-specific public URLs ───────────────────────────────────────────────
# Replace <SERVER_IP> with your Ubuntu server's public IP (or domain).
# These are injected into the pre-built JS bundle at container startup.
NEXT_PUBLIC_AGENT_WS_URL=ws://<SERVER_IP>:8080
NEXT_PUBLIC_APP_URL=http://<SERVER_IP>:3000

# WalletConnect Cloud project ID — https://cloud.walletconnect.com/
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# ── Cleanverse KYB ───────────────────────────────────────────────────────────
# Required for live A-Pass KYB verification and CVA A-Token eligibility.
# Obtain from Cleanverse International.  Sandbox: uatapi.cleanverse.com
CLEANVERSE_API_ID=
CLEANVERSE_API_KEY=
CLEANVERSE_API_URL=https://uatapi.cleanverse.com/api/cooperate

# ── MockCVI on-chain relay ────────────────────────────────────────────────────
# The private key of the wallet that owns MockCVI (same as contracts PRIVATE_KEY
# used in: `npm run deploy:monad --prefix contracts`).
# Used by /api/cleanverse/onboard to call MockCVI.verify() on Monad Testnet.
RELAY_PRIVATE_KEY=

# MockCVI contract — deployed on Monad Testnet.
# Change only if you redeploy MockCVI to a different address.
MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3
NEXT_PUBLIC_MOCK_CVI_ADDRESS=0x98DbA1d179b013342C2f63Ef551Cf72de4bb64e3

# ── QuickBooks OAuth (optional) ───────────────────────────────────────────────
# Only needed for real QuickBooks invoice import.  Leave blank to skip.
# Register your redirect URI in Intuit Developer Portal:
#   http://<SERVER_IP>:3000/api/quickbooks/callback
QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_ENVIRONMENT=sandbox
