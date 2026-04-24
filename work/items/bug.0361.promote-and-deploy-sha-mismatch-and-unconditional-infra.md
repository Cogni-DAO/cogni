---
id: bug.0361
type: bug
title: "promote-and-deploy: EXPECTED_BUILDSHA uses merge commit SHA; deploy-infra always runs"
status: needs_merge
revision: 1
priority: 1
rank: 1
estimate: 1
created: 2026-04-23
updated: 2026-04-23
project: proj.cicd-services-gitops
assignees: []
summary: "promote-and-deploy fails every preview flight because EXPECTED_BUILDSHA uses the squash-merge SHA but containers carry the PR branch SHA, and deploy-infra runs for 8+ minutes on every promotion regardless of whether compose changed."
outcome: "Same entry point for preview and production (no PR-dance); SHA match works on squash-merged PRs; app-only flights skip the SSH/compose step."
---

# Bug: promote-and-deploy SHA mismatch + unconditional infra

## Symptoms

1. `verify-deploy` fails with `buildSha=<branch-sha> != expected <merge-sha>` on every squash-merged PR.
2. `deploy-infra` runs for 8+ minutes on every promotion regardless of whether compose config changed.

## Root Cause

**SHA mismatch:** `promote-and-deploy.yml` sets `EXPECTED_BUILDSHA` and `source-sha-by-app.json` entries
to `head_sha` — which is the squash-merge commit on main. But images are built by `pr-build.yml` against
the PR branch head SHA (a different commit). The container's `/version.buildSha` reports the branch SHA.
These can never match.

**Unconditional infra:** `deploy-infra` job has no `if:` condition. It runs on every promote-and-deploy
invocation — including pure app-code changes — taking 8+ minutes of SSH + compose-up. The candidate-a
model (two orthogonal levers) proves the pattern; preview/production never adopted it.

## Fix (this PR)

- Add `build_sha` input to `promote-and-deploy.yml` — the PR branch head SHA actually baked into images.
  `source-sha-by-app.json` and `EXPECTED_BUILDSHA` now use `build_sha` instead of `head_sha`.
- Add `skip_infra` input (default `false`). `deploy-infra` job gated on `inputs.skip_infra != 'true'`.
- `unlock-preview-on-failure` condition updated: skipped `deploy-infra` is not a failure.
- `flight-preview.sh` passes `build_sha=$BUILD_SHA` (PR branch head) and `skip_infra=true` on every
  normal app promotion. Infra changes use a separate dispatch with `skip_infra=false`.
- `flight-preview.yml` exposes `BUILD_SHA` env var (= `steps.pr.outputs.pr_head_sha`) to the flight step.

## Validation

- exercise: dispatch `promote-and-deploy.yml` from a merged PR with `skip_infra=true` and verify that
  `verify-deploy` passes with `buildSha` matching the PR branch head SHA.
- observability: `verify-buildsha.sh` logs `✅ operator: buildSha=<pr-head-sha> matches expected`; no
  `deploy-infra` job in the run graph.

## Review Feedback (revision 1)

Self-review of PR #1011 (2026-04-23) found blockers in the job-dependency graph. The
build_sha + skip_infra input wiring is correct, but downstream jobs were not updated to
tolerate a skipped `deploy-infra`, so the PR as-written would break every preview flight.

**Blocking issues to fix before re-review:**

1. **verify/verify-deploy/e2e/lock-preview skip cascade.** GHA treats an `if:` without
   `always()`/`cancelled()`/`failure()` as implicitly prefixed with `success()`. When
   `deploy-infra` is skipped (the `skip_infra=true` path that `flight-preview.sh` now
   triggers on every merge), `success()` → false on all four dependent jobs:
   - `verify-deploy` (needs: deploy-infra) → skipped
   - `verify` (needs: deploy-infra) → skipped
   - `e2e` (needs: verify, verify-deploy) → skipped
   - `lock-preview-on-success` (needs: e2e, if e2e.result == 'success') → skipped
   - `unlock-preview-on-failure` fires because `needs.e2e.result != 'success'`
     Net: preview lease bounces unlocked → dispatching → unlocked forever, never reaches
     reviewing. Fix: each of the four jobs needs
   ```yaml
   if: |
     always() &&
     needs.promote-k8s.result == 'success' &&
     (needs.deploy-infra.result == 'success' || needs.deploy-infra.result == 'skipped') &&
     <existing condition>
   ```
2. **AppSet reconcile regression (bug.0312).** The `Reconcile ArgoCD ApplicationSet
from repo` step lives inside `deploy-infra`. With `skip_infra=true`, that reconcile
   never runs on app-only flights. Template drift accumulates silently. Move the
   reconcile out of `deploy-infra` — into `promote-k8s` or a new always-run job.
3. **Production silent-green risk.** Under the same cascade, a prod dispatch with
   `skip_infra=true` skips `verify-deploy` → pod ships without buildSha contract
   verification. Re-opens the bug.0321 silent-green class.

**Non-blocking:**

- After the cascade fix, exercise the flow end-to-end on an already-merged PR before
  re-requesting review. The current Validation block describes a state the PR cannot
  reach.
- Short runbook for prod dispatch (the exact `gh workflow run` invocation + how to find
  `source_sha` and `build_sha`).
- Consider `type: boolean` for `skip_infra` with `!inputs.skip_infra` comparisons.

## Resolution (revision 1)

Blockers 1–3 addressed in-PR:

1. **Skip cascade fixed.** `verify-deploy`, `verify`, `e2e`, and (implicitly via
   `e2e.result == 'success'`) `lock-preview-on-success` now use explicit result
   guards instead of GHA's implicit `success()`. Each tolerates
   `deploy-infra.result in {success, skipped}`. `e2e` tightens the gate to
   require verify + verify-deploy to have actually succeeded (not skipped) so the
   empty-promotion path still cascades to unlock correctly.
2. **AppSet reconcile moved** out of `deploy-infra` into `verify-deploy` (after
   Setup SSH, before Wait for ArgoCD sync). Runs on every non-empty promotion
   regardless of `skip_infra`. Template-drift (bug.0312) stays closed.
3. **Prod silent-green** closed by the same skip-cascade fix: prod dispatches
   now run `verify-deploy` even when `skip_infra=true`, so `verify-buildsha`
   always gates the deploy.

Reviewer's second blocker (BUILD_SHA implicit env-only) also addressed:

- `flight-preview.sh` takes `build_sha` as positional arg 5 with explicit
  contract (arg > env > SHA fallback). `flight-preview.yml` passes `$BUILD_SHA`
  explicitly. Future callers must pass it or regress bug.0361.

Non-blocking items (prod runbook, boolean type for `skip_infra`) deferred to
PR 2 (full env unification).
