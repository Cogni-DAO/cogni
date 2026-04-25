---
id: task.0371
type: task
title: "Kill PreSync migration hook + migrator image — step 1 hotfix"
status: needs_review
revision: 3
priority: 1
rank: 1
estimate: 2
created: 2026-04-25
updated: 2026-04-25
summary: "Finish the deletion tail PR #1041 designed but did not land: replace Argo PreSync `migrate-node-app` Job with a Deployment initContainer running `migrate.mjs` from the runtime image, retire the `cogni-template-migrate` GHCR build target, and prune all migrator-paired plumbing (image-tags lib, build/promote scripts, fingerprint script, wait-for-argocd hook babysitting). Eliminates the resy-stuck-hook failure class on candidate-a / preview / production simultaneously."
outcome: "One image build per node (no more `*-migrator` companions). Migrations run as Deployment initContainers, gated by `kubectl rollout status` — no Argo PreSync hook Jobs, no stuck-hook-Job operationState wedge class. `migration-job.yaml` deleted; `cogni-template-migrate` GHCR package retired."
spec_refs:
  - docs/spec/databases.md
  - docs/spec/ci-cd.md
assignees: []
project: proj.database-ops
branch: fix/task.0370-step1-init-container-cleanup
bugs:
  - bug.0368
---

# Task: Kill PreSync migration hook + migrator image — step 1 hotfix

PR #1041 landed the additive scope of task.0370 (per-node `migrate.mjs` + `FROM runner AS migrator` Dockerfile rebase) but the deletion tail was deferred. The dev review of the merged state confirmed: migrator image build target + PreSync hook Job manifests are still in tree, and the resy-stuck-hook failure class is still live on candidate-a / preview / production. This task ships the deletion.

## What changes

- **Runtime image bundles `migrate.mjs` + migrations**: each node Dockerfile moves the migration COPYs from the now-deleted `migrator` stage into the `runner` stage. One stage, one image, one digest.
- **Deployment gains an initContainer**: `infra/k8s/base/node-app/deployment.yaml` adds an `initContainers: [migrate]` block invoking `node /app/nodes/$(NODE_NAME)/app/migrate.mjs /app/nodes/$(NODE_NAME)/app/migrations`. Same image as the main `app` container; overlay's `images:` block patches both at once.
- **Poly Doltgres migrates inline too**: poly's overlay (candidate-a + preview only — production poly doesn't run Doltgres) appends a second initContainer `migrate-doltgres` with `DATABASE_URL` mapped to `DOLTGRES_URL_POLY`. `infra/k8s/base/poly-doltgres/` directory deleted.
- **`cogni-template-migrate` build target retired**: `scripts/ci/lib/image-tags.sh` drops `*-migrator` from `ALL_TARGETS`, drops `IMAGE_NAME_MIGRATOR`, collapses `image_name_for_target` to a single return. `build-and-push-images.sh` drops the migrator case arms. `detect-affected.sh` drops the paired-add lines. `merge-build-fragments.sh` drops migrator entries from `canonical_order`.
- **Promote chain simplified**: `promote-k8s-image.sh` drops `--migrator-digest`. `promote-build-payload.sh` + `promote-and-deploy.yml` + `resolve-digests-from-preview.sh` + `promote-preview-seed-main.sh` drop migrator-pairing logic — one digest per app, period.
- **`wait-for-argocd.sh` simplified**: `delete_stale_hook_jobs` and `clear_stale_missing_hook_operation` deleted (no more Argo hook Jobs to babysit). `patch_sync_operation` deleted. The kick is now a single `request_hard_refresh` annotation; `kubectl rollout status` (run after) is the real gate.
- **`compute_migrator_fingerprint.sh` deleted** along with its caller in `ci.yaml` (the `Compute migrator fingerprint and tag` step + the `Try pull migrator by fingerprint` + `Build migrator image` steps).
- **Compose `db-migrate` service** points at `${APP_IMAGE}` with `command: ["node", "/app/nodes/operator/app/migrate.mjs", "/app/nodes/operator/app/migrations"]`.
- **All 12 per-env per-node overlays** drop the `cogni-template-migrate` `images:` entry, drop the `migrate-node-app` Job patch, and add a Deployment patch replacing `initContainers/0/envFrom/1/secretRef/name` to the per-node secret.

## Invariants preserved

