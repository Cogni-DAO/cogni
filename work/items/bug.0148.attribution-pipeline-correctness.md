---
id: bug.0148
type: bug
title: "Attribution pipeline credits bots and unpromoted PRs — three correctness failures in epoch selection"
status: needs_triage
priority: 0
rank: 10
estimate: 3
summary: "Epoch #12 on preview shows three attribution correctness failures: (1) Cogni-1729 automation account gets 97% credit because GitHub adapter has no bot/automation user exclusion, (2) release PRs authored by the automation account are credited instead of the original feature-branch authors, (3) PR #533 (staging-only, SHA not in any release PR) was included despite never being promoted to main."
outcome: "Attribution pipeline correctly excludes automation accounts, credits original feature-branch authors for promoted work, and never includes unpromoted staging PRs."
spec_refs: [plugin-attribution-pipeline]
assignees: []
credit:
project:
branch: fix/bug-0147-attribution-correctness
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [attribution, correctness, preview]
external_refs:
---

# Attribution pipeline credits bots and unpromoted PRs — three correctness failures in epoch selection

## Observed

Epoch #12 on preview (3/9/2026 – 3/16/2026) shows incorrect attribution:

| Contributor             | Share | Score  | Expected                                        |
| ----------------------- | ----- | ------ | ----------------------------------------------- |
| Cogni-1729 (automation) | 97.1% | 33,000 | 0 — should be excluded                          |
| derekg1729              | 2.9%  | 1,000  | Should have credit for all promoted staging PRs |

Three distinct failures:

### Failure 1: No bot/automation account exclusion

The GitHub adapter (`services/scheduler-worker/src/adapters/ingestion/github.ts:418-427`) skips GitHub `Bot`/`Mannequin` \_\_typename actors but has no mechanism to exclude **GitHub User accounts used for automation** (e.g., Cogni-1729). The `normalizePr` function only checks:

```typescript
if (!pr.author || pr.author.__typename !== "User" || !pr.author.databaseId) {
  return null; // Only skips Bot/Mannequin types
}
```

Cogni-1729 is a regular GitHub User account, so it passes this check and its PRs generate receipts with `platformUserId = Cogni-1729's databaseId`.

### Failure 2: Credit goes to release PR author, not feature-branch author

The promotion-selection policy (`packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts:87-100`) correctly excludes release PRs (`baseBranch === "main" → return false`) and includes promoted staging PRs. However, in the Cogni workflow:

- Cogni-1729 (automation) authors the merge PRs to staging
- These staging PRs get promoted when their `mergeCommitSha` appears in a release PR's `commitShas`
- Credit flows to `platformUserId` (Cogni-1729), not the original feature-branch author

The `platformUserId` is set from `pr.author.databaseId` (`github.ts:430,442`), which is always the PR creator — not the underlying commit authors.

### Failure 3: PR #533 included despite never being promoted to main

PR #533 (`chore: compact pnpm check output by default`) was merged to **staging** (not main) at `2026-03-09T14:01:29Z`. Its merge commit SHA (`3c75a844c94ffac92a3f88dca93d2909550d0adc`) is **NOT** present in PR #534's 47 commits (verified via `gh pr view`). Under the promotion-selection policy, this PR should not be included.

Yet the UI shows derekg1729 credited 1,000 points for this PR in epoch #12. This means either:

- The promotion policy was not applied on a subsequent collection cycle (fallback to include-all)
- Or the `insertSelectionDoNothing` pattern (`services/scheduler-worker/src/activities/ledger.ts:625`) allowed a stale `included=true` row to persist from a previous run

## Expected

1. Automation/bot GitHub accounts should be excluded from attribution via configurable exclusion list
2. Attribution for promoted staging PRs should credit the original feature-branch author(s), not the merge-bot PR author
3. Only staging PRs whose `mergeCommitSha` provably appears in a merged-to-main release PR's `commitShas` should be `included=true`
4. PR #533 should have `included=false` since it was never promoted

## Reproduction

1. Visit preview epoch dashboard → Epoch #12 (3/9 – 3/16)
2. Observe Cogni-1729 at 97.1% share from 33 "release:" PRs
3. Observe derekg1729 at 2.9% for PR #533 (staging-only)
4. Verify PR #533 SHA not in PR #534: `gh pr view 534 --repo Cogni-DAO/node-template --json commits --jq '[.commits[].oid]' | grep 3c75a844` → no match

## Impact

**Critical** — The attribution pipeline is the core value-distribution mechanism. All three failures produce incorrect credit allocation. Automation accounts absorb nearly all credit, human contributors are under-credited, and unpromoted work is incorrectly included.

## Allowed Changes

- `services/scheduler-worker/src/adapters/ingestion/github.ts` — add configurable automation account exclusion
- `packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts` — fix promotion logic
- `services/scheduler-worker/src/activities/ledger.ts` — fix selection persistence (insertSelectionDoNothing race)
- `.cogni/repo-spec.yaml` or config — add excluded accounts list
- Tests for above files

## Plan

- [ ] Add `excludedLogins` (or `excludedPlatformUserIds`) to GitHub adapter config, sourced from repo-spec
- [ ] Add guard in `normalizePr`/`normalizeReview`/`normalizeIssue` to skip excluded accounts
- [ ] Investigate why PR #533 was included — check if a collection cycle ran without the promotion policy or if `insertSelectionDoNothing` caused a stale row
- [ ] Add unit tests for bot exclusion and unpromoted-PR rejection
- [ ] Consider longer-term fix for Failure 2 (commit-level authorship attribution)

## Validation

**Command:**

```bash
pnpm test services/scheduler-worker/tests/github-adapter.test.ts
pnpm test services/scheduler-worker/tests/ledger-activities.test.ts
```

**Expected:** New tests verify automation accounts are excluded and unpromoted PRs are not included.

## Review Checklist

- [ ] **Work Item:** `bug.0148` linked in PR body
- [ ] **Spec:** plugin-attribution-pipeline invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Preview epoch #12: observed on 2026-03-09
- PR #533: https://github.com/Cogni-DAO/node-template/pull/533
- PR #534: https://github.com/Cogni-DAO/node-template/pull/534
- Handoff: [handoff](../handoffs/bug.0148.handoff.md)

## Attribution

- derekg1729 — reported and investigated
