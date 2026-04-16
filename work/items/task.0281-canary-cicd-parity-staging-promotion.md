---
id: task.0281
type: task
status: needs_implement
priority: 1
rank: 1
estimate: 5
title: "Canary CI/CD parity + staging promotion — no regression from staging-preview.yml"
summary: Canary pipeline deploys app pods (Argo) but not Compose infra. staging-preview.yml deploys both. Close the gap in 4 incremental phases so canary proves the full production path, then promote through preview and production.
outcome: One unified pipeline. Push to canary deploys infra + apps. Same digests promote through preview → production. staging-preview.yml retired.
initiative: proj.cicd-services-gitops
assignees: []
labels: [ci-cd, infra, deployment, p0]
created: 2026-04-04
updated: 2026-04-04
---

# task.0281 — Canary CI/CD parity + staging promotion

## Problem

Canary CI/CD only deploys app pods via k8s overlay promotion → Argo sync. It does NOT deploy Compose infrastructure (postgres, temporal, litellm, redis, caddy). `staging-preview.yml` deploys both via SSH + `deploy.sh`.

This means:

- Infra changes (docker-compose.yml, Caddy config, litellm config) never deploy to canary
- Canary is a false signal — it doesn't prove infra changes work
- We can't safely retire staging-preview.yml because canary doesn't cover what it does
- Each environment rebuilds images separately instead of promoting tested digests

## Prerequisite

Canary VM re-provisioned with fixed `provision-test-vm.sh` (all 3 nodes healthy, readyz passing).

## Phase 1: Canary infra deploy parity (P0)

Extract Compose infra deploy from `deploy.sh` so canary CI deploys infra changes automatically.

### Steps

1. **Create `scripts/ci/deploy-infra.sh`** — extracted from deploy.sh:
   - rsync `infra/compose/edge/` and `infra/compose/runtime/` to VM
   - Write `.env` from GitHub Secrets (same vars deploy.sh uses)
   - `docker compose up -d` for infra services only (postgres, temporal, litellm, redis, caddy, alloy)
   - DB provisioning via `docker compose --profile bootstrap run --rm db-provision` (idempotent)
   - Config change detection: SHA256 litellm config → restart if changed, SHA256 Caddy → reload if changed
   - NOT app containers (Argo handles those via k8s)

2. **Add `deploy-infra` job to `build-multi-node.yml`**:
   - After `promote-k8s`, before `verify`
   - Uses `SSH_DEPLOY_KEY` + `VM_HOST` from canary GH environment
   - Environment concurrency: `concurrency: group: deploy-canary, cancel-in-progress: true`

3. **Add environment concurrency to all jobs**: `concurrency: group: canary-{job}, cancel-in-progress: true`

4. **Parity proof: Alloy k8s pod log shipping** — the first real infra change deployed via deploy-infra.sh:
   - Update Alloy config (`infra/compose/runtime/configs/alloy-config.metrics.alloy`) to add k8s pod log scraping via `discovery.kubernetes` or by reading k3s container logs from the host filesystem
   - Push to canary via PR → merge → deploy-infra.sh ships the config → Alloy restarts → pod logs appear in Grafana Cloud
   - This proves the infra deploy pipeline works AND closes the observability gap (currently pod logs are only visible via `kubectl logs` / SSH)
   - If pod logs show up in Grafana without SSH, Phase 1 is proven

### Phase 1 checklist

- [ ] Push app code change to canary → new image built → Argo deploys → readyz 200 on all 3 nodes
- [ ] Push Alloy config for k8s pod log scraping → deploy-infra.sh deploys → pod logs visible in Grafana Cloud (no SSH)
- [ ] Push Caddy config change → deploy-infra.sh deploys → change is live without SSH
- [ ] Push DB migration (new table) to canary → Argo PreSync Job runs → table exists in all node DBs
- [ ] Push litellm config change → deploy-infra.sh detects change → litellm restarts
- [ ] Verify job passes (parallel polling, all 3 nodes healthy)
- [ ] E2E Playwright smoke passes against canary domain
- [ ] Chat works end-to-end (sign in → send message → get response)

### Key files

- `scripts/ci/deploy.sh` — READ ONLY reference (lines 867-960 for rsync, 497-758 for compose orchestration)
- `scripts/ci/deploy-infra.sh` — NEW
- `.github/workflows/build-multi-node.yml` — add deploy-infra job

## Phase 2: Build once, promote digest (P1)

Stop rebuilding per-environment. Build on canary, promote tested digests.

### Steps

1. `build-multi-node.yml` triggers only on `canary` (remove staging/main from branches)
2. Create `promote-to-preview.yml`: copies canary overlay digests → preview overlay, commits to staging branch
3. Create `promote-to-production.yml`: copies preview digests → production overlay, commits to main branch
4. Create `scripts/ci/promote-env.sh`: reads digests from source overlay, writes to target overlay

### Phase 2 checklist (adds to Phase 1)

- [ ] Promote canary → preview: exact same sha256 digests appear in preview overlay
- [ ] Preview deploy uses promoted images (verify no rebuild triggered)
- [ ] Preview readyz 200 on all 3 nodes
- [ ] deploy-infra.sh runs against preview VM (same script, different GH environment)

## Phase 3: E2E gates + release promotion (P1)

E2E success gates promotion between environments.

### Steps

1. `e2e-canary.yml` (exists) → on success triggers `promote-to-preview.yml`
2. Create `e2e-preview.yml` (same as canary, different DOMAIN from preview GH environment)
3. Create `promote-release.yml`: after preview E2E success, creates `release/*` branch + PR to main (extracted from staging-preview.yml lines 314-383)

### Phase 3 checklist (adds to Phase 2)

- [ ] Canary E2E success automatically triggers promotion to preview
- [ ] Preview E2E success automatically creates release/\* branch + PR to main
- [ ] Release PR merge → production overlay updated → Argo syncs production
- [ ] Full chain proven: push → build → canary E2E → promote → preview E2E → release PR → prod

## Phase 4: Delete legacy workflows (P2)

Only after Phase 3 is proven end-to-end.

### Steps

1. Delete `staging-preview.yml`
2. Delete `build-prod.yml`
3. Delete `deploy-production.yml`
4. Delete `promote-k8s-staging.yml`
5. Update `docs/spec/ci-cd.md` — single unified pipeline

### Phase 4 checklist (adds to Phase 3)

- [ ] All deleted workflows removed, no references remain
- [ ] All 3 environments deploy from unified pipeline
- [ ] Rollback test: revert overlay commit → Argo syncs previous image → verified working

## Design constraints

- **No phase depends on a later phase.** Each is independently shippable.
- **Phase 1 alone is sufficient** to prove canary CI/CD works for infra + app changes.
- **Do not mix phases in a single PR.** Each phase is a separate branch + PR.
- **Canary ≠ ephemeral previews.** This task covers long-lived environment CI/CD. Ephemeral AI previews remain P2 (task.0188, preview-deployments.md).
- **Affected builds (Turborepo)** is task.0260 — orthogonal, not blocking.
- **SOPS secrets** is bug.0277 — improves reproducibility but doesn't block this task.
- **Environment concurrency** must be added in Phase 1, not deferred.

## Validation

Phase 1 is done when the Phase 1 checklist passes on a freshly provisioned canary VM with zero SSH intervention after provisioning.

Phase 4 is done when the full chain works and legacy workflows are deleted.
