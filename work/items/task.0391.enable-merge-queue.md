---
id: task.0391
type: task
title: "Enable GitHub Merge Queue on main — fix stale-rebase merge-order bugs without manual rebase tax"
status: needs_review
priority: 1
rank: 35
estimate: 2
summary: "PR #1033/#1070 ordering bug — #1033 squash-merged at a PR-head SHA whose build predated #1070, silently rolling back #1070's race guards in preview-poly until #1072 landed. Same bug class as PR #924. GitHub Merge Queue prevents it structurally: contributors mark a PR for merge → GH rebases on current main → re-runs required checks on the rebased commit → merges in order on green. Same defense as `Require branches to be up-to-date` without the rebase-thrash tax that's hostile to external contributors."
outcome: |
  - GitHub Merge Queue enabled on `main` via branch protection.
  - Required workflows trigger on `merge_group:` so the queue's rebased candidate is actually re-tested AND rebuilt (without this, required checks pass vacuously and pre-rebase images get re-tagged for preview).
  - Required-status set keeps today's runtime gates (`unit, component, stack-test, CodeQL, Validate PR title`), adds `static`, and adds `manifest` (the pr-build aggregator) so the queue can't squash-merge before the rebased image exists in GHCR.
  - `pr-build.yml` accepts `merge_group:` events and overwrites the `pr-{N}-{X}` tag with rebased-tree content. flight-preview's existing re-tag path then pulls correct content. This is the load-bearing structural fix — the merge queue's only meaningful purpose in our pipeline is anchoring preview content to the merged tree.
  - Branch-protection + merge-queue config committed to `infra/github/` as JSON payloads, applied once via `gh api PUT`. GitOps source-of-truth without a reconciler workflow (deferred until drift becomes a real issue).
  - `docs/spec/agentic-contribution-loop.md` extended with the merge step: agent calls `core__vcs_merge_pr` → GH enqueues → queue rebases + retests + rebuilds → push:main triggers flight-preview → human reviews preview.
  - `core__vcs_merge_pr` adapter swap to GraphQL `enablePullRequestAutoMerge` is OUT OF SCOPE for this PR — separate follow-up (PR-C). Today's adapter does direct merge; that path will fail with 405 once the queue is enabled, forcing the swap. Sequenced this way so PR-A is purely additive and reviewable without behavioral risk.
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/agentic-contribution-loop.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-27
updated: 2026-04-27
labels: [cicd, branch-protection, contributor-experience]
external_refs:
  - work/items/task.0376.preview-production-matrix-cutover.md
  - work/items/task.0384.vcs-flight-endpoint.md
---

# task.0391 — Enable GitHub Merge Queue on main

