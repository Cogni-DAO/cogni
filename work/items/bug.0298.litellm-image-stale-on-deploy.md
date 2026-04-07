---
id: bug.0298
type: bug
title: "LiteLLM image never rebuilt on deploy — cogni_callbacks.py changes silently lost"
status: needs_implement
priority: 0
rank: 1
estimate: 2
summary: "deploy-infra.sh runs `docker compose up -d` without `--build`, so the locally-built cogni-litellm:latest image is never rebuilt when code changes. PR #812 fixed the Dockerfile but the stale image stayed, causing billing callback 404s on canary."
outcome: "LiteLLM image is built in CI, pushed to GHCR with digest pinning, and pulled on deploy — same pipeline as all other images. Code changes to infra/images/litellm/ are guaranteed to reach deployed environments."
spec_refs:
  - docs/spec/cd-pipeline-e2e.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/litellm-ghcr-publish
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [ci-cd, billing, litellm, deployment]
external_refs:
  - "https://github.com/Cogni-DAO/node-template/pull/812"
---

# LiteLLM Image Never Rebuilt on Deploy

## Observed

PR #812 added `extra_hosts` to the LiteLLM compose service AND fixed a double-path bug in `cogni_callbacks.py` (line 138: check before appending `/api/internal/billing/ingest`). After merge to canary:

1. `deploy-infra.sh` rsyncs updated files to VM (Dockerfile, cogni_callbacks.py, docker-compose.yml)
2. Runs `docker compose up -d litellm` — **no `--build` flag**
3. Compose sees existing `cogni-litellm:latest` image → reuses it without rebuilding
4. Container gets new `extra_hosts` (compose-level) but OLD `cogni_callbacks.py` (baked in image)
5. Old callback always appends `/api/internal/billing/ingest` to URLs that already contain it
6. Result: POST to `http://host.docker.internal:30000/api/internal/billing/ingest/api/internal/billing/ingest` → **404**

**Verified via SSH on canary** (2026-04-07T00:55 UTC):

- `docker inspect cogni-runtime-litellm-1` → image created 2026-04-06T02:19 (pre-PR #812)
- Container code: `ingest_url = endpoint.rstrip("/") + "/api/internal/billing/ingest"` (old, always appends)
- Repo code: `ingest_url = base if "/api/internal/billing/ingest" in base else base + "/api/internal/billing/ingest"` (new, checks first)
- Manual test from inside container with correct URL → 200. Callback constructs wrong URL → 404.

## Root Cause

LiteLLM is the **only image built locally on the VM** instead of in CI. The `build:` directive in docker-compose.yml builds on first `up -d`, but subsequent deploys reuse the cached image. This is spec gap **G12** in `cd-pipeline-e2e.md`:

> G12: LiteLLM image not versioned/pushed to GHCR — Medium — `cogni-litellm:latest` built by Compose locally — Build in CI, push to GHCR with digest pinning

## Design

### Outcome

LiteLLM image follows the same publish-pull-pin pipeline as all other images. Changes to `infra/images/litellm/` are built in CI and deployed via the existing promote-and-deploy workflow.

### Approach

**Solution**: Add litellm to `build-multi-node.yml` CI build, push to GHCR, pull on deploy.

Three changes:

1. **`build-multi-node.yml`** — Add a `build-litellm` step in `build-services` job
2. **`promote-and-deploy.yml`** — Resolve litellm digest, pass to deploy-infra
3. **`deploy-infra.sh`** — Pull GHCR image, write LITELLM_IMAGE to .env
4. **`docker-compose.yml`** — Switch from `build:` to `image: ${LITELLM_IMAGE}`

**Reuses**: Existing `build-push-action@v6`, GHCR login, GHA cache, rsync deploy flow.

**Rejected**:

- **`--build` flag on compose up**: Bandaid. Still builds on VM (slow), not reproducible, no digest pinning.
- **Separate workflow for litellm**: Over-engineered. Fits naturally in existing `build-services` job.

### Invariants

- [ ] IMAGE_IMMUTABILITY: GHCR image uses `@sha256:` digest, not `:latest`
- [ ] LOCAL_DEV_UNAFFECTED: `pnpm dev:stack` still builds litellm locally via docker-compose.dev.yml
- [ ] ROLLING_UPDATE_NO_DOWN: deploy-infra.sh pulls new image then `up -d` — no `down` step
- [ ] CALLBACK_CODE_DEPLOYED: cogni_callbacks.py changes reach all environments via CI build

## Validation

1. Merge to canary → `build-multi-node` builds litellm image → GHCR push succeeds
2. `promote-and-deploy` → `deploy-infra.sh` pulls litellm from GHCR (not local build)
3. Send chat on canary → Loki: `{env="canary", service="litellm"} |~ "Billing ingest failed"` returns zero hits
4. Loki: `{env="canary", service="app"} |~ "ai.llm_call_completed"` shows `providerCostUsd > 0`
5. `pnpm dev:stack` still works locally (docker-compose.dev.yml builds litellm from source)

## PR / Links

- Caused by: architecture gap (G12 in cd-pipeline-e2e.md)
- Surfaced by: PR #812 (fix/litellm-dns-host-gateway)
- Related: bug.0261 (CogniNodeRouter reliability gaps)
