---
id: task.0294
type: task
title: "Policy-gated release: kill auto-release PR conveyor belt"
status: needs_merge
priority: 0
rank: 3
estimate: 2
summary: "e2e.yml auto-creates a release/* branch + PR to main on every preview E2E success. With fast AI iteration, this floods main with release PRs. Change to human-initiated singleton release."
outcome: "Preview E2E success records the candidate SHA. Release PR creation is triggered by workflow_dispatch, not auto-fired. At most one active release PR at a time."
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

# Policy-gated release: singleton release PR

## Context

Current flow in `e2e.yml`: preview E2E passes → `promote-release` job auto-creates `release/YYYYMMDD-<sha>` branch + PR to main. Every preview success generates a new release PR.

With AI agents committing frequently to canary, this creates a conveyor belt of release PRs on main. Most get superseded before anyone reviews them.

The CI/CD spec says: "Preview success does NOT auto-create release PRs. Release promotion is policy-gated. At most one active release PR at a time."

## Changes

### Preview state model (`.promote-state/` on deploy/preview branch)

Three marker files:

- `current-sha` — SHA currently deployed to preview (under human review)
- `candidate-sha` — newest eligible (CI-passed) replacement from canary
- `review-state` — `unlocked` or `reviewing`

### Delete promote-release from e2e.yml

Remove the entire `promote-release` job. Preview E2E success no longer auto-creates release PRs.

### New `scripts/ci/create-release.sh`

- Reads `current-sha` from deploy/preview `.promote-state/`
- If existing release/\* PR to main → close with "Superseded by re-dispatch" comment
- Creates `release/YYYYMMDD-<sha>` branch from that SHA
- Opens singleton PR to main

### New `.github/workflows/release.yml`

- `workflow_dispatch` trigger only (human-initiated)
- Checkout deploy/preview to read marker
- Call `scripts/ci/create-release.sh`

### Unlock on merge: `auto-merge-release-prs.yml`

After merging release PR, add step that writes `review-state=unlocked` to deploy/preview. This closes the lifecycle loop — next eligible canary SHA auto-deploys to preview.

## Validation

1. Preview E2E passes → no release PR auto-created
2. Manual `release.yml` dispatch → singleton release PR from `current-sha`
3. Second dispatch → old PR closed with "Superseded", new one opened
4. `auto-merge-release-prs.yml` merges → sets `review-state=unlocked`
5. Next canary CI-pass after unlock → auto-deploys to preview
