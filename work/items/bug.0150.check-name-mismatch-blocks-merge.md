---
id: bug.0150
type: bug
title: "Check name mismatch: code creates 'Cogni PR Review' but branch protection requires 'Cogni Git PR Review'"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "The check-run.ts hardcodes CHECK_RUN_NAME='Cogni PR Review' but .allstar/branch_protection.yaml requires 'Cogni Git PR Review'. PRs will fail the required status check even when the review passes."
outcome: "Check name matches branch protection rule, PRs can merge when review passes."
spec_refs:
  - vcs-integration
assignees: []
credit:
project: proj.vcs-integration
branch: worktree-feat-git-review-v0
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [review, bug, blocking]
external_refs: []
---

# Check Name Mismatch Blocks PR Merge

## Problem

Two sources define the check name differently:

| Location                                     | Value                   |
| -------------------------------------------- | ----------------------- |
| `src/adapters/server/review/check-run.ts:16` | `"Cogni PR Review"`     |
| `.allstar/branch_protection.yaml:11`         | `"Cogni Git PR Review"` |

The code creates a GitHub Check Run named `"Cogni PR Review"`, but Allstar enforces branch protection requiring `"Cogni Git PR Review"`. GitHub matches check names exactly — the PR review will pass but the merge gate will remain unsatisfied.

Additionally, the summary-formatter.ts and PR comment body use `"Cogni PR Review"` as display text. These should also be updated for consistency with the legacy bot's branding.

## Design

### Outcome

Check name matches branch protection rule. PRs merge when review passes.

### Approach

**Solution**: Rename to `"Cogni Git PR Review"` everywhere — aligns with the legacy cogni-git-review bot name and the existing Allstar rule.

**Reuses**: Existing check-run adapter, summary-formatter. Just string changes.

**Rejected**: Updating .allstar/branch_protection.yaml to `"Cogni PR Review"` — would break during transition and diverges from the established brand.

### Invariants

- [ ] CHECK_NAME_MATCHES_BRANCH_PROTECTION: Check name in code must match `.allstar/branch_protection.yaml` context
- [ ] SIMPLE_SOLUTION: String rename, no logic changes

### Files

- Modify: `src/adapters/server/review/check-run.ts:16` — `"Cogni PR Review"` → `"Cogni Git PR Review"`
- Modify: `src/features/review/summary-formatter.ts:22,43` — update display text
- Modify: `tests/external/review/pr-review-e2e.external.test.ts:38` — update `CHECK_RUN_NAME`
- Modify: `tests/unit/features/review/summary-formatter.test.ts:67` — update assertion
- Verify: `work/items/task.0149.pr-review-bot-v0.md` — update R3 description

## Validation

```bash
pnpm check
```

Grep for "Cogni PR Review" in codebase — should return zero matches (all renamed to "Cogni Git PR Review").

## Attribution

-
