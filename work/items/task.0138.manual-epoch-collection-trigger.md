---
id: task.0138
type: task
status: needs_implement
title: "Manual epoch collection trigger endpoint"
priority: 1
rank: 10
estimate: 2
summary: "Add triggerSchedule() to ScheduleControlPort and expose via POST /api/internal/ops/attribution/collect with INTERNAL_OPS_TOKEN auth. Uses Temporal ScheduleHandle.trigger() to immediately run the existing LEDGER_INGEST schedule — same workflow, same input, no new code paths."
outcome: "Operator can trigger epoch collection on demand (local dev, preview, production) without waiting for the daily cron. All configured sources are collected automatically."
spec_refs:
  - attribution-ledger-spec
  - governance-scheduling-spec
assignees: []
credit:
project: proj.transparent-credit-payouts
branch: feat/dev-trigger-github
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [attribution, temporal, ops, dx]
external_refs:
---

# Manual Epoch Collection Trigger

## Problem

The `CollectEpochWorkflow` runs on a daily cron (`LEDGER_INGEST` schedule, 6am UTC). In preview and local dev, there's no way to trigger epoch collection on demand. This means:

- Preview deployments show empty `/gov/epoch` until the next daily cron fires
- After merging PRs or triggering webhooks, you can't see results in the UI without waiting up to 24h
- Cannot validate the full attribution pipeline before deploying to production

Webhook receipts land in the DB immediately, but epochs, selections, allocations, and projections only get materialized by the Temporal workflow.

## Design

### Outcome

Operator can trigger the full `CollectEpochWorkflow` on demand — creating/updating the current epoch, collecting from all configured sources, materializing selections, and computing allocations — without waiting for the daily cron.

### Approach

**Solution**: Add `triggerSchedule(scheduleId)` to `ScheduleControlPort` and expose it via a new internal ops endpoint. The Temporal SDK's `ScheduleHandle.trigger()` immediately runs the schedule's configured workflow with the correct input envelope and `TemporalScheduledStartTime` — no need to reconstruct the workflow input manually.

This is the simplest path because:

- The LEDGER_INGEST schedule already exists in Temporal (synced at deploy time)
- `ScheduleHandle.trigger()` runs the exact same workflow with the exact same input as the cron would
- No new workflow types, no new activity code, no input construction
- Source-agnostic by design: the workflow iterates `activitySources` from repo-spec, so new collectors (Discord, etc.) are automatically included

**Auth**: `INTERNAL_OPS_TOKEN` Bearer auth — same pattern as the existing governance schedule sync endpoint. This is an operator action, not a user action. The token is:

- Already provisioned in preview and production
- Already used by `deploy.sh` for schedule sync
- 32+ chars, constant-time comparison, no session/wallet needed
- Appropriate for: deploy scripts, operator CLI, future admin UI

**Rejected alternatives**:

- _User-facing refresh button with SIWE auth_: Over-scoped for now. Epoch collection is an operator concern, not a contributor concern. Can be added later by proxying through a user-facing route with approver role check.
- _New endpoint that constructs and starts workflow directly_: Duplicates the schedule's input construction logic (scope, sources, approvers, pool config). Fragile — drifts if repo-spec changes. `trigger()` reuses the schedule's pinned config.
- _Just flip GOVERNANCE_SCHEDULES_ENABLED and wait for cron_: Doesn't solve the "I need to see results now" problem.

### Invariants

- [ ] WRITES_VIA_TEMPORAL: Collection still runs through Temporal workflow (we're triggering the existing schedule, not bypassing Temporal)
- [ ] INTERNAL_OPS_AUTH: Endpoint requires Bearer INTERNAL_OPS_TOKEN
- [ ] TRIGGER_IS_SCHEDULE: Uses ScheduleHandle.trigger() — same workflow, same input, same task queue as the cron
- [ ] SOURCE_AGNOSTIC: No source-specific logic in the trigger — workflow handles all configured sources
- [ ] IDEMPOTENT_SAFE: CollectEpochWorkflow is fully idempotent (receipts, selections, cursors all use ON CONFLICT)

### Files

**Port + Adapter:**

- Modify: `packages/scheduler-core/src/ports/schedule-control.port.ts` — add `triggerSchedule(scheduleId): Promise<void>`
- Modify: `src/adapters/server/temporal/schedule-control.adapter.ts` — implement via `handle.trigger()`

**Endpoint:**

- Create: `src/app/api/internal/ops/attribution/collect/route.ts` — POST endpoint, Bearer INTERNAL_OPS_TOKEN auth, calls `scheduleControl.triggerSchedule("governance:ledger_ingest")`
- Create: `src/contracts/attribution.collect-trigger.internal.v1.contract.ts` — Zod contract for request/response

**Tests:**

- Create: `tests/contract/app/attribution-collect-trigger.internal.test.ts` — auth (401 on missing/wrong token), success (200 + triggered), schedule not found (404)

**No changes needed:**

- No workflow changes (same CollectEpochWorkflow)
- No activity changes (same ledger activities)
- No env var changes (INTERNAL_OPS_TOKEN already exists)
- No deploy.sh changes (operator calls manually or via script)

## Usage

```bash
# Local dev — after running dev:trigger-github
curl -X POST http://localhost:3000/api/internal/ops/attribution/collect \
  -H "Authorization: Bearer $INTERNAL_OPS_TOKEN"

# Preview
curl -X POST https://preview.cognidao.org/api/internal/ops/attribution/collect \
  -H "Authorization: Bearer $INTERNAL_OPS_TOKEN"
```

Could also add a `pnpm dev:collect-epoch` convenience script.

## Validation

- [ ] `pnpm check` passes
- [ ] Contract test: 401 on missing/wrong token, 200 on valid trigger
- [ ] Stack test (optional): trigger endpoint → verify epoch created in DB
- [ ] Manual: `curl` the endpoint with dev:stack running → see epoch in `/gov/epoch`

## PR / Links

- Branch: feat/dev-trigger-github
- Handoff: [handoff](../handoffs/task.0138.handoff.md)
