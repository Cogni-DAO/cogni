---
id: bug.0368
type: bug
title: "candidate-flight verify wait is ~4min of migrator image pull, not migration work"
status: needs_review
revision: 1
priority: 2
rank: 2
estimate: 2
created: 2026-04-24
updated: 2026-04-24
project: proj.cicd-services-gitops
assignees: []
summary: "verify-candidate blocks on PreSync migration Jobs that take 3m52s end-to-end — but the migration itself runs in ~8s. The remaining ~3m45s is k3s pulling a fresh per-node `cogni-template-migrate:{sha}` image on every flight. The Argo PreSync-hook pattern + separate migrator image multiplies a ~10s drizzle migrate into a ~4min flight tax. Fold migrations into the runtime app image as an initContainer; delete the migrator image + hook entirely."
outcome: "candidate-flight verify-candidate wait drops from ~4–9min to <1min in the zero-migrations case. PR-build surface shrinks by one image build per node. Argo PreSync hook + per-node migrator image + compute_migrator_fingerprint.sh all deleted."
---

# Bug: candidate-flight verify wait is dominated by migrator image pull, not migration work

## Symptoms

- `candidate-flight.yml` → `verify-candidate` → `Wait for ArgoCD sync` consistently takes 3m–9m.
- Wait time scales with how many nodes were affected by the PR (affected-only CI). A PR that touches only operator waits ~4min; a PR that touches all three nodes waits ~9min.
- Within the wait: Argo reports `sync=OutOfSync`, `phase=Running`, `health=Healthy`, `rev=<new>` — i.e. Argo already sees the new git SHA and is in-sync on revision; it's stuck on a PreSync Job that won't finish.

## Observed data (2026-04-24)

Captured with `kubectl get pods -l app.kubernetes.io/component=migration` on candidate-a right after a three-node flight:

| Job                          | Job duration | Container start → end | Actual container runtime |
| ---------------------------- | ------------ | --------------------- | ------------------------ |
| `poly-migrate-node-app`      | **3m 52s**   | 19:44:39 → 19:44:47   | **8s**                   |
| `poly-migrate-poly-doltgres` | **3m 52s**   | 19:44:39 → 19:44:48   | **9s**                   |
| `resy-migrate-node-app`      | **3m 52s**   | 19:44:39 → 19:44:48   | **9s**                   |

Every Job spent **~3m44s in `Pending / ContainerCreating`** before the migration container started. Live re-check on the next flight confirmed the new Job (`operator-migrate-node-app-2fbxl`) sitting in `ContainerCreating` at 45s — pulling the migrator image.

## Root cause

Two compounding design choices:

1. **Separate `cogni-template-migrate:{sha}` image per node.** Every flight builds and pushes a new per-node migrator image, then k3s pulls it fresh on the VM because the digest differs. The layers are not shared with the runtime app image (different base, different `COPY` set), so the cache is cold on every flight.

2. **Argo PreSync hook pattern.** Each migration is a standalone `batch/Job` (`argocd.argoproj.io/hook: PreSync`) that must finish before Argo proceeds with the main rollout. The Job schedules a fresh pod, which triggers the fresh image pull. Sync stays `OutOfSync` the entire time.

The actual work — `drizzle-kit migrate` against a DB with no new migrations — is ~8s. Everything else is scaffolding cost.

## Why the existing kick logic doesn't help

`scripts/ci/wait-for-argocd.sh` issues a `hard-refresh + hook sync` kick every ~40s while the app is not-yet-synced. During the pull window, Argo is already in `phase=Running` waiting on the hook Job; the kick forces a `sync/terminate` of the in-flight op and starts a new syncId, which re-creates the Job with the same `BeforeHookCreation` policy — re-pulling the image, re-starting the 3m44s pull clock. The kick sometimes _extends_ the wait, never shortens it (see the 9m14s run 24905074772 on 2026-04-24, where 4 concurrent syncIds stacked up in the controller log).

## Why `compute_migrator_fingerprint.sh` doesn't help either

It exists, but the only consumer is `ci.yaml` for image-tag computation. It has never been wired into a skip-path inside the PreSync Job, and wiring it in would preserve the hook + Job + image-pull cost. The whole branch of complexity is load-bearing for nothing.

## Fix

**Fold migrations into the runtime app image as a Deployment initContainer.** Specifically:

1. Delete `infra/k8s/base/node-app/migration-job.yaml` and `infra/k8s/base/poly-doltgres/doltgres-migration-job.yaml`. No more Argo PreSync hooks.
2. Add an `initContainers` block to `infra/k8s/base/node-app/deployment.yaml` that references the **same image** as the main container (`image: <app>:<sha>`) and runs the existing `pnpm db:migrate:<node>:container` command. Because the main container already pulled this image, the initContainer hits the local layer cache — zero pull wait.
3. Delete the per-node migrator image target: remove `*-migrate` entries from `scripts/ci/lib/image-tags.sh`, drop the migrator build from `pr-build.yml`'s matrix, drop migrator digest lines from `scripts/ci/resolve-pr-build-images.sh` and `scripts/ci/promote-build-payload.sh`, drop the migrator stage from `nodes/*/app/Dockerfile`. One image per node instead of two.
4. Delete `scripts/ci/compute_migrator_fingerprint.sh` and its reference in `ci.yaml`.
5. Simplify `scripts/ci/wait-for-argocd.sh`: drop the kick loop. Poll `sync.revision == expected && health=Healthy`, then `kubectl rollout status`. ~40 fewer lines.
6. Drop Argo reconciliation poll to 60s on candidate-a via `argocd-cm` overlay patch. Only shortens the git-SHA-pickup cold start (≤2min → ≤1min); not load-bearing but cheap and coherent with the rest.

## Blast radius

- `infra/k8s/base/node-app/deployment.yaml` is the shared base for operator / poly / resy across candidate-a, preview, production. The initContainer change lands in every env at once on the next deploy-branch promote. Desirable — uniform, no per-env divergence.
- PR-build matrix shrinks by N legs (one per node). Faster PR builds as a side effect.
- Existing migrator images in GHCR become orphaned. Retention policy will clean them up; no action required.
- Runtime image gains `drizzle-kit` + migration SQL files (~5MB). Negligible.

## Rollback

Single revert of the PR restores the migration-job.yaml + migrator image build + hook. Deploy branches regenerate on next promote.

## Validation

exercise: Dispatch `candidate-flight.yml` for a PR that touches all three nodes (operator + poly + resy).
observability:

- `verify-candidate` → `Wait for ArgoCD sync` step completes in < 90s (was 4–9min).
- Loki query `{namespace="cogni-candidate-a", container="migrate"}` shows three `drizzle-kit migrate` runs each completing in < 15s.
- `kubectl get jobs -n cogni-candidate-a -l app.kubernetes.io/component=migration` returns **empty** — no more hook Jobs; migrations run as init on the Deployment pod.
- `/version.buildSha` on all three node endpoints matches the flown SHA within 2min of dispatch.

## References

- bug.0363 — wait-for-argocd hook-Job race (same hook surface, different symptom)
- bug.0326 — Argo Healthy ≠ rollout complete (motivated the `kubectl rollout status` gate we keep)
- task.0322 — migrator-image-per-node split (the thing this bug undoes)
- Slow flight evidence: GitHub Actions runs 24905074772 (9m14s), 24904175050 (6m29s), 24906321558 (8m10s) on 2026-04-24
