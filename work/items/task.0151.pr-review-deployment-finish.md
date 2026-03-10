---
id: task.0151
type: task
title: "PR Review deployment finish — output polish, deployment verification, legacy bot retirement"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Polish PR comment output (add summary counts line to match cogni-git-review), verify preview/production deployment receives webhooks and creates Check Runs, and plan retirement of legacy cogni-git-review bot."
outcome: "PR review output matches cogni-git-review quality (counts, duration, clear formatting), preview/production deployments are verified working, and a plan exists to retire the legacy bot."
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
labels: [review, deployment, polish]
external_refs:
  - https://github.com/cogni-dao/cogni-git-review
---

# PR Review Deployment Finish

## Problem

The PR review feature (task.0149) is functionally complete but needs:

1. Output polish — the PR comment/check summary is sparse compared to the legacy cogni-git-review
2. Deployment verification — preview/production environments haven't been tested
3. Legacy bot retirement — the old cogni-git-review still runs on this repo, creating duplicate checks

## Design

### Outcome

PR review output is clear and informative, deployments work end-to-end, legacy bot retired.

### Approach

**Solution**: Three focused changes:

#### 1. Output Polish (summary-formatter.ts)

Add a summary counts line to match cogni-git-review format:

```
✅ 2 passed | ❌ 0 failed | ⚠️ 0 neutral
```

This is the one material UX gap vs the legacy bot. The per-gate metrics table format is already good (arguably better than the legacy format).

**cogni-git-review output** (for reference):

- Compact PR comment: failed gates only, up to 3
- Check run: detailed per-gate with emoji + counts + duration

**node-template output** (current):

- PR comment: all gates with metrics table (more detailed, good)
- Missing: summary counts line

Decision: Keep our format (all gates shown) but add the counts summary.

#### 2. Deployment Verification (manual + documented)

The deployment infrastructure is already in place:

- CI/CD workflows pass `GH_REVIEW_APP_ID` + `GH_REVIEW_APP_PRIVATE_KEY_BASE64` from secrets (verified in `staging-preview.yml:180-183`, `deploy-production.yml:180-183`)
- Docker compose passes vars via environment (verified in `docker-compose.yml:53-54`)
- Webhook URL documented in `docs/guides/github-app-webhook-setup.md`

What's needed:

- [ ] Verify preview deployment: open a PR, confirm Check Run appears + comment posts
- [ ] Verify production deployment: same verification
- [ ] Verify GitHub App permissions include `checks:write` (manual check of App settings)

#### 3. Legacy Bot Retirement Plan

The legacy `cogni-git-review` bot still runs on this repo:

- It creates a Check Run named `"Cogni Git PR Review"` (same name we're adopting)
- Both bots will create a check with the same name → GitHub shows both (??) or one clobbers the other

Retirement steps:

- [ ] Verify node-template review works on preview
- [ ] Uninstall cogni-git-review GitHub App from `Cogni-DAO/cogni-template` repo
- [ ] Or: disable the cogni-git-review deployment (pause the Railway/DO service)
- [ ] Monitor for 1 week — confirm no regressions

**Rejected**: Running both bots simultaneously — same check name creates confusion.
**Rejected**: Changing our check name to differ — branch protection already expects "Cogni Git PR Review".

### Invariants

- [ ] SUMMARY_COUNTS: PR comment includes pass/fail/neutral counts
- [ ] DEPLOYMENT_VERIFIED: Preview + production deployments create Check Runs
- [ ] SIMPLE_SOLUTION: Minimal code changes, manual verification steps

### Files

- Modify: `src/features/review/summary-formatter.ts` — add counts line
- Modify: `tests/unit/features/review/summary-formatter.test.ts` — update assertions
- Manual: verify preview + production deployments
- Manual: uninstall legacy bot from repo

## Validation

```bash
pnpm check
pnpm test -- tests/unit/features/review/summary-formatter.test.ts
```

Manual: open a PR on preview environment, verify Check Run + PR comment appear.

## Attribution

-
