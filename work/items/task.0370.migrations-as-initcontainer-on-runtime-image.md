---
id: task.0370
type: task
title: "Migrations as initContainer on runtime image; delete migrator image + PreSync hook"
status: needs_design
revision: 1
priority: 1
rank: 1
estimate: 3
summary: "Collapse the migrator-image-per-node + Argo-PreSync-hook pattern into an initContainer on the app Deployment, reusing the runtime app image. Eliminates ~4min of image-pull-per-node from every candidate-flight and shrinks build surface by one image per node. Addresses bug.0368."
outcome: "One image per node (operator/poly/resy). No Argo hooks on node-app or poly-doltgres. `verify-candidate` wait drops to ~60s end-to-end on the zero-migrations path. `kubectl get jobs -l component=migration` returns empty on all envs."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
branch: fix/candidate-flight-migrator-image-pull
bugs:
  - bug.0368
---

# Task: migrations as initContainer on runtime image

## Goal

Delete the migrator-image-per-node + Argo PreSync-hook pattern. Run migrations as an **initContainer on the node-app Deployment, using the same image as the main container**. Rationale and evidence: `work/items/bug.0368`.

## Design — top-0.1%-standard, minimalistic

### The one idea

An initContainer on the main Deployment, sharing the main container's image, is the correct k8s-native expression of "migrations run before the app." Argo hooks + standalone migrator images are an accidental expansion of that single idea into two images, two Deployments-worth of lifecycle, and a separate Argo phase machine. Collapse.

### Invariants we preserve

1. **Forward-only migrations, idempotent.** Unchanged — drizzle-kit's `__drizzle_migrations` journal already guarantees this. Running the initContainer on every pod start is safe and fast (~8s cold, ~1s when nothing to do).
2. **Failure is observable and halts rollout.** A failing migration leaves the pod in `Init:Error`; the old ReplicaSet keeps serving; `kubectl rollout status` returns non-zero. Same signal surface as a failed hook Job, minus the hook.
3. **No cross-pod races.** All node-app Deployments are `replicas: 1, strategy: RollingUpdate`; `maxUnavailable=0, maxSurge=1` means at most one new pod attempts migration at any time. If we ever scale out, `__drizzle_migrations`'s primary-key journal insert serializes concurrent migrators safely.
4. **Deploy state in git; single source of truth for images.** Unchanged — the initContainer's `image:` field is the same digest that `promote-build-payload.sh` writes for the main container. One digest promote per node instead of two.

### Surface changes (minimal — delete > add)

**Delete**:

| File / surface | Delete | Reason |
| --- | --- | --- |
| `infra/k8s/base/node-app/migration-job.yaml` | 43 lines | The PreSync hook itself |
| `infra/k8s/base/poly-doltgres/doltgres-migration-job.yaml` | whole file | Same pattern, doltgres schema |
| Migrator target entries in `scripts/ci/lib/image-tags.sh` | per-node `*-migrate` lines | No more migrator image |
| Migrator build legs in `.github/workflows/pr-build.yml` | matrix entries resolved via `lib/image-tags.sh` | Follows from above |
| Migrator stage in `nodes/operator/app/Dockerfile`, `nodes/poly/app/Dockerfile`, `nodes/resy/app/Dockerfile` | `FROM base AS migrator` stage + `CMD ["pnpm","db:migrate:*:container"]` | Functionality moves into `runner` stage |
| Migrator digest resolution in `scripts/ci/resolve-pr-build-images.sh` | per-node migrator tag lookups | Follows from no-migrator-image |
| Migrator field in `scripts/ci/promote-build-payload.sh` | per-node migrator digest writes | Follows from no-migrator-image |
| `scripts/ci/compute_migrator_fingerprint.sh` | whole file | Only caller (`ci.yaml` image-tag calc) becomes dead |
| Fingerprint block in `.github/workflows/ci.yaml` | the `FINGERPRINT=$(...)` step | Dead after fingerprint script deletion |
| Kick loop in `scripts/ci/wait-for-argocd.sh` | ~40 lines (16 kick refs) | Structurally unnecessary without hooks; loop collapses to `revision==expected && Healthy` then `kubectl rollout status` |

**Add**:

| File | Add | Size |
| --- | --- | --- |
| `infra/k8s/base/node-app/deployment.yaml` | `initContainers:` block referencing the same image as `containers:`, command = `pnpm db:migrate:<node>:container`, env = DATABASE_URL from node-app-secrets | ~12 lines |
| `infra/k8s/base/poly-doltgres/` Deployment equivalent | Same pattern on the doltgres-consuming pod | ~12 lines |
| `infra/k8s/argocd/overlays/candidate-a/argocd-cm-patch.yaml` | `timeout.reconciliation: 60s` data key | 1 field |
| `nodes/*/app/Dockerfile` | Ensure `drizzle-kit` + migrations directory + drizzle config survive into `runner` stage (do not prune) | 2–3 lines per Dockerfile |

**Net**: ~150 lines deleted, ~50 lines added, 4 fewer files, one fewer image per node per build.

### Template for the initContainer block

```yaml
# infra/k8s/base/node-app/deployment.yaml (partial)
spec:
  template:
    spec:
      initContainers:
        - name: migrate
          image: placeholder  # patched by overlay + promote-k8s-image.sh, same digest as main container
          command: ["pnpm", "db:migrate:node:container"]  # overlay patches node→operator|poly|resy
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: node-app-secrets
                  key: DATABASE_URL
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
      containers:
        - name: node-app
          image: placeholder  # same digest
          ...
```

