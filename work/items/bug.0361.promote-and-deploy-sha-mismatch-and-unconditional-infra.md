---
id: bug.0361
type: bug
title: "promote-and-deploy: EXPECTED_BUILDSHA uses merge commit SHA; deploy-infra always runs"
status: needs_merge
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
