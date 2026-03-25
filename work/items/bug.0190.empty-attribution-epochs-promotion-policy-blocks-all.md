---
id: bug.0190
type: bug
title: "Empty attribution epochs in preview — promotion-selection policy excludes all receipts when no releases to main exist"
status: needs_triage
priority: 0
rank: 10
estimate: 3
summary: "Preview epoch #14 has 52 ingestion receipts but 0 allocations. The `cogni.promotion-selection.v0` policy requires PRs to be promoted from staging to main via release PRs, but no release PRs to main exist in the epoch window — so `buildPromotedShas()` returns empty and every receipt is excluded. Secondary: GitHub webhook secret mismatch blocks all real-time ingestion. Tertiary: `GovernanceScheduledRunWorkflow` missing from scheduler-tasks workflow bundle (separate crash)."
outcome: "Attribution epochs correctly include receipts even when no release PRs to main exist within the epoch window. Webhook ingestion works in preview."
spec_refs: [plugin-attribution-pipeline]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-20
updated: 2026-03-20
labels: [attribution, preview, priority-0]
external_refs:
---

# Empty attribution epochs in preview — promotion-selection policy excludes all receipts

## Observed

**Epoch #14 on preview is completely empty** despite 52 ingestion receipts existing in the database.

### Loki evidence (2026-03-20 ~06:01 UTC, `service=scheduler-worker, env=preview`)

**Collection phase:**

- `source=github, streams=["issues"], hasCursor=true` — only `issues` stream polled
- `issues` stream: `eventCount=0`, cursor stuck at `2026-03-02`
- `reviews` cursor saved separately at `2026-03-11` but reviews NOT in the collection run's `streams` array

**Selection phase:**

- `epochId=14, totalReceipts=52, newSelections=0`
- `policyRef=cogni.promotion-selection.v0: included=0, excluded=52` — **all 52 receipts excluded**
- `totalAllocations=0, totalProposedUnits=0` — "Projections unchanged — skipping writes"

**Webhook path (all failing):**

- 16+ `webhook verification failed` warnings from `component=webhook-route, source=github` on 2026-03-19
- `GITHUB_WEBHOOK_SECRET` in preview does not match the secret configured in GitHub

**GovernanceScheduledRunWorkflow crash (separate):**

- `TypeError: Failed to initialize workflow of type 'GovernanceScheduledRunWorkflow': no such function is exported by the workflow bundle`
- Affects `scheduler-tasks` queue (non-ledger governance agents), NOT `ledger-tasks`

### Root cause: promotion-selection policy

The policy at `packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts` requires:

1. **`pr_merged` events**: only included if `mergeCommitSha` appears in a release PR's `commitShas` where `baseBranch === "main"` (lines 87-100)
2. **`review_submitted` events**: only included if the review is on a promoted PR (lines 102-110)
3. **All other event types**: unconditionally excluded (line 113: `return false`)

`buildPromotedShas()` (lines 32-48) scans for `pr_merged` receipts with `baseBranch === "main"`. If no PRs were merged to `main` in the epoch window, the promoted set is empty and **nothing can ever be included**.

The repo uses `staging` as the default branch. Releases to `main` happen infrequently. During epochs without a release, every single receipt is excluded — producing empty epochs with zero allocations.

### Secondary: stream resolution

The collection log shows `streams: ["issues"]` but the `reviews` cursor was also touched. The stream resolver may not be including all expected streams (`pulls`, `reviews`, `commits`) for every run. Need to verify `resolveStreams` activity logic.

## Expected

1. Epochs should include receipts for work done during the epoch window, not only work that has been released to main
2. GitHub webhooks should pass verification in preview
3. `GovernanceScheduledRunWorkflow` should be exported from the workflow bundle

## Allowed Changes

- `packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts` — policy logic
- `packages/attribution-pipeline-plugins/src/profiles/cogni-v0.0.ts` — profile config
- `packages/attribution-pipeline-plugins/tests/` — selection policy tests
- `.cogni/repo-spec.yaml` — activity source config if needed
- `services/scheduler-worker/src/workflows/` — workflow bundle exports (GovernanceScheduledRunWorkflow)
- Preview environment secrets (GITHUB_WEBHOOK_SECRET)

## Plan

- [ ] Decide policy fix: either (a) include all staging PRs by default and only exclude if explicitly filtered, or (b) add a fallback that includes staging PRs when no release PRs exist in the window, or (c) change the default policy to something simpler for repos without a staging-to-main release cadence
- [ ] Fix `GovernanceScheduledRunWorkflow` export from `scheduler-tasks` workflow bundle
- [ ] Sync `GITHUB_WEBHOOK_SECRET` between GitHub webhook config and preview env
- [ ] Verify stream resolution includes all expected streams (pulls, reviews, issues)
- [ ] Run a manual collection trigger and confirm allocations are non-zero

## Validation

**Command:**

```bash
pnpm test packages/attribution-pipeline-plugins/tests/plugins/promotion-selection/descriptor.test.ts
```

**Expected:** All tests pass, including a new test for "no release PRs to main in window" scenario producing non-zero inclusions.

**Manual verification:** Trigger collection in preview, then query Loki:

```logql
{service="scheduler-worker", env="preview"} |~ "included="
```

Expected: `included > 0` for at least some receipts.

## Review Checklist

- [ ] **Work Item:** `bug.0190` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0148 (attribution correctness — bot credits, different root cause)
- Related: bug.0143 (selection policy architecture — coupling concern)

## Attribution

-
