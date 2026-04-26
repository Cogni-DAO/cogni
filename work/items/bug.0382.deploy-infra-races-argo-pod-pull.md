---
id: bug.0382
type: bug
title: "promote-and-deploy runs deploy-infra parallel with promote-k8s — Argo pulls new pods before infra prereqs land"
status: needs_design
priority: 2
rank: 50
estimate: 2
summary: "promote-and-deploy.yml's job graph is `decide → reconcile-appset → promote-k8s → [deploy-infra | verify-deploy | verify] → e2e → aggregate-{preview,production}`. promote-k8s pushes the new digest to deploy/<env>-<node> first, which Argo reconciles immediately — pods start pulling the new image in parallel with deploy-infra. If a code change introduces a new infra prereq (env var added to a k8s Secret, new compose sidecar, new postgres column the pod reads at startup), the new pod CrashLoops until deploy-infra finishes. Self-heals on next pod restart, but only by accident. Hidden at steady state when infra rarely changes; bites when it does. Correct order: `deploy-infra → promote-k8s → verify-deploy`."
outcome: |
  - `promote-and-deploy.yml` job graph reordered: `deploy-infra` becomes a dependency of `promote-k8s` (or runs immediately after `reconcile-appset` and before `promote-k8s`). Infra prereqs land before any image digest update fans out to Argo.
  - `verify-deploy` continues to depend on both — unchanged from current.
  - Skip-infra path (flight-preview default `skip_infra=true`) preserved: when skipped, promote-k8s runs unblocked. Only the non-skip path (manual workflow_dispatch with `skip_infra=false`, or any future caller that opts into infra) gets the ordering.
  - Trade-off documented: serial deploy-infra → promote-k8s adds ~30-60s to the non-skip path (deploy-infra is heavy SSH + compose up). Acceptable: that path is rare and the alternative is silent CrashLoop windows that self-heal accidentally.
  - docs/spec/ci-cd.md gains an axiom or amendment: "infra prereqs precede pod-image rollout in the same workflow run."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-26
updated: 2026-04-26
labels: [cicd, ordering, task.0376-followup]
external_refs:
  - work/items/task.0376.preview-production-matrix-cutover.md
  - .github/workflows/promote-and-deploy.yml
  - scripts/ci/deploy-infra.sh
---

# bug.0382 — deploy-infra races Argo pod-pull on every promote

## Problem

After task.0376, `promote-and-deploy.yml` runs:

```
decide → reconcile-appset → promote-k8s (matrix) →
[deploy-infra | verify-deploy (matrix) | verify] → e2e → aggregate-{preview,production}
```

`promote-k8s` writes the new image digest to `deploy/<env>-<node>` first. Argo CD watches that branch and starts reconciling the new image **immediately, in parallel** with `deploy-infra`. `deploy-infra` is the SSH + rsync `infra/compose/**` + `compose up` step that refreshes secrets, configmaps, sidecars on the VM.

If a code change introduces a new infra prereq — a new env var written into the k8s Secret, a new compose service the pod depends on, a new postgres column the pod reads at startup — the new pod that Argo just pulled tries to start before `deploy-infra` has rolled the prereq out. The pod CrashLoops on missing-secret / missing-service / missing-column, then **self-heals** on the next pod restart cycle once `deploy-infra` finishes (~30-60s later).

The self-heal is the dangerous part: the failure is invisible at steady state because infra rarely changes, and when it does, the recovery is automatic enough that no alarm fires. The only signal is a brief CrashLoop window in pod logs that no agent looks at.

## Why current ordering is wrong

The original (pre-task.0376) ordering was the same — `deploy-infra` and `verify-deploy` were both dependencies of `promote-k8s`. Pre-matrix, this was fine because `verify-deploy` was a single whole-slot job that finished after both `deploy-infra` and Argo's reconcile, so the gate caught any race. Post-matrix, the per-cell `verify-deploy` cells observe the live state from outside the cluster — they catch the race only if it surfaces as a `/version.buildSha` mismatch within the cell's poll budget. A new-secret CrashLoop that self-heals in 30s is invisible to verify-buildsha because the new pod eventually serves the right buildSha. The contract is met by accident.

## Fix

Reorder `promote-and-deploy.yml`:

```
decide → reconcile-appset → deploy-infra → promote-k8s (matrix) →
[verify-deploy (matrix) | verify] → e2e → aggregate-{preview,production}
```

`deploy-infra` now precedes `promote-k8s`. Infra prereqs land first; pods updated second. No race window.

Skip-infra path preserved: when `inputs.skip_infra == 'true'`, the `deploy-infra` job is gated off (current step-level gate already handles this). `promote-k8s` runs immediately after `reconcile-appset` because its `needs:` would resolve `deploy-infra` as `skipped`, which is a passing condition.

## Trade-off

Non-skip path adds ~30-60s of serialization (deploy-infra runs before promote-k8s instead of in parallel). Acceptable:

- Skip-infra is the dominant path (flight-preview sets `skip_infra=true` for every auto-promote).
- The non-skip path is rare and run by humans (manual workflow_dispatch for infra changes, or any caller opting in).
- The alternative is silent CrashLoop windows that self-heal accidentally — exactly the "rollout pipeline declares success against state that cannot be ready" anti-pattern Axiom 19 forbids.

## Out of scope

- **Argo CD sync trigger semantics.** Argo reconciles on git push to deploy branches, not on a workflow signal. We can't suppress reconcile during deploy-infra; we can only ensure deploy-infra completes before promote-k8s pushes. That's the fix here.
- **Deeper layering** (e.g. infra-only deploy lane that doesn't touch images, image-only deploy lane that doesn't touch infra). Useful eventually; out of scope here.

## Validation

- exercise: dispatch `promote-and-deploy.yml --ref main -f environment=preview -f skip_infra=false` against a SHA that adds a new env var to a k8s Secret and reads it at pod startup. Without the fix, pod CrashLoops briefly during cutover. With the fix, pod starts cleanly.
- observability: verify-deploy cell completes without retry on the new pod's `/version`. Loki shows zero CrashLoopBackOff events for the affected Deployment during the run.
