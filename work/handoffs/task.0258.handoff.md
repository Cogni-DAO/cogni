# Handoff: Multi-Node Stack Test Infra + CI Pipeline Analysis

**Branch:** `feat/task-0258-multi-node-stack-tests`
**Date:** 2026-04-02
**Status:** Tests passing, CI deploy pipeline needs `COGNI_NODE_ENDPOINTS`
**PR:** https://github.com/Cogni-DAO/node-template/pull/691

---

## What Was Built

6 multi-node billing isolation stack tests proving per-node callback routing, DB isolation, idempotency, and auth. Custom LiteLLM callback class (`CogniNodeRouter`) routes billing callbacks per-node. VCS tool bindings added to poly/resy to unblock node boot.

## Current Pipeline (Single-Node)

```
staging branch push
  → staging-preview.yml
    → build: apps/operator/Dockerfile (runner + migrator) + scheduler-worker
    → test-image.sh (/livez)
    → push.sh (GHCR)
    → deploy.sh (SSH to preview VM, docker compose up)
    → e2e (Playwright against deployed preview)
    → promote (create release/* → main PR)

main branch push
  → build-prod.yml
    → same builds, push to GHCR
    → NO deploy

build-prod.yml success
  → deploy-production.yml
    → resolve scheduler-worker digest
    → deploy.sh (SSH to production VM)
```

## What's Broken / Stale Right Now

| Issue                                                                      | Severity     | Detail                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COGNI_NODE_ENDPOINTS` not in staging-preview.yml or deploy-production.yml | **High**     | LiteLLM's `CogniNodeRouter` requires this. Compose passes `${COGNI_NODE_ENDPOINTS}` but no workflow sets it. Deploy will fail on litellm startup with `RuntimeError`. |
| `COGNI_NODE_DBS` not in any workflow                                       | **Medium**   | DB provisioning defaults to `cogni_operator` (single-node), which works. But not explicit.                                                                            |
| LiteLLM image unversioned                                                  | **Medium**   | `cogni-litellm:latest` built by compose, not pushed to GHCR. No digest pinning like scheduler-worker.                                                                 |
| No poly/resy image builds                                                  | **Expected** | Task.0247 scope — nodes aren't deployed yet.                                                                                                                          |
| No multi-node compose services                                             | **Expected** | Task.0247 scope.                                                                                                                                                      |

## Immediate Fix Needed

`COGNI_NODE_ENDPOINTS` must be set in deploy workflows or litellm crashes at startup. For single-node deploy (current production):

```
COGNI_NODE_ENDPOINTS=4ff8eac1-4eba-4ed0-931b-b1fe4f64713d=http://app:3000/api/internal/billing/ingest
```

Add to `staging-preview.yml` and `deploy-production.yml` as deploy-time env var (hardcoded or GitHub secret).

## What task.0247 Needs to Add (Future)

1. Build poly/resy Docker images in workflows
2. Add poly/resy services to `docker-compose.yml`
3. Expand `COGNI_NODE_ENDPOINTS` to include all node endpoints
4. Expand `COGNI_NODE_DBS` for per-node databases
5. Version and push `cogni-litellm` image to GHCR (digest-pinned like scheduler-worker)
6. Per-node deploy orchestration in `deploy.sh`

## Key Files

**Workflow files:**

- `.github/workflows/staging-preview.yml`
- `.github/workflows/build-prod.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/ci.yaml`

**Build scripts:**

- `scripts/ci/build.sh` — builds APP_IMAGE + MIGRATOR_IMAGE from `apps/operator/Dockerfile`
- `scripts/ci/build-service.sh` — builds scheduler-worker
- `scripts/ci/push.sh` — pushes all images to GHCR, captures digest refs
- `scripts/ci/deploy.sh` — SSH remote deploy via docker compose
- `scripts/ci/test-image.sh` — liveness gate (/livez)

**Dockerfiles (built today):**

- `apps/operator/Dockerfile` (app + migrator)
- `services/scheduler-worker/Dockerfile`
- `infra/litellm/Dockerfile` (custom callback, built by compose not CI)

**Dockerfiles (NOT built — task.0247):**

- `nodes/poly/app/Dockerfile`
- `nodes/resy/app/Dockerfile`

**Callback routing:**

- `infra/litellm/cogni_callbacks.py` — `CogniNodeRouter` reads `COGNI_NODE_ENDPOINTS`, routes per `node_id`
- `infra/compose/runtime/configs/litellm.config.yaml` — `callbacks: cogni_callbacks.cogni_node_router`

## Test Verification

```bash
# Single-node (all billing tests pass)
pnpm dev:stack:test
pnpm test:stack:dev

# Multi-node (all 6 isolation tests pass)
pnpm dev:stack:test:full
pnpm test:stack:multi
```

## Related Tasks

- **task.0256** — per-node billing pipeline (DB + auth + callback routing) — done
- **task.0257** — node identity via repo-spec UUIDs — done
- **task.0258** — this task (multi-node stack tests) — needs_merge
- **task.0260** — monorepo CI pipeline (Turbo affected + multi-node test lane) — needs_design
- **task.0247** — multi-node CICD deployment (CD, builds, compose services) — needs_design
