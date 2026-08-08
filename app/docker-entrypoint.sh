#!/bin/sh
# Replaces build-time placeholder strings in the Next.js JS bundle with the
# actual values from the container's env (sourced from .env.app on the server).
# Only the three server-specific vars need this — RPC URLs are baked in directly.
set -e

CHUNK_DIR="/srv/standalone/app/.next/static/chunks"
SERVER_DIR="/srv/standalone/app/.next/server"

if [ ! -d "$CHUNK_DIR" ]; then
  echo "[entrypoint] ERROR: chunk directory not found: $CHUNK_DIR"
  ls /srv/standalone/app/.next/static/ 2>/dev/null || echo "static dir missing"
  exit 1
fi

replace() {
  local placeholder="$1"
  local value="$2"
  local label="$3"
  if [ -z "$value" ]; then
    echo "[entrypoint] WARN: $label is empty — placeholder $placeholder left in bundle"
    return
  fi
  # Replace in client chunks (browser JS)
  client_count=$(find "$CHUNK_DIR" -name "*.js" -exec grep -l "$placeholder" {} + 2>/dev/null | wc -l)
  find "$CHUNK_DIR" -name "*.js" -exec sed -i "s|${placeholder}|${value}|g" {} +
  # Replace in server route bundles (API routes bake NEXT_PUBLIC_* vars too)
  server_count=$(find "$SERVER_DIR" -name "*.js" -exec grep -l "$placeholder" {} + 2>/dev/null | wc -l)
  find "$SERVER_DIR" -name "*.js" -exec sed -i "s|${placeholder}|${value}|g" {} +
  echo "[entrypoint] replaced $placeholder → $value (client: $client_count, server: $server_count file(s))"
}

replace "__VINO_AGENT_WS_URL__"  "${NEXT_PUBLIC_AGENT_WS_URL}"              "NEXT_PUBLIC_AGENT_WS_URL"
replace "__VINO_APP_URL__"        "${NEXT_PUBLIC_APP_URL}"                   "NEXT_PUBLIC_APP_URL"
replace "__VINO_WC_PROJECT_ID__"  "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}"  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"

echo "[entrypoint] starting Next.js server..."
exec node /srv/standalone/app/server.js