- **FORWARD_COMPAT_MIGRATIONS**: every migration must be backward-compatible with the prior code version. Rolling-update overlap means the old pod still serves traffic against the newly-migrated schema briefly. Same obligation as before; `DROP COLUMN` / non-default `NOT NULL` without a two-deploy plan = partial outage.
- **IDEMPOTENT_MIGRATIONS**: drizzle's journal-based migrator is safe on every pod start.
- **CREDENTIAL_SCOPING**: initContainer binds the same `{node}-node-app-secrets.DATABASE_URL` the main container binds (same as the prior Job did). Narrowing to a separate `app_migrator` role with DDL-only privileges remains future work in proj.database-ops P1.

## Validation

exercise: dispatch `candidate-flight.yml` for a PR touching all three nodes (operator + poly + resy).

observability:

- `verify-candidate > Wait for ArgoCD sync` completes with `kubectl rollout status` — no more "waiting for completion of hook batch/Job/X" messages in Argo controller logs.
- `kubectl -n cogni-candidate-a get jobs -l app.kubernetes.io/component=migration` returns **empty** — no PreSync hook Jobs.
- Loki: `{namespace="cogni-candidate-a", container="migrate"} |= "migrations applied"` shows three lines per flight (operator + poly + resy initContainer logs); poly also has a `migrate-doltgres` line with `dolt_commit stamped`.
- `/version.buildSha` on candidate-a-{operator,poly,resy} matches the flown SHA within 2 min of dispatch.
- Failure-path: a syntactically-broken migration leaves the pod in `Init:Error`; old ReplicaSet keeps serving; `kubectl rollout status` non-zero; `verify-buildsha` fails on the flown SHA.

## Review Feedback (rev 3)

Dev review on PR #1043 + my own miss caught one more:

6. **(extraction)** Three near-identical `migrate.mjs` copies under `nodes/{operator,poly,resy}/app/src/adapters/server/db/` was per-node duplication of the same advisory-lock + drizzle-orm runner code (only the `NODE` constant differed). Consolidated to a single source at `scripts/db/migrate.mjs` that reads `NODE_NAME` from env. Each Dockerfile now `COPY`s from `/app/scripts/db/migrate.mjs` into `/app/nodes/<node>/app/migrate.mjs` so Node's ESM resolver still finds drizzle-orm + postgres in the standalone bundle's nested node_modules. **Single source of truth — fixing the next advisory-lock edge case is one file, not three.** poly's `migrate-doltgres.mjs` stays separate (it diverges for real reasons: trailing `dolt_commit`, no advisory lock).

## Review Feedback (rev 2)

Self + dev review on PR #1043 caught:

1. **(blocker)** `pg_try_advisory_lock` non-blocking + `process.exitCode = 0` on contention → race: pod B's main container would start before pod A's migration finished. Fixed by switching to **blocking** `pg_advisory_lock` — pod B waits, drizzle's journal makes the post-acquire migration a no-op. Operator/poly/resy migrate.mjs all updated.
2. **(bug)** `clear_stale_missing_hook_operation` function body in `wait-for-argocd.sh` survived the kick-callsite delete — dead code with misleading comments. Body removed.
3. **(bug)** Poly overlay `kustomization.yaml` (candidate-a + preview) had duplicate JSON patches: `op: replace` on `/spec/template/spec/initContainers/0/envFrom/1/secretRef/name` ran twice + the doltgres `op: add /spec/template/spec/initContainers/-` block was duplicated, rendering THREE initContainers (1 Postgres + 2 Doltgres). Idempotent at runtime via drizzle journal but wrong. Deduped — both overlays now render exactly two initContainers.
4. **(comment drift)** `ARGOCD_TIMEOUT` default-600s comment in `wait-for-argocd.sh` referenced "two serial init containers" sized for the old migrator-image-pull + hook Job cold-starts. Reworded to reflect post-task.0371 posture.
5. **(style)** `LOCK_KEY` literal cleaned up: `0x436f676e6900 + 0x01` → `0x436f676e6901n` (single hex BigInt, no arithmetic).

Spec/project docs updated as part of this revision: `docs/spec/databases.md` §2 + §4.1 + §5 + §6.4 reflect the post-task.0371 single-image-per-node runtime + advisory-lock pattern. `work/projects/proj.database-ops.md` "Per-Node Schema Independence" deliverable table marks task.0371 in-review and adds the as-shipped state summary.

## Out of scope

- Per-env per-node deploy branches (task.0320 redesign — a different dev's track).
- `infra/catalog/*.yaml` becoming the single source of truth for `NODE_TARGETS` / `wait-for-argocd APPS` / detect-affected paths.
- Runtime image bloat (~285 MB `@openai/codex` SDK) — `bug.0369` follow-up, not blocking.
- Doltgres advisory-lock validation when poly scales beyond `replicas: 1` (multi-writer Doltgres safety).
