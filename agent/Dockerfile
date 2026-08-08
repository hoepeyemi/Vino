FROM node:20-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build && pnpm prune --prod

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system nodejs && useradd --system --gid nodejs agentuser

WORKDIR /app

COPY --from=base --chown=agentuser:nodejs /app/dist ./dist
COPY --from=base --chown=agentuser:nodejs /app/node_modules ./node_modules
COPY --from=base --chown=agentuser:nodejs /app/package.json ./

RUN mkdir -p /app/data && chown agentuser:nodejs /app/data

USER agentuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]
