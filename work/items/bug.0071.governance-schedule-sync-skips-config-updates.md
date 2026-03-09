---
id: bug.0071
type: bug
title: "Governance schedule sync skips config updates — Temporal schedules stuck with stale input"
status: done
priority: 0
estimate: 2
summary: "syncGovernanceSchedules only sets model/input at create time. Existing Temporal schedules hit the conflict→skip path and never get updated. All 4 governance runs fail with 400 'model field is required' because schedules created before the model-required enforcement still carry no model field."
outcome: "Governance schedule sync detects config drift (model, cron, timezone, input) and updates existing Temporal schedules in-place. Governance runs execute successfully with deepseek-v3.2."
spec_refs:
  - scheduler
  - governance-council
assignees: derekg1729
credit:
project: proj.system-tenant-governance
branch: fix/gov-schedules
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [governance, scheduler, temporal]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# bug.0071 — Governance schedule sync skips config updates

## Requirements

### Observed

- `syncGovernanceSchedules` attempts `createSchedule()` → catches conflict → skips if schedule is running
- The `input` payload (including `model`) is only set at creation time
- Schedules created before commit `b28e683d` have `input: { message: "..." }` with **no `model` field**
- The `graphs.run.internal` route now requires `model` (returns 400 if missing)
- Result: all 4 governance schedules fail every run with `{"error":"model field is required"}`
- 20+ failures observed in production logs from 01:45–06:30 UTC on 2026-02-16

### Expected

- When governance config changes (model, cron, timezone, entrypoint), the sync should update existing Temporal schedules
- Schedules should use `deepseek-v3.2` as the model (not `gpt-4o-mini`)

### Root Cause

The `ScheduleControlPort` has no `updateSchedule()` method. The Temporal SDK's `ScheduleHandle.update()` is available but not exposed through the port. The sync logic only has create/pause/resume — no way to push config changes to existing schedules.

### Impact

- **100% governance run failure rate** in production since the model-required change deployed
- Temporal retries each failure, wasting scheduler-worker resources
- No governance council output produced

## Allowed Changes

- `packages/scheduler-core/src/ports/schedule-control.port.ts` — add `updateSchedule` method + widen `ScheduleDescription`
- `src/adapters/server/temporal/schedule-control.adapter.ts` — implement `updateSchedule` using Temporal SDK `handle.update()`
- `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` — use describe→compare→update instead of create→skip
- Change hardcoded model from `gpt-4o-mini` to `deepseek-v3.2`

## Plan

- [ ] Extend `ScheduleControlPort` with `updateSchedule()` and richer `ScheduleDescription`
- [ ] Implement in Temporal adapter using `handle.update()`
- [ ] Change sync conflict path: describe → compare config hash → update if changed, skip if identical
- [ ] Update model to `deepseek-v3.2`
- [ ] Verify with unit tests

## Validation

**Command:**

```bash
pnpm test -- --grep "syncGovernanceSchedules"
```

**Production:** After deploy, governance logs should show `sandbox.execution.started` with `model: "deepseek-v3.2"` instead of 400 errors.

## Review Checklist

- [ ] **Work Item:** `bug.0071` linked in PR body
- [ ] **Spec:** scheduler.md invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/bug.0071-bug.0072.handoff.md)
- Related: task.0068 (dynamic default model selection — future improvement)
- Related: bug.0067 (openrouter/auto model allowlist — separate issue)

## Attribution

-
