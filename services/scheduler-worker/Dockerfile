# syntax=docker/dockerfile:1.7-labs
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Multi-stage Dockerfile for Temporal scheduler-worker service.
# Pattern: turbo prune --docker → pnpm install (cacheable) → build → prod prune.
# turbo prune drops every workspace package outside scheduler-worker's
# transitive graph, so the runtime node_modules carries only what this
# service actually imports — not the whole monorepo.

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# ============================================================
# Stage 1: Prune workspace to scheduler-worker's transitive graph
# ============================================================
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.9.4 prune @cogni/scheduler-worker-service --docker

# ============================================================
# Stage 2: Install (cached on package.json + lockfile only)
# ============================================================
FROM base AS installer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-scripts

# ============================================================
# Stage 3: Build (transpile workspace packages + service) and
# emit a self-contained runtime tree via `pnpm deploy`.
# pnpm deploy resolves scheduler-worker's prod deps (workspace
# packages' dist + npm deps) into a single directory with no
# .pnpm-store hardlink bloat.
# ============================================================
FROM installer AS builder
COPY --from=pruner /app/out/full/ ./

RUN pnpm -r --filter @cogni/scheduler-worker-service... build

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm --filter @cogni/scheduler-worker-service deploy --prod /deploy

# ============================================================
# Stage 4: Production runner
# ============================================================
FROM node:22-bookworm-slim AS runner

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker
USER worker


WORKDIR /app

COPY --from=builder --chown=worker:nodejs /deploy ./
COPY --from=pruner --chown=worker:nodejs /app/.cogni ./.cogni

ENV NODE_ENV=production

ARG GIT_SHA=unknown
ARG BUILD_TS=unknown
ENV GIT_SHA=${GIT_SHA}
ENV BUILD_TS=${BUILD_TS}

CMD ["node", "dist/main.js"]
