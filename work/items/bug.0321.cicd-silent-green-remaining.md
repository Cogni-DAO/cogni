---
id: bug.0321
type: bug
title: "CICD silent-green: remaining paths that report success without verifying deploy state"
status: needs_merge
priority: 1
rank: 1
estimate: 2
created: 2026-04-18
updated: 2026-04-18
reviewer: derekg1729
summary: "After PRs #913 (scheduler-worker ConfigMap), #914 (rollout gate for all deployments), #915 (flight-preview PR-lookup race), #917 (verify-buildsha + flight-preview hard-fail on no-PR push), #921 (flight-preview queue-only surfaces as skipped), four silent-green paths remain where a workflow reports success without verifying the deploy-state delta. Consolidating them under one bug so we can close them together and stop calling CICD 'proper' until they're gone."
outcome: "Every CICD path either (a) proves the expected state-delta held, or (b) visibly reports a non-green outcome (skipped/failed/warning). No workflow ever reports success for a run that produced no verified state change."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/services-architecture.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/flight-preview-queue-visible
pr: 921
related:
  - bug.0315
  - bug.0316
  - bug.0320
  - PR #913
  - PR #914
  - PR #915
  - PR #917
  - PR #921
---

# bug.0321 — CICD silent-green: remaining paths

## Context

The 2026-04-18 incident surfaced a class of failure: GitHub Actions workflows reporting `success` (green checkmark) while the actual deploy state never advanced. Five back-to-back fixes closed the most egregious instances. Four remain — same class, different workflow.

## Remaining gaps

### 1. `candidate-flight.yml` green before Argo has synced the new spec

Observed 2026-04-18 on PR #920's flight by pr-coordinator-v0 (22:09 green; 22:13 pods finally rolled).

**Mechanism**: `candidate-flight.yml` runs `wait-for-candidate-ready.sh` + `wait-for-in-cluster-services.sh` (kubectl rollout status). Both gates return immediately if there is no rollout in progress. When Argo hasn't yet picked up the new deploy-branch commit, the Deployment spec still points at the old image — kubectl sees a fully-rolled-out old ReplicaSet and returns success. Workflow green; pods not yet on the new image.

**Fix**: wire `scripts/ci/wait-for-argocd.sh` into `candidate-flight.yml` **before** `wait-for-in-cluster-services.sh`, same pattern as `promote-and-deploy.yml`. `wait-for-argocd.sh` asserts `status.sync.revision == EXPECTED_SHA && health == Healthy` for each promoted Application, which guarantees Argo has pushed the new spec into k8s before we check rollout state.

**Scoping**: `wait-for-argocd.sh` accepts `PROMOTED_APPS` (CSV). `scripts/ci/promote-build-payload.sh` currently doesn't emit this output — either:

- (a) Have `promote-build-payload.sh` write a `promoted_apps=...` line to `$GITHUB_OUTPUT` when run under Actions (same `emit_status` pattern as `flight-preview.sh`)
- (b) Default to the full candidate-a AppSet catalog and rely on wait-for-argocd.sh's existing skip-if-not-built semantics (weaker but simpler)

Option (a) is the correct structural fix.

### 2. `promote-and-deploy.yml` empty `promoted_apps` is warn-only, not a distinct outcome

PR #917 added a `::warning::` + `$GITHUB_STEP_SUMMARY` banner when `promote-k8s` produces no new digests. The job still reports **success**.

**Why this is a problem**: a push-triggered run by `flight-preview` that ended up with zero promotions means either:

- The source PR was a CI/workflow-only change — no images expected → correct no-op, fine.
- Upstream `pr-build.yml` failed to produce expected images → bug, masked as green.

The workflow can't trivially distinguish these two at runtime, so the current warn-only stance is conservative. But it still paints a green check and keeps `lock-preview-on-success` writing `current-sha`, advancing preview's review state against an unchanged overlay. Operators correctly lose trust in green.

