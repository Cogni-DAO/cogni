---
id: bug.0359
type: bug
title: "candidate-flight false-green: wait-for-argocd accepts revision-advanced apps whose Deployment stays OutOfSync"
status: needs_implement
priority: 1
rank: 2
estimate: 1
created: 2026-04-23
updated: 2026-04-23
summary: "`scripts/ci/wait-for-argocd.sh` currently trusts `status.sync.revision == EXPECTED_SHA`, acceptable app health, and `kubectl rollout status`. On candidate-a that can still pass while the promoted app's own Deployment resource remains `OutOfSync` on the old digest: Argo has observed the new deploy-branch commit, but it never applied the new Deployment spec. Result: `verify-candidate` reaches `/version` and fails later with an old buildSha even though the sharper failure was already visible in Argo."
outcome: "`wait-for-argocd.sh` keeps waiting until the promoted app's Deployment resource inside the Argo Application reports `status=Synced`, then runs `kubectl rollout status`. Candidate-flight now fails at the Argo gate when operator/resy stay OutOfSync on old digests, instead of surfacing as a misleading downstream `/version` mismatch."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/development-lifecycle.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/bug-0359-wait-for-argocd-deployment-sync
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [ci-cd, candidate-flight, argocd, gitops]
external_refs:
  - bug.0326
  - run 24848960585
  - run 24848134864
---

# bug.0359 — wait-for-argocd accepts revision-advanced apps whose Deployment stays OutOfSync

## Why

After `bug.0358` was fixed, candidate-flight still failed on candidate-a for PR `#999`, but now the failure moved later:

- `Wait for ArgoCD sync on candidate-a` passed.
- `Wait for candidate readiness`, `Wait for in-cluster services`, and smoke checks all passed.
- `Verify buildSha on endpoints` then failed because `https://test.cognidao.org/version` served no parseable `buildSha`, while `poly` updated and `resy` stayed stale depending on the run.

Read-only cluster inspection on candidate-a during run `24848960585` showed the sharper truth:

- `candidate-a-operator`: `status.sync.revision=0043cfa9...` (the new `deploy/candidate-a` commit for PR `#999`)
- `deploy/candidate-a` overlay for operator pointed at fresh digests:
  - app `sha256:d16e8fcd...`
  - migrator `sha256:cb0516d8...`
- live `operator-node-app` Deployment still pointed at old app digest `sha256:95ac2899...`
- live `resy-node-app` Deployment still pointed at old app digest `sha256:60dce9b2...`
- live `poly-node-app` Deployment had updated to the new digest `sha256:a0d5c183...`
- Argo resource list showed:
  - `candidate-a-operator` → `Deployment operator-node-app OutOfSync`
  - `candidate-a-resy` → `Deployment resy-node-app OutOfSync`
  - `candidate-a-poly` → `Deployment poly-node-app Synced`

So the deploy branch really did advance, but Argo had not converged all promoted Deployments to the new manifest.

## Root Cause

`wait-for-argocd.sh` currently treats this state as good enough:

1. `status.sync.revision == EXPECTED_SHA`
2. `status.health.status == Healthy` (or `Progressing` with `phase=Succeeded`)
3. `kubectl rollout status deployment/<name>` succeeds

That is insufficient when the Deployment spec itself is still old:

- `status.sync.revision` only proves Argo observed the new deploy-branch commit.
- app health can stay green because the old pod is healthy.
- `kubectl rollout status` on an unchanged old Deployment returns success immediately because no rollout is in progress.

This disproves the closure assumption left in `bug.0326`: rollout status is **not** a strict superset when Argo never applied the new Deployment spec.

## Design

Keep the existing structure and add one sharper Argo-side gate:

- resolve the promoted app's Deployment name from the Argo Application name
- read the Application's `.status.resources[]`
- require the `Deployment <name>` entry to report `status=Synced`
- only then trust `kubectl rollout status`

This preserves the deliberate choice to ignore noisy top-level `sync.status` (EndpointSlice drift), while still failing on the specific resource that must converge for the app to be considered promoted.

## Validation

- exercise:
  - dispatch `candidate-flight.yml` from this fix branch against PR `#999`
  - inspect `Wait for ArgoCD sync on candidate-a`
- observability:
  - for a stuck app, the wait log now shows `deployment=<name> deploymentStatus=OutOfSync (waiting...)` and keeps issuing Argo reconcile kicks instead of returning success
  - a passing run only leaves the Argo gate after the promoted Deployment resource reports `Synced`
- acceptance:
  - operator/resy-style stale-Deployment states fail in `wait-for-argocd.sh`, not later in `verify-buildsha.sh`
  - poly-only / scheduler-worker-only flights still pass when their Deployment resources converge normally
