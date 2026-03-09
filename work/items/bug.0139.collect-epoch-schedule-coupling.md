---
id: bug.0139
type: bug
title: "CollectEpochWorkflow cannot be invoked without Temporal schedule"
status: needs_triage
priority: 1
rank: 99
estimate: 1
summary: "CollectEpochWorkflow hard-requires TemporalScheduledStartTime search attribute, preventing direct workflow invocation via client.workflow.start(). Must always go through ScheduleHandle.trigger()."
outcome: "CollectEpochWorkflow accepts an optional epoch window override in its input, falling back to TemporalScheduledStartTime only when not provided."
spec_refs:
  - attribution-ledger-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [attribution, temporal, tech-debt]
external_refs:
---

# CollectEpochWorkflow cannot be invoked without Temporal schedule

## Requirements

**Observed**: `CollectEpochWorkflow` reads `TemporalScheduledStartTime` from `workflowInfo().searchAttributes` at `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts:122-129` and throws `ApplicationFailure.nonRetryable` if missing. This search attribute is only set by Temporal's schedule machinery (cron runs and `ScheduleHandle.trigger()`). Any `client.workflow.start("CollectEpochWorkflow", ...)` call fails unconditionally.

**Expected**: The workflow should accept an optional epoch window override in `AttributionIngestRunV1` (e.g. `asOfIso?: string`), falling back to `TemporalScheduledStartTime` only when the override is absent.

**Reproduction**:

```typescript
// This will always throw "TemporalScheduledStartTime missing"
await client.workflow.start("CollectEpochWorkflow", {
  taskQueue: "ledger-tasks",
  workflowId: "manual-test",
  args: [{ input: { version: 1, scopeId: "..." /* ... */ } }],
});
```

**Impact**:

- Manual epoch collection must use `ScheduleHandle.trigger()` (task.0138), coupling the refresh UI to the schedule existing in Temporal
- Cannot write unit/integration tests that start the workflow directly
- If `GOVERNANCE_SCHEDULES_ENABLED=false` and the schedule was never synced, the trigger endpoint returns 404 — no fallback path
- Same coupling exists in `GovernanceScheduledRunWorkflow` (`services/scheduler-worker/src/workflows/scheduled-run.workflow.ts:103-107`)

**Root cause**: Lines 122-129 of `collect-epoch.workflow.ts`:

```typescript
const scheduledStartTime = (
  info.searchAttributes?.TemporalScheduledStartTime as Date[] | undefined
)?.[0];
if (!scheduledStartTime) {
  throw ApplicationFailure.nonRetryable(
    "TemporalScheduledStartTime missing — workflow must be triggered by a schedule"
  );
}
```

## Allowed Changes

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — add optional `asOfIso` to `AttributionIngestRunV1`, use as fallback
- `packages/attribution-ledger/src/epoch-window.ts` — no changes expected (`computeEpochWindowV1` already accepts `asOfIso`)
- Tests for direct workflow invocation

## Plan

- [ ] Add `asOfIso?: string` to `AttributionIngestRunV1` interface
- [ ] Change lines 122-129: use `config.asOfIso ?? scheduledStartTime`, only throw if both are missing
- [ ] Add workflow unit test that starts `CollectEpochWorkflow` directly with `asOfIso` override
- [ ] Consider same fix for `GovernanceScheduledRunWorkflow` (`scheduled-run.workflow.ts:103-107`)

## Validation

**Command:**

```bash
pnpm test services/scheduler-worker
```

**Expected:** All tests pass, including new test for direct invocation with `asOfIso`.

## Review Checklist

- [ ] **Work Item:** `bug.0139` linked in PR body
- [ ] **Spec:** attribution-ledger-spec invariants upheld
- [ ] **Tests:** new test covers direct workflow invocation path
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0138 (manual epoch collection trigger — works around this by using `ScheduleHandle.trigger()`)

## Attribution

-