**Fix**: apply the same split-job pattern as flight-preview (PR #921):

- `promote-k8s` emits `status=promoted|no-op` to `$GITHUB_OUTPUT`.
- A downstream `deploy-preview-verified` job is gated on `status == 'promoted'`. A no-op run surfaces it as **skipped** (grey) in the checks list, distinguishable from a true deploy.
- For the no-op case, do NOT transition `lock-preview-on-success` to `reviewing` with the new SHA — either skip the lock transition or write it with a `noop: true` marker. (Open question — preview lease semantics need thought.)

### 3. Production `verify-buildsha` has no cross-PR verifier

PR #917's `verify-buildsha.sh` is preview-only. Production promotions via `promote-to-production.sh` copy preview's overlay wholesale — digests for different nodes can come from different PR head SHAs (operator from PR A, poly from PR B, etc). There is no single `EXPECTED_BUILDSHA` that covers all nodes, so the gate is disabled for production.

**Fix sketch**: a cross-PR verifier that, for each node in the production overlay:

1. Reads the node's current digest from `infra/k8s/overlays/production/<node>/kustomization.yaml`.
2. Looks up the corresponding tag in GHCR via `docker buildx imagetools inspect` and extracts the `BUILD_SHA` label (would require `pr-build.yml` to write BUILD_SHA as an OCI label on the image).
3. curls `/readyz` on that node's production endpoint and asserts `.version` matches.

Preferred simpler path: have `promote-to-production.sh` write a per-node `source-sha` map into `.promote-state/` (operator → SHA_A, poly → SHA_B, ...), and have the production verifier read that map + assert per-node.

### 4. `wait-for-candidate-ready.sh` passes while Argo `sync.status=OutOfSync`

The readiness gate in `candidate-flight.yml` only curls `/readyz` — any running pod answers HTTP 200 regardless of Argo sync state. Cosmetic EndpointSlice drift today; load-bearing when the drift isn't cosmetic tomorrow.

**Fix**: dissolved by gap #1's fix. Once `wait-for-argocd.sh` runs first (proving `sync.revision == EXPECTED_SHA && Healthy`), the readiness probe can no longer accept old-pod 200s. Reinforced structurally: `wait-for-argocd.sh` exports `ARGOCD_SYNC_VERIFIED=true` to `$GITHUB_ENV`; `wait-for-candidate-ready.sh` refuses to run without the marker. Runtime-enforced, not review-time convention.

## Acceptance

- [x] PR wires `wait-for-argocd.sh` into `candidate-flight.yml`, with `promote-build-payload.sh` emitting `promoted_apps` so the gate is correctly scoped. (Fix 1 + Fix 2)
- [x] `promote-and-deploy.yml` produces a visibly-distinct outcome (grey-skipped `verify-deploy` job) when `promoted_apps=""`, not a plain green success. (Fix 3)
- [x] Production `verify-buildsha` variant exists and is wired into `promote-and-deploy.yml`'s production path. `promote-to-production.sh` forwards the per-node source-sha map from preview. (Fix 4)
- [x] Gate-ordering invariant enforced structurally: `wait-for-candidate-ready.sh` refuses to run without `ARGOCD_SYNC_VERIFIED=true`. (Fix 4)

## Validation

- Flight a PR that touches only `nodes/poly/*` → candidate-flight blocks on Argo sync for `candidate-a-poly` before reporting green. Observe the `wait-for-argocd` step log the reconcile wait, not return immediately.
- Dispatch `flight-preview.yml` with a workflow-only SHA (like a skill-only change) → `promote-and-deploy.yml` runs, produces zero promotions, and surfaces the `deploy-preview-verified` (or equivalent) job as **skipped** in the checks list, not green.
- First real production promotion that spans multiple PRs → each node's `/readyz.version` compared against its overlay digest's baked SHA; verifier fails red on any mismatch.

## Non-goals

- Not re-opening any of the fixes already landed (#913, #914, #915, #917, #921). Those are done.
- Not changing the preview lease model.

## Related

- bug.0315 — scheduler-worker routing override (fixed, PR #913)
- bug.0316 — rollout gate covers all four deployments (fixed, PR #914)
- bug.0320 — flight-preview PR-lookup race (fixed, PR #915)
- PR #917 — flight-preview hard-fail + verify-buildsha.sh (merged)
- PR #921 — flight-preview queue-only surfaces as skipped (in review)
- Handoff: [handoff](../handoffs/bug.0321.handoff.md)