> Renumbered from `task.0383` (id collision with shared-readyz task that landed in 16433e3f7 ride-along PR #1074). Original draft + handoff lived on the `chore/cicd-followups-merge-queue` branch; rebased into this work item.

## Problem

PRs to `main` merge without enforced rebase. Recurring bug class:

1. PR-A merges (e.g. #1070, race guards).
2. PR-B was branched from main before PR-A landed, never rebased.
3. PR-B squash-merges at its old PR-head SHA. Squash-merge image content **doesn't include PR-A**.
4. Post-merge promotion pushes PR-B's stale image digest to `deploy/preview-*`. Argo reconciles **backwards** to no-PR-A code.

PR #1033 ⇒ ~30 min of preview drift. PR #924 was the same shape earlier. With external contributors coming online, this gets worse fast.

## Two structural fixes considered

### Option A — `Require branches to be up-to-date`

One-checkbox fix. Greys out merge button until PR is rebased on current main.

**Rejected**: every merge to main invalidates every open PR's up-to-date status. With ≥2 PRs in flight, contributors burn cycles re-rebasing. Especially hostile to external contributors whose flow is "open PR, wait for review."

### Option B — GitHub Merge Queue (chosen)

Author marks PR "Merge when ready" → GH queues it → rebases on top of current main → re-runs required checks on the rebased commit → merges in order on green. Author doesn't touch the PR.

Same defense as A; no rebase tax on contributors. Vendor-portable: GitLab Merge Trains is the equivalent.

## Outcome (PR-A — this PR)

Purely additive. No behavior change until the toggle (PR-B) flips. Once flipped, image content under `preview-{mainSHA}` is anchored to the merged tree by construction.

- **`.github/workflows/ci.yaml`** — `merge_group:` trigger added. Concurrency group already keys off `github.ref`, which distinguishes `pull_request`, `merge_group`, and `push:main` axes.
- **`.github/workflows/pr-build.yml`** — `merge_group:` trigger added with a new `resolve` job that derives PR number, original head SHA, base ref, build SHA, and checkout ref from either event payload. On `merge_group`, the queue commit (Y) is checked out and built, then pushed under tag `pr-{N}-{X}` (overwriting the pre-rebase image). flight-preview's existing re-tag step then pulls correct (rebased-tree) content.
- **`infra/github/branch-protection.json`** — required-status set: `CodeQL, Validate PR title, static, unit, component, stack-test, manifest`. The `manifest` addition is load-bearing: without it, the queue can squash-merge before pr-build(merge_group) overwrites the image tag, recreating the bug class.
- **`infra/github/merge-queue.json`** — desired queue config (squash, ALLGREEN grouping, depth caps tuned for ~1-2 PR/day cadence).
- **`infra/github/README.md`** — apply procedure, drift detection, deferred-work rationale.
- **`docs/spec/agentic-contribution-loop.md`** — merge step + image-tag mechanism documented; new `MERGE_QUEUE_DETERMINISM` and `NO_AGENTIC_REBASE` invariants.

### Serialization with `promote-and-deploy`

Path A doesn't change the post-merge serialization model:

1. `flight-preview.yml` concurrency group `flight-preview` ensures one workflow at a time on `push:main`.
2. `flight-preview.sh`'s three-value lease (`unlocked → dispatching → reviewing`) ensures one `promote-and-deploy` runs at a time against `deploy/preview-*`.
3. Subsequent merges land cleanly because their image tags are different (different `N`).

Sequence guarantee inside one PR's lifecycle:

- `pr-build(pull_request)` completes before queue accepts (it's a required-on-PR check).
- `pr-build(merge_group)` completes before queue squash-merges (it's a required-on-merge_group check via `manifest`).
- `flight-preview` runs after squash-merge, by which time `pr-{N}-{X}` content = Y's tree.

Cross-event race within one PR (force-push while enqueued) is eliminated by GitHub's queue eviction-on-push behavior.

## Out of scope (deferred)

- **PR-B (admin toggle)**: enable repo auto-merge + apply `branch-protection.json` + enable merge queue. One-time admin click; tracked in this task's `## Manual Steps` (post-merge addendum).
- **PR-C (adapter swap)**: `core__vcs_merge_pr` adapter switches from direct REST merge to GraphQL `enablePullRequestAutoMerge`. Required because direct merge will return 405 once queue is enabled. Separate PR because it changes pr-manager graph's expected return shape (synchronous "merged: true, sha: X" → "enqueued, no SHA yet").
- **`deploy_verified` as a required status check**: currently the `validate-candidate` skill outputs a Markdown PR comment, not a programmatic check-run. Becoming a gate would require the GitHub App to run the skill itself. Not yet possible. Tracked separately if/when that automation lands.
- **Branch-protection reconciler workflow**: would require granting the cogni-git-review GH App `administration:write`. Not justified for a config that changes ~quarterly. Revisit if drift recurs.

## Why this is appropriate at MVP stage

The MVP-stage rule cautions against platform-grade infra before validating one flow end-to-end. The countervailing question: is this fixing a real, repeated problem? Bug count = 2 (PR #924, PR #1033). Both shipped silent regressions to a downstream env. Lighter-weight alternatives (option A; "operator-driven rebase via core\__vcs_\*") were considered:

- Option A loses on contributor experience (validated in past).
- Operator-driven rebase puts an LLM in the merge path → non-deterministic, non-auditable. Conflicts with the project's "deterministic tools, not ad-hoc agentic ops" stance.

GitHub Merge Queue is the deterministic vendor primitive. ~108 LOC of bespoke code total, zero rebase logic.

## Validation

- exercise: after PR-B (toggle) lands, open a no-op docs PR, call `core__vcs_merge_pr` (or click "Merge when ready" in the UI), confirm GH enqueues it. Open a second PR while the first is queued; confirm the second waits, auto-rebases on the first's merge, re-runs checks, merges.
- observability: GH branch-protection event log shows queue activity. `gh api repos/Cogni-DAO/node-template/branches/main/protection | jq '.required_status_checks.contexts'` matches the file.

## PR / Links

- PR-A (this PR): [chore/enable-merge-queue]
- Reference pattern: [task.0384.vcs-flight-endpoint.md](task.0384.vcs-flight-endpoint.md) — same `VcsCapability` port + Zod contract pattern that PR-C will extend.
