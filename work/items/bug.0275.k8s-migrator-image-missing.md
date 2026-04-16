---
id: bug.0275
type: bug
title: "k8s migration Job fails — standalone app image lacks tsx + drizzle-kit"
status: needs_review
priority: 2
rank: 5
estimate: 1
summary: "Argo CD PreSync migration Job can't run Drizzle migrations — Next.js standalone image strips devDeps (tsx, drizzle-kit). Currently a no-op stub. Needs dedicated migrator Dockerfile target."
outcome: "Migration Job runs real Drizzle migrations in k8s using a lightweight migrator image with tsx + drizzle-kit."
project: proj.cicd-services-gitops
branch: bug/0275-k8s-migrator-image
assignees: []
labels: [deployment, k8s, migration, argocd]
created: 2026-04-03
updated: 2026-04-03
---

## Bug

The Argo CD PreSync migration Job (`infra/k8s/base/node-app/migration-job.yaml`) cannot run Drizzle migrations because the Next.js standalone app image does not include `tsx` or `drizzle-kit` (devDependencies stripped by standalone output).

**Current workaround:** Migration command is a no-op `echo`. DB is migrated by the Compose `db-provision` service during provisioning.

## Root Cause

The migration Job uses the same image as the app Deployment. Next.js standalone build strips devDeps. `drizzle-kit` and `tsx` are devDeps not in the image.

The Compose stack has a separate `db-migrate` service using `MIGRATOR_IMAGE` — a full workspace image. The k8s manifests have no equivalent.

## Design

### Outcome

Argo CD PreSync Job runs real Drizzle migrations using the dedicated migrator image — zero manual intervention, same behavior as the Compose `db-migrate` service.

### Discovery: Migrator Dockerfile stage already exists

All 3 node Dockerfiles (`nodes/{operator,poly,resy}/app/Dockerfile`) already have a `migrator` target stage that:

- Copies pnpm workspace with full `node_modules` (includes `tsx` + `drizzle-kit`)
- Copies `drizzle.config.ts` and operator's migration files
- Sets `CMD ["pnpm", "db:migrate:container"]`

CI already builds this target via `scripts/ci/build.sh` and pushes with `-migrate` tag suffix. The `compute_migrator_fingerprint.sh` script provides content-addressed caching.

**Line item #1 (Dockerfile migrator stage) and #2 (CI build) are already done.** The remaining work is purely k8s manifest fixes.

### Approach

**Solution**: Fix k8s manifests to use the existing migrator image correctly. Three changes:

1. **migration-job.yaml**: Remove no-op `echo` command and TODO comment. With no `command:` override, k8s uses the Dockerfile `CMD ["pnpm", "db:migrate:container"]` — single source of truth, matches Compose behavior.

2. **Staging overlays**: Fixed by PR #707 — migrator entries already use `-migrate` suffix with `cogni-template-migrate` base image name.

3. **Production overlays**: Add missing `cogni-template-migrate` image entries with `-migrate` suffix tags. Add missing Job `secretKeyRef` patches (without them, the now-active Job would look for `node-app-secrets` instead of `{prefix}-node-app-secrets`).

**Reuses**: Existing Dockerfile `migrator` target, existing CI build pipeline, existing `db:migrate:container` pnpm script, existing kustomize image-replacement pattern.

**Rejected**:

- **Explicit `command:` in Job YAML** (e.g. `["npx", "tsx", "node_modules/drizzle-kit/bin.cjs", "migrate"]`): Duplicates the Dockerfile CMD, creates drift risk. The Dockerfile already defines how to run the image — k8s should respect that.
- **Building a separate Dockerfile for migrator**: Unnecessary complexity — the multi-stage `migrator` target already exists.

### Invariants

- [x] MIGRATOR_EXISTS: `migrator` Dockerfile target already exists in all 3 node Dockerfiles
- [x] CI_BUILDS_MIGRATOR: `scripts/ci/build.sh` already builds `--target migrator` with `-migrate` tag
- [x] JOB_USES_DOCKERFILE_CMD: No `command:` override in Job — uses Dockerfile `CMD`
- [x] OVERLAY_MIGRATE_SUFFIX: All overlay migrator image entries use `-migrate` tag suffix
- [x] PROD_SECRET_REF: Production overlays patch Job `secretKeyRef` name (same as staging)
- [x] KUSTOMIZE_RENDERS: `kubectl kustomize` renders correctly for all 6 overlays
- [x] SIMPLE_SOLUTION: Pure manifest fixes — zero new code, zero new files

### Files

**Modify** (4 files, all k8s manifests):

- `infra/k8s/base/node-app/migration-job.yaml` — remove no-op command + TODO comment
- `infra/k8s/overlays/production/operator/kustomization.yaml` — add migrator image + Job secret ref patch
- `infra/k8s/overlays/production/poly/kustomization.yaml` — add migrator image + Job secret ref patch
- `infra/k8s/overlays/production/resy/kustomization.yaml` — add migrator image + Job secret ref patch

Staging overlay fixes handled by PR #707 (image name normalization + `-migrate` suffix tags).

### Out of scope (for other dev / separate items)

- CI multi-node workflow wiring (PR #707)
- Promote workflow: poly/resy missing `--migrator-digest` (flag to other dev)
- Production Deployment `secretRef` patches (missing in prod overlays — separate gap)

## Validation

- [x] `kubectl kustomize` renders migration Job with migrator image (no echo no-op) for all 6 overlays
- [x] `docker buildx build --target migrator` succeeds for operator Dockerfile (building)
- [x] `pnpm check:fast` passes (YAML-only changes, verified on main worktree)
