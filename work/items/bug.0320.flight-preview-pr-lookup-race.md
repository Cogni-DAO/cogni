---
id: bug.0320
type: bug
title: "flight-preview silently skips every auto-triggered run — gh api commits/{sha}/pulls is eventually consistent"
status: needs_merge
priority: 1
rank: 1
estimate: 1
created: 2026-04-18
updated: 2026-04-18
summary: "flight-preview.yml resolves the merged PR via `gh api repos/{}/commits/{sha}/pulls` immediately after `on: push: main` fires. That endpoint is eventually consistent — for several seconds after merge it returns an empty list. The workflow then prints `No PR associated with {sha} — direct push to main is not a supported flight trigger` and exits with skip=true. Every merge during the 2026-04-18 incident window (#898, #911, #913, #914, #900) hit this path; zero preview promotions fired from auto-trigger. Re-querying the same endpoint minutes later returned the PR cleanly."
outcome: "flight-preview resolves PR number from the merge commit subject's `(#NNN)` suffix (always present on GitHub merge + squash-merge commits) via local git. commits/{sha}/pulls stays as a retry-with-backoff fallback for human-edited titles. Auto-preview advances reliably on every merge to main."
spec_refs:
  - docs/spec/ci-cd.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/flight-preview-pr-lookup-race
pr: https://github.com/Cogni-DAO/node-template/pull/915
related:
  - bug.0315
  - bug.0316
  - PR #900
---

# bug.0320 — flight-preview PR lookup race

## Evidence

Observed 2026-04-18: five consecutive merges to `main` (#898, #911, #913, #914, #900) triggered `flight-preview.yml` runs that all reported `success` — but no `promote-and-deploy.yml` runs fired, and `deploy/preview` stayed pinned to `5d0eb066` from the previous day.

Run log excerpt (representative of all five):

```
Resolve target SHA and associated PR
  PUSH_SHA: 8a3c337b587c5efba7d67dca513582766fb1275f
  ℹ️  No PR associated with 8a3c337b — direct push to main is not a supported flight trigger
```

Verifying the same API call post-hoc:

```
$ gh api repos/Cogni-DAO/node-template/commits/8a3c337b.../pulls
[{"number": 914, "state": "closed", "merged_at": "..."}]
```

The API returns the PR **now**. It returned empty at run-time (within ~1 second of merge).

## Root cause

`gh api .../commits/{sha}/pulls` is backed by an index that lags the actual merge by a few seconds. `flight-preview.yml` fires on push immediately and consults the index before it's populated. The empty response triggers the "direct push to main" branch, which is the intended fallback for human direct-pushes and legitimate non-PR commits — but conflates indexing lag with a real absence of PR association.

No retry, no alternative source. Every auto-triggered run inside the indexing window silently skips.

## Fix

Extract the PR number from the merge commit subject via local git first. GitHub's default merge-commit and squash-merge titles always end in `(#NNN)`:

```
fix(cicd): rollout gate covers all four deployments (bug.0316) (#914)
```

Local `git log -1 --format=%s $HEAD_SHA` is instant and independent of the API index. `commits/{sha}/pulls` stays as a fallback with a bounded retry loop (5 × 3s) for the rare case a human edits the merge title and drops the suffix.

Net: auto-preview advances on every merge. No indexing window, no silent skip.

## Validation

- [ ] Merge this PR
- [ ] Observe next `main` merge: `flight-preview.yml` resolves PR from commit subject, dispatches `promote-and-deploy.yml`
- [ ] `deploy/preview:.promote-state/current-sha` advances to the new SHA after e2e passes

## Follow-ups

- The `commits/{sha}/pulls` endpoint lag is a known GitHub behavior. Worth checking whether other workflows that do post-merge PR lookups (`auto-merge-release-prs.yml` at least reads `gh pr view` which may have its own indexing) are affected by the same class of race. Not urgent — file if observed.
