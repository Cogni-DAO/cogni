# syntax=docker/dockerfile:1.7-labs
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Multi-stage Dockerfile for Temporal scheduler-worker service
# Model B: transpile-only + runtime node_modules (avoids ESM bundling issues with pino/Temporal)

# ============================================================
# Stage 1: Build
# ============================================================
FROM node:22-bookworm-slim AS builder

# Install build tools for native modules (bufferutil, etc. from shared lockfile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm (pinned to match root package.json packageManager field)
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

WORKDIR /app

# Copy workspace config for dependency resolution
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY --parents packages/*/package.json ./
COPY --parents nodes/*/app/package.json ./
COPY --parents nodes/*/packages/*/package.json ./
COPY --parents services/scheduler-worker/package.json ./

# Install all dependencies (dev + prod) for build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --filter @cogni/scheduler-worker-service...

# Copy source files for packages that need to be built
COPY --parents packages/ids/ packages/ai-core/ packages/scheduler-core/ \
     packages/db-schema/ packages/db-client/ packages/attribution-ledger/ \
     packages/attribution-pipeline-contracts/ packages/attribution-pipeline-plugins/ \
     packages/ingestion-core/ packages/repo-spec/ packages/temporal-workflows/ ./
COPY --parents services/scheduler-worker/ ./

# Build packages in dependency order (transpile-only for service)
RUN pnpm --filter @cogni/ids build && \
    pnpm --filter @cogni/ai-core build && \
    pnpm --filter @cogni/scheduler-core build && \
    pnpm --filter @cogni/db-schema build && \
    pnpm --filter @cogni/attribution-ledger build && \
    pnpm --filter @cogni/attribution-pipeline-contracts build && \
    pnpm --filter @cogni/attribution-pipeline-plugins build && \
    pnpm --filter @cogni/ingestion-core build && \
    pnpm --filter @cogni/repo-spec build && \
    pnpm --filter @cogni/temporal-workflows build && \
    pnpm --filter @cogni/db-client build && \
    pnpm --filter @cogni/scheduler-worker-service build

# Prune to production dependencies only
RUN pnpm prune --prod

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:22-bookworm-slim AS runner

# Don't run as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker
USER worker

WORKDIR /app

# Copy transpiled output and node_modules (Model B)
# TODO: Replace this fragile multi-copy approach with `pnpm deploy` once we can
# run it without resolving the full workspace root.
# Current approach copies both root and service node_modules to preserve pnpm symlinks.
COPY --from=builder --chown=worker:nodejs /app/services/scheduler-worker/dist ./services/scheduler-worker/dist
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/services/scheduler-worker/node_modules ./services/scheduler-worker/node_modules
COPY --from=builder --chown=worker:nodejs /app/packages/ids/dist ./packages/ids/dist
COPY --from=builder --chown=worker:nodejs /app/packages/ai-core/dist ./packages/ai-core/dist
COPY --from=builder --chown=worker:nodejs /app/packages/scheduler-core/dist ./packages/scheduler-core/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db-schema/dist ./packages/db-schema/dist
COPY --from=builder --chown=worker:nodejs /app/packages/db-client/dist ./packages/db-client/dist
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-ledger/dist ./packages/attribution-ledger/dist
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-pipeline-contracts/dist ./packages/attribution-pipeline-contracts/dist
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-pipeline-plugins/dist ./packages/attribution-pipeline-plugins/dist
COPY --from=builder --chown=worker:nodejs /app/packages/ingestion-core/dist ./packages/ingestion-core/dist
COPY --from=builder --chown=worker:nodejs /app/packages/repo-spec/dist ./packages/repo-spec/dist
COPY --from=builder --chown=worker:nodejs /app/packages/temporal-workflows/dist ./packages/temporal-workflows/dist
COPY --from=builder --chown=worker:nodejs /app/packages/temporal-workflows/node_modules ./packages/temporal-workflows/node_modules
# Copy package.json files for module resolution
COPY --from=builder --chown=worker:nodejs /app/services/scheduler-worker/package.json ./services/scheduler-worker/
COPY --from=builder --chown=worker:nodejs /app/packages/ids/package.json ./packages/ids/
COPY --from=builder --chown=worker:nodejs /app/packages/ai-core/package.json ./packages/ai-core/
COPY --from=builder --chown=worker:nodejs /app/packages/scheduler-core/package.json ./packages/scheduler-core/
COPY --from=builder --chown=worker:nodejs /app/packages/db-schema/package.json ./packages/db-schema/
COPY --from=builder --chown=worker:nodejs /app/packages/db-client/package.json ./packages/db-client/
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-ledger/package.json ./packages/attribution-ledger/
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-pipeline-contracts/package.json ./packages/attribution-pipeline-contracts/
COPY --from=builder --chown=worker:nodejs /app/packages/attribution-pipeline-plugins/package.json ./packages/attribution-pipeline-plugins/
COPY --from=builder --chown=worker:nodejs /app/packages/ingestion-core/package.json ./packages/ingestion-core/
COPY --from=builder --chown=worker:nodejs /app/packages/repo-spec/package.json ./packages/repo-spec/
COPY --from=builder --chown=worker:nodejs /app/packages/temporal-workflows/package.json ./packages/temporal-workflows/

# Bake governance config for identity resolution (node_id, scope_id, chain_id)
COPY --chown=worker:nodejs .cogni/repo-spec.yaml ./.cogni/repo-spec.yaml

WORKDIR /app/services/scheduler-worker

ENV NODE_ENV=production

# Build metadata for /version endpoint (from build args)
ARG GIT_SHA=unknown
ARG BUILD_TS=unknown
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TS=${BUILD_TS}

# NOTE: No HEALTHCHECK instruction — probes defined in K8s manifests or Compose
CMD ["node", "dist/main.js"]