Overlays (`infra/k8s/overlays/{env}/{node}/kustomization.yaml`) patch both `containers[0].image` and `initContainers[0].image` to the same digest and set the node-specific migrate command. `promote-k8s-image.sh` gains one extra path-patch per app (same digest, different YAML path) — trivial.

### Dockerfile delta

Current `runner` stage ships `node_modules` without dev deps. drizzle-kit lives in devDependencies. Two compatible approaches:

1. **Keep drizzle-kit in prod deps for the runtime image.** One-line `dependencies` move in each node's `package.json`. drizzle-kit is ~5MB. Net simplest.
2. **Multi-stage COPY of the drizzle-kit bin + its runtime deps into runner.** More surgical on image size but adds Dockerfile complexity. Not worth it for 5MB.

Pick (1). Same stance on `tsx` (already in use for the container migrate command).

### What stays the same

- `DATABASE_URL` secret plumbing — the initContainer uses the same `node-app-secrets` that the main container already uses.
- `promote-build-payload.sh` and `promote-k8s-image.sh` flow — still writes one digest per node; the digest just now points at both container slots in the Deployment.
- `verify-buildsha.sh` — the runtime app image is still the only source of `/version.buildSha`. Unchanged.
- Per-env overlays under `infra/k8s/overlays/{preview,production,candidate-a}/{operator,poly,resy}/` — structure preserved; only the migration-job patch files are deleted.

## Implementation order (single PR, atomic commits)

1. **Script simplification (no manifest changes yet).** Gut `wait-for-argocd.sh` kick loop. Merge-safe on its own — the kick was a workaround, not a correctness requirement.
2. **Argo poll interval.** Overlay patch for `argocd-cm` on candidate-a → `timeout.reconciliation: 60s`. Independently reversible one-line GitOps commit.
3. **Dockerfile: preserve drizzle-kit in runner.** One-line dependency move in each node `package.json`; update Dockerfile if a prune step removes it. Unit tests + CI still pass.
4. **Add initContainer to `base/node-app/deployment.yaml` (and poly-doltgres equivalent).** The manifest gains an init-path; main-path is untouched. The PreSync hook is still present and will still run — this commit is a no-op at runtime but proves the overlay plumbing works. Merge-safe.
5. **Flip: delete migration-job.yaml + all migrator-image build/promote/resolve/Dockerfile surface.** The initContainer becomes the only migration path. This is the irreversible commit; gate it behind the commits above being green on candidate-a.
6. **Delete compute_migrator_fingerprint.sh + ci.yaml reference.** Drive-by cleanup now that nothing calls it.

Atomicity note: commits 1–4 are each independently revertable. Commit 5 is the switchover. Commit 6 is dead-code cleanup.

## Validation

exercise: Dispatch `candidate-flight.yml` for a PR that touches all three nodes.
observability:
- `verify-candidate > Wait for ArgoCD sync` completes in ≤ 90s on the no-new-migrations path (previously 4–9 min).
- `kubectl -n cogni-candidate-a get jobs -l app.kubernetes.io/component=migration` returns empty (no hook Jobs).
- Loki selector `{namespace="cogni-candidate-a"} |= "drizzle-kit"` shows three `migrate` runs, each < 15s, logged from pods named `<node>-node-app-<hash>` (not `*-migrate-*`).
- `/version.buildSha` on candidate-a-{operator,poly,resy} matches the flown SHA within 2min of dispatch.
- New migration case: add a trivial no-op migration file, re-flight; migration applies once, `__drizzle_migrations` gains one row, subsequent pod restarts no-op in < 2s.
- Failure case: introduce a syntactically-broken migration, confirm pod goes to `Init:Error`, old ReplicaSet keeps serving, `kubectl rollout status` returns non-zero, `verify-buildsha` fails on the flown SHA. Revert migration; pod recovers on next sync.

## Out of scope

- Removing Argo Image Updater (complementary simplification; separate task — its only surface is redundant with `promote-build-payload.sh`).
- Parallelizing the per-app wait loop in `wait-for-argocd.sh` (unnecessary after hooks are gone).
- Propagating the 60s poll to preview/production (candidate-a only; the others have different throughput characteristics and aren't the bottleneck).
- Consolidating the three per-node Dockerfiles into one template (tempting, orthogonal, deferred).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| `drizzle-kit` at runtime in prod images surprises a future dep-scanner | drizzle-kit is MIT-licensed, widely used; if scanning flags it, vendor the migrator script to pure `pg` + journal reads in a follow-up (separate concern, not blocking) |
| initContainer slows pod cold-start by ~1s even on no-op migrations | Acceptable; pod cold-starts are rare in steady state (Argo only restarts on Deployment change) |
| A botched migration leaves a stuck `Init:Error` pod | Same failure surface as a stuck PreSync Job today; actually *better* because `kubectl rollout status` reports it without the Argo hook phase-machine being involved |
| Overlays don't propagate to preview/production on the next promote-forward | Covered by the existing deploy-branch promote flow; the `base/` changes apply uniformly on the next `promote-and-deploy.yml` run per env |
| Orphan migrator images in GHCR after deletion of build | GHCR retention policy reaps them; no action |

## Links

- bug.0368 — diagnosis and evidence
- docs/spec/ci-cd.md — canonical promotion flow (unchanged by this task; image count per node shrinks by 1)
- task.0322 — introduced the per-node migrator image split (this task partially reverses it)
