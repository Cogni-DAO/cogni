---
id: task.0138.handoff
type: handoff
work_item_id: task.0138
status: active
created: 2026-03-07
updated: 2026-03-07
branch: feat/dev-trigger-github
last_commit: 665cf5db
---

# Handoff: Manual Epoch Collection Trigger

## Context

- The attribution pipeline collects GitHub activity (PRs, reviews, issues) into epochs via `CollectEpochWorkflow`, which runs on a daily cron (LEDGER_INGEST schedule, 6am UTC)
- Webhook receipts land in the DB immediately, but epochs/selections/allocations only materialize when the Temporal workflow runs
- Preview and local dev have no way to trigger this on demand — you wait up to 24h to see results in `/gov/epoch`
- This task adds a `POST /api/internal/ops/attribution/collect` endpoint that triggers the existing LEDGER_INGEST schedule immediately via `ScheduleHandle.trigger()`
- The branch also includes `pnpm dev:trigger-github` — a script to create real GitHub fixtures (merged PR + closed issue) for webhook testing

## Current State

- **Done**: `pnpm dev:trigger-github` script + guide updates (committed, pushed on `feat/dev-trigger-github`)
- **Done**: Design for the trigger endpoint (work item at `needs_implement`)
- **Not started**: The actual endpoint implementation (`triggerSchedule()` port method, route, contract, tests)
- The branch is 4 commits ahead of staging, clean working tree

## Decisions Made

- Use `ScheduleHandle.trigger()` (Temporal SDK) — reuses the schedule's pinned config, no need to reconstruct workflow input
- Auth via `INTERNAL_OPS_TOKEN` Bearer token — same pattern as existing `POST /api/internal/ops/governance/schedules/sync`
- No new env vars needed — `INTERNAL_OPS_TOKEN` already provisioned everywhere
- Source-agnostic: the workflow iterates `activitySources` from repo-spec, so new collectors inherit automatically
- See full design in [task.0138](../items/task.0138.manual-epoch-collection-trigger.md)

## Next Actions

- [ ] Add `triggerSchedule(scheduleId): Promise<void>` to `ScheduleControlPort`
- [ ] Implement in `TemporalScheduleControlAdapter` via `handle.trigger()`
- [ ] Create `POST /api/internal/ops/attribution/collect` route with INTERNAL_OPS_TOKEN auth
- [ ] Create Zod contract `attribution.collect-trigger.internal.v1.contract.ts`
- [ ] Write contract test (401/200/404 cases)
- [ ] Optional: add `pnpm dev:collect-epoch` convenience script
- [ ] Test end-to-end: `dev:trigger-github` → `dev:collect-epoch` → see results in `/gov/epoch`

## Risks / Gotchas

- `ScheduleHandle.trigger()` requires the LEDGER_INGEST schedule to exist in Temporal — if `GOVERNANCE_SCHEDULES_ENABLED=false` and schedule sync never ran, the trigger will 404. The endpoint should return a clear error in this case.
- The `CollectEpochWorkflow` expects `TemporalScheduledStartTime` search attribute — verify that `trigger()` sets this correctly (it should, per Temporal docs, but confirm in a stack test).
- The existing `ScheduleControlPort` has no `triggerSchedule` method yet — this is a new port method, so the test adapter/mock also needs updating.
- Preview has `GOVERNANCE_SCHEDULES_ENABLED` set — confirm whether the LEDGER_INGEST schedule actually exists there before testing.

## Pointers

| File / Resource                                                     | Why it matters                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `work/items/task.0138.manual-epoch-collection-trigger.md`           | Full design with approach, invariants, file list             |
| `src/app/api/internal/ops/governance/schedules/sync/route.ts`       | Reference implementation for INTERNAL_OPS_TOKEN auth pattern |
| `packages/scheduler-core/src/ports/schedule-control.port.ts`        | Port to extend with `triggerSchedule()`                      |
| `src/adapters/server/temporal/schedule-control.adapter.ts`          | Temporal adapter — already has `getHandle()` pattern         |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | The workflow that gets triggered                             |
| `scripts/dev/trigger-github-fixtures.mts`                           | Dev script for creating GitHub fixtures                      |
| `docs/guides/github-app-webhook-setup.md`                           | Setup guide with full dev flow                               |
