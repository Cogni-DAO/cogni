---
id: bug.0378
type: bug
title: "reconcile-appset has no concurrency group — two concurrent flights race a shared kubectl apply"
status: needs_implement
priority: 2
rank: 60
estimate: 1
summary: "task.0372's per-node matrix makes app-lever flights truly parallel across nodes, but the `reconcile-appset` job that precedes them is a single-VM `kubectl apply -f appset.yaml` with no `concurrency:` group. Two concurrent flights from different PRs (e.g. PR-A on operator + PR-B on poly) both SSH to the candidate-a VM and both apply the same AppSet to the argocd namespace at the same time. The applies are idempotent (same file content) so the user-visible failure rate is low, but it is the only shared-write left on the parallel-flight path. Fix is a one-line `concurrency:` group on the job."
outcome: |
  - `reconcile-appset` job in `candidate-flight.yml` (and the equivalent in `flight-preview.yml` / `promote-and-deploy.yml` once task.0372 phases 7 + 8 land) carries `concurrency: { group: reconcile-appset-${{ matrix.env || 'candidate-a' }}, cancel-in-progress: false }`.
  - Two concurrent flights from different PRs serialize at this single shared-write step; the per-node matrix downstream remains fully parallel.
  - YAML carries a one-line comment referencing this bug so a future cleanup pass doesn't quietly drop the guard.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
branch: feat/task.0372-matrix-cutover
pr:
created: 2026-04-25
updated: 2026-04-25
labels: [cicd, concurrency, task.0372-followup]
external_refs:
  - work/items/task.0372.candidate-flight-matrix-cutover.md
---

# bug.0378 — reconcile-appset shared-write race

## Problem

After task.0372, the candidate-flight pipeline is:

```
decide → reconcile-appset → matrix(flight) → matrix(verify-candidate) → report-status
                ▲
                └─ ONE job, no concurrency group, SSHes to single VM, kubectl apply
```

Per-node deploy branches, per-node Argo Applications, per-node concurrency groups all give us genuinely parallel flighting on the matrix legs. But `reconcile-appset` precedes the matrix and has no guard. Two simultaneous flights = two concurrent `kubectl apply -f candidate-a-applicationset.yaml` against the same argocd namespace.

In practice:

- Same file content → applies are idempotent → resource version 409s retry → low real-world failure rate.
- BUT: it is the one remaining shared-write on the parallel-flight path, and our diagnostic discipline (the `/tmp/wait-for-argocd-remote.sh` race dev1 caught at commit 5f5cf6e86) says we should fix the class, not wait for it to bite.

## Fix

One-line `concurrency:` group on the `reconcile-appset` job:

```yaml
reconcile-appset:
  needs: decide
  if: needs.decide.outputs.has_targets == 'true'
  # Single shared write to the candidate-a VM (kubectl apply on the AppSet).
  # Without this guard two concurrent flights from different PRs race the apply.
  # See work/items/bug.0378.reconcile-appset-shared-write-race.md.
  concurrency:
    group: reconcile-appset-candidate-a
    cancel-in-progress: false
  runs-on: ubuntu-latest
  ...
```

Same shape repeats in `flight-preview.yml` and `promote-and-deploy.yml` when task.0372's preview/production phases land — group key gets `${{ matrix.env }}` template instead of hardcoded `candidate-a`.

## Validation

- (a) Trigger two `candidate-flight.yml` runs back-to-back from two different PRs touching different nodes; observe the second `reconcile-appset` job sit in `pending` until the first completes. Matrix cells downstream still run in parallel across both PRs.
- (b) Application names + AppSet content unchanged before vs after — pure scheduling guard, no semantic change.

## Out of scope

- Application-name byte-equivalence verification (already manually confirmed pre-merge for task.0372 by reviewer ask).
- Argo CRD upgrade so `preserveResourcesOnDeletion` works again (separate follow-up — no number filed yet; mentioned in dev1 task.0372 wrap).
