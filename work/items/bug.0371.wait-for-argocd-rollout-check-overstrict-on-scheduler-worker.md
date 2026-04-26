---
id: bug.0371
type: bug
title: "wait-for-argocd rollout-status gate over-strict on scheduler-worker — false-fails verify-deploy + drops preview lock"
status: needs_review
revision: 1
priority: 1
rank: 1
estimate: 1
created: 2026-04-25
updated: 2026-04-25
project: proj.cicd-services-gitops
assignees: []
summary: "wait-for-argocd.sh runs `kubectl rollout status deployment/scheduler-worker` against the per-app deadline as part of verify-deploy. On preview, the new ReplicaSet is Ready and Argo reports Healthy quickly, but the old ReplicaSet's pod takes longer than the budget to drain (long shutdown grace, no traffic to drain, exit handler latency). rollout status returns non-zero before the deadline → wait-for-argocd reports `❌ scheduler-worker rollout did not complete (stale ReplicaSet still present)` → verify-deploy fails → unlock-preview-on-failure fires → preview lease drops to `unlocked` even though the new pod has been serving correctly for minutes. verify-buildsha.sh already filters out scheduler-worker (no Ingress / no /version), so this rollout-status gate is purely defensive — and currently nets out as a regression-detector with a false-positive rate that blocks every preview promote with scheduler-worker churn."
outcome: "Promote to preview lands in `reviewing` with the lease locked when scheduler-worker rolls cleanly (Argo Healthy + new pod Ready), regardless of how long the old ReplicaSet takes to drain. No more spurious unlock-on-failure on healthy deploys. Either: (a) skip rollout-status check entirely for non-HTTP apps that verify-buildsha already excludes, OR (b) bump scheduler-worker's rollout-status budget to absorb its drain window, OR (c) replace rollout-status with a `new-RS available + new-pod Ready` check that doesn't block on old-RS termination."
---

# Bug: wait-for-argocd rollout-status gate over-strict on scheduler-worker

## Symptoms

- promote-and-deploy.yml run [24926746588](https://github.com/Cogni-DAO/node-template/actions/runs/24926746588) for `5dde7b1a` (#1053 catalog-as-SSoT, task.0374):
  - `promote-k8s` ✓ — overlay digests pushed to `deploy/preview` (`2d0a4f42`)
  - `verify-deploy` ✗ — failed at "Wait for ArgoCD sync" step
  - `unlock-preview-on-failure` ✓ — preview lease dropped to `unlocked`
- Live preview state at the moment of failure (verified by external curl + SSH inspection):
  - `https://preview.cognidao.org/version` → `{"buildSha":"1b72cd81f97584280176e7e927a00decb7e7c29f"}` (correct, matches source map for 5dde7b1a)
  - `https://poly-preview.cognidao.org/version` → same (correct)
  - `https://resy-preview.cognidao.org/version` → same (correct)
  - `kubectl -n argocd get application preview-scheduler-worker` → Healthy / Synced
  - `kubectl -n cogni-preview get pod -l app.kubernetes.io/name=scheduler-worker` → 1/1 Running, 0 restarts, ~9 min old at the moment wait-for-argocd gave up
  - `kubectl rollout status deployment/scheduler-worker` (run manually after the failure) → "successfully rolled out"
- Net effect: a fully-healthy preview deploy was reported as failed; preview lease unlocked; release pipeline blocked downstream until manual intervention.

## Reproduction

1. Merge any PR to main that bumps the scheduler-worker image digest on preview.
2. Watch `promote-and-deploy.yml` → `verify-deploy` → "Wait for ArgoCD sync" loop.
3. Operator/poly/resy reach `Healthy + rollout complete` within 1–2 min each.
4. scheduler-worker reaches Argo `Healthy` (new pod Ready), then `kubectl rollout status` blocks on the old ReplicaSet's pod terminating.
5. `kubectl rollout status` returns non-zero before the per-app deadline, even though the new pod is serving traffic correctly. wait-for-argocd emits `❌ scheduler-worker rollout did not complete (stale ReplicaSet still present)` and exits 1.

## Root cause

`scripts/ci/wait-for-argocd.sh:228`:

```bash
if kubectl -n "$namespace" rollout status "deployment/${deployment}" --timeout="${remaining}s" >/dev/null 2>&1; then
  return 0
fi
return 1
```

The rollout-status check was added (bug.0326) to close the "Argo Healthy fires before old RS drains, /version still returns prior buildSha" hole — that hole is real for **node apps that serve HTTPS via Ingress**. scheduler-worker has no Ingress and no `/version` endpoint; `verify-buildsha.sh` explicitly filters it out:

```bash
# verify-buildsha.sh: "Scheduler-worker and migrator filtered out (no Ingress)"
```

Yet wait-for-argocd still applies the same rollout-status gate to scheduler-worker, so a slow old-RS termination (which has zero impact on serving correctness, because there is nothing being served) blocks the entire verify-deploy job.

## Proposed fix (pick one)

1. **Skip rollout-status for non-HTTP apps.** Mirror `verify-buildsha.sh`'s exclusion list (scheduler-worker, migrator) inside `wait-for-argocd.sh` so the rollout-status check only runs for apps where `/version.buildSha` correctness depends on old-RS termination. **Smallest blast radius; recommended.**
2. Replace `kubectl rollout status` with a cheaper "new RS has `availableReplicas == desired`" check that does not block on old-RS drain.
3. Bump scheduler-worker's per-app deadline (current 600s); papers over the symptom, doesn't fix the design.

## Related

- bug.0326 — original rollout-status gate (correct for HTTP apps)
- bug.0358 — wait-for-argocd shared timeout starvation
- bug.0359 — wait-for-argocd Deployment OutOfSync gap
- bug.0363 — wait-for-argocd hook-job race (closed)

## Manual recovery applied (incident path, axiom 9)

- Verified via SSH that all 4 preview apps were Healthy and serving the new buildSha.
- Ran `set-preview-review-state.sh reviewing 5dde7b1a` from the local checkout to lock the lease at the deployed SHA.
- Preview HEAD is now `6af1fdc36 promote-state: 5dde7b1a under review (deploy success)`.

## Validation

exercise:

- Merge a PR to main that bumps the scheduler-worker image digest (any app-code PR will do, since the catalog promotes all 4 apps).
- Watch `promote-and-deploy.yml` → `verify-deploy` → "Wait for ArgoCD sync" step output.
- Confirm the step emits `⚠️ <env>-scheduler-worker: non-HTTP app — skipping rollout-status check (bug.0371)` and proceeds.
- Confirm `verify-deploy` job concludes `success`, `lock-preview-on-success` runs, and `deploy/preview` ends in `review-state=reviewing` with `current-sha` matching the merged source SHA.

observability:

- GitHub Actions log line `non-HTTP app — skipping rollout-status check (bug.0371)` appears for `scheduler-worker` (and any `*-migrator`) entries in the Wait for ArgoCD sync step.
- `deploy/preview:.promote-state/review-state` transitions `unlocked → dispatching → reviewing` with no spurious final `unlocked`.
