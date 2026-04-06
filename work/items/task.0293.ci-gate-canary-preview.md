---
id: task.0293
type: task
title: "Gate canary→preview promotion on CI success"
status: needs_merge
priority: 0
rank: 2
estimate: 1
summary: "e2e.yml promote-to-staging dispatches preview promotion without checking ci.yaml status. Hard invariant violation — broken code (failing typecheck/tests) can reach preview and create release PRs."
outcome: "Canary→preview promotion only fires when BOTH build-multi-node AND ci.yaml succeed. Broken code never reaches preview."
spec_refs: [ci-cd-spec]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr_url:
created: 2026-04-05
updated: 2026-04-06
labels: [ci-cd, deploy]
---

# Gate canary→preview promotion on CI success

## Context

On canary push, two workflows fire in parallel:

- `build-multi-node.yml` — builds images
- `ci.yaml` — typecheck, lint, unit, component, stack tests

`promote-and-deploy.yml` gates on build-multi-node success. `e2e.yml` promote-to-staging then dispatches preview promotion. **Neither checks ci.yaml status.** Broken code (failing CI) can promote all the way to preview and create release PRs.

This is a hard invariant from the CI/CD spec: "canary→preview promotion MUST gate on CI success."

## Changes

Extract promotion logic from `e2e.yml` into `scripts/ci/promote-to-preview.sh`. The script:

1. Single `gh run list` call to check CI status — no polling loops
   - CI not finished → exit 0, do nothing (next canary push retries naturally)
   - CI failed → exit 0, do nothing (failed SHAs are never eligible)
   - CI passed → proceed to preview state check
2. Read `review-state` from `deploy/preview:.promote-state/` via `git show`
   - If `reviewing` → write `candidate-sha` only, skip deploy
   - If `unlocked` → write `current-sha`, set `review-state=reviewing`, dispatch promote-and-deploy

In `e2e.yml`:

- Rename `promote-to-staging` → `promote-to-preview`
- Replace inline dispatch with call to `scripts/ci/promote-to-preview.sh`

Combined with task.0294 (same PR touches same files).

## Validation

1. Push to canary, CI passes, preview unlocked → preview deploys, state = `reviewing`
2. Push to canary, CI fails → nothing written, no deploy
3. Push to canary, CI not finished → nothing written, no deploy
4. Push to canary, CI passes, preview reviewing → `candidate-sha` updated, no deploy
