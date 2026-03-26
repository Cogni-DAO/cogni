# ── Build stage ──
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY services/akash-deployer/package.json services/akash-deployer/

RUN pnpm install --frozen-lockfile --filter @cogni/akash-deployer-service...

COPY services/akash-deployer/ services/akash-deployer/

RUN pnpm --filter @cogni/akash-deployer-service build

# ── Runtime stage ──
FROM node:22-alpine AS runtime

RUN apk add --no-cache curl tini

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/services/akash-deployer/dist ./services/akash-deployer/dist
COPY --from=builder /app/services/akash-deployer/package.json ./services/akash-deployer/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

ENV NODE_ENV=production
EXPOSE 9100

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "services/akash-deployer/dist/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:9100/livez || exit 1
