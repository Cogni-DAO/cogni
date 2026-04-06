---
id: task.0160
type: task
title: Scheduler-worker Dockerfile cache parity with app
status: done
priority: 1
rank: 1
estimate: 2
summary: Apply manifest-first Docker layering and BuildKit cache mounts to the scheduler-worker Dockerfile — matching patterns already proven in apps/operator/Dockerfile. Retains bookworm-slim (Temporal core-bridge requires glibc).
outcome: Scheduler-worker Docker builds use pnpm store cache mount, reducing warm-build dependency install to near-instant.
spec_refs: build-architecture-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: task/0160-scheduler-worker-dockerfile-cache-parity
pr: https://github.com/Cogni-DAO/node-template/pull/557
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-11
labels: [ci-cd, infra, performance]
external_refs:
---

# Scheduler-worker Dockerfile cache parity with app

## Requirements

- Scheduler-worker Dockerfile uses BuildKit syntax directive (`# syntax=docker/dockerfile:1.7-labs`)
- **Retains `node:22-bookworm-slim`** — `@temporalio/core-bridge` ships glibc-only prebuilt binaries (no musl/alpine variant exists as of v1.14.1)
- Package manifests copied via `COPY --parents packages/*/package.json ./` and `COPY --parents services/scheduler-worker/package.json ./` (not individual COPY lines)
- Source files copied via `COPY --parents packages/ ./` and `COPY --parents services/scheduler-worker/ ./` (not individual COPY lines)
- `pnpm install` uses `--mount=type=cache,id=pnpm-store` for cross-build caching
- `pnpm install` does NOT use `--ignore-scripts` — `bufferutil` needs `node-gyp-build` for native WebSocket perf (Temporal gRPC connections)
- Service still starts correctly (`node dist/main.js`) with all runtime dependencies
- NO `HEALTHCHECK` instruction (invariant `NO_DOCKERFILE_HEALTHCHECK`)
- Does NOT adopt `pnpm deploy` (that's a separate P2 deliverable)
- Retains Model B approach (transpile-only + runtime node_modules)

## Allowed Changes

- `services/scheduler-worker/Dockerfile` — primary change target
- `docs/spec/build-architecture.md` — add scheduler-worker to file pointers if appropriate

## Plan

- [ ] Add `# syntax=docker/dockerfile:1.7-labs` directive as first line
- [ ] Keep `node:22-bookworm-slim` for both stages (Temporal glibc requirement)
- [ ] Replace 11 individual `COPY packages/*/package.json` lines with `COPY --parents` wildcards
- [ ] Replace 11 individual `COPY packages/*` source lines with `COPY --parents` wildcards
- [ ] Add `--mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked` to `pnpm install`
- [ ] Keep install WITHOUT `--ignore-scripts` (bufferutil needs node-gyp-build for native WebSocket perf)
- [ ] Keep `--filter @cogni/scheduler-worker-service...` for scoped install (service should stay scoped)
- [ ] Verify: build the image locally and confirm it starts
- [ ] Run `pnpm check` for any lint/format issues in changed docs

## Validation

**Command:**

```bash
# Build the scheduler-worker image (the actual acceptance test)
docker build -f services/scheduler-worker/Dockerfile -t scheduler-worker:test .

# Verify second build is fast (cache hit on pnpm install)
docker build -f services/scheduler-worker/Dockerfile -t scheduler-worker:test .
```

**Expected:** Image builds successfully with cache mount working. Second build (no manifest changes) should show near-instant `pnpm install` step.

## Review Checklist

- [ ] **Work Item:** `task.0160` linked in PR body
- [ ] **Spec:** `NO_DOCKERFILE_HEALTHCHECK` upheld (no HEALTHCHECK instruction)
- [ ] **Spec:** `IMAGE_PER_SERVICE` upheld (still produces own OCI image)
- [ ] **Spec:** Model B retained (transpile-only + runtime node_modules)
- [ ] **Tests:** Docker build succeeds, image starts
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
