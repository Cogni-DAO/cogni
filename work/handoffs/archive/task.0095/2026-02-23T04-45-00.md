---
id: task.0095.handoff
type: handoff
work_item_id: task.0095
status: active
created: 2026-02-22
updated: 2026-02-22
branch: feat/temporal-ledger-workflow
last_commit: cd5cba25
---

# Handoff: Ledger Temporal Workflows — Collection Phase

## Context

- Building the orchestration layer for the transparent credit payouts pipeline (`proj.transparent-credit-payouts`)
- The epoch payout pipeline needs automated GitHub activity collection driven by Temporal schedules reconciled from repo-spec
- Three-layer design: (1) schedule reconciliation, (2) epoch lifecycle, (3) ingestion — each idempotent, separately testable
- All domain infrastructure exists: `GitHubSourceAdapter`, `DrizzleLedgerAdapter`, `@cogni/ingestion-core` ports
- A detailed implementation plan was produced and partially executed (phases 1-3 of 5 complete)

## Current State

- **Done (Phase 1):** `scope_id` column added to `epochs`, `activity_events`, `source_cursors` tables — schema, port types, adapter, migration 0012, all existing test fixtures updated
- **Done (Phase 2):** `scope_id`/`scope_key`/`activity_ledger` added to `.cogni/repo-spec.yaml` + `repoSpec.schema.ts` + scheduler-worker `env.ts`
- **Done (Phase 3):** `CreateScheduleParams` extended with `workflowType`/`taskQueueOverride`; `syncGovernanceSchedules` handles `LEDGER_INGEST` charter → `CollectEpochWorkflow` on `ledger-tasks` queue; schedule adapter wires optional fields through
- **Done:** `source_cursors.scope` renamed to `source_scope` throughout schema/port/adapter/tests
- **Done:** Epoch-ledger spec updated with state machine (`open→review→finalized`), scope approvers, signing workflow
- **Not started (Phase 4):** Ledger activities, `CollectEpochWorkflow`, `ledger-worker.ts`, container wiring, `main.ts` dual-worker startup
- **Not started (Phase 5):** Unit tests for ledger activities, `pnpm check` verification
- **Not started:** `computeProposedAllocations()`, `resolveIdentities()`, `FinalizeEpochWorkflow` (deferred — out of collection-phase scope)

## Decisions Made

- `scope_id` is a stable opaque UUID (never changes); `scope_key` is the human slug — [commit f0e64044](../../.git)
- Separate `ledger-tasks` task queue, separate `ledger-worker.ts` — do NOT modify existing `worker.ts` or `activities/index.ts`
- LEDGER_INGEST schedule detected by charter name in `syncGovernanceSchedules`; uses `LedgerScheduleConfig` from `GovernanceScheduleConfig.ledger` — [commit 5659e4b5](../../.git)
- `FinalizeEpochWorkflow`, `computeProposedAllocations()`, `resolveIdentities()` are follow-up work, not in collection phase
- Monotonic cursor advancement: `saveCursor` should enforce `cursor = max(existing, new)` — never go backwards
- Full plan with pseudocode: `/Users/derek/.claude/plans/inherited-wondering-aho.md`

## Next Actions

- [ ] Create `services/scheduler-worker/src/activities/ledger.ts` — 5 activities: `ensureEpochForWindow`, `loadCursor`, `collectFromSource`, `insertEvents`, `saveCursor`
- [ ] Create `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — pure orchestration via `proxyActivities`
- [ ] Create `services/scheduler-worker/src/ledger-worker.ts` — Temporal Worker for `ledger-tasks` queue
- [ ] Update `services/scheduler-worker/src/bootstrap/container.ts` — add `LedgerContainer` with `DrizzleLedgerAdapter` + `GitHubSourceAdapter`
- [ ] Update `services/scheduler-worker/src/ports/index.ts` — re-export `ActivityLedgerStore` and `SourceAdapter` types
- [ ] Update `services/scheduler-worker/src/main.ts` — start both workers, await both before `ready=true`
- [ ] Write `services/scheduler-worker/tests/ledger-activities.test.ts` — mock store/adapter, test each activity
- [ ] Run `pnpm check && pnpm packages:build && pnpm test`

## Risks / Gotchas

- Existing `worker.ts` and `activities/index.ts` are scheduler-specific — create parallel files, don't merge
- `NODE_ID` and `SCOPE_ID` env vars are optional in the schema — the ledger container should fail fast if they're missing when ledger worker starts
- The `scope_id` in `repo-spec.yaml` is currently `"4ff8eac1-0000-0000-0000-000000000001"` (placeholder UUID) — must match `SCOPE_ID` env var at runtime
- Migration 0012 backfills `scope_id` with `00000000-0000-0000-0000-000000000000` then drops default — existing data gets the zero UUID

## Pointers

| File / Resource                                                                                  | Why it matters                                                        |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [Implementation plan](/Users/derek/.claude/plans/inherited-wondering-aho.md)                     | Full 5-phase plan with pseudocode, file list, and verification steps  |
| [task.0095 work item](../items/task.0095.ledger-temporal-workflows.md)                           | Full design, requirements, plan checklist with phases 1-3 checked off |
| [epoch-ledger spec](../../docs/spec/epoch-ledger.md)                                             | Invariants, state machine, schema, lifecycle                          |
| [packages/ledger-core/src/store.ts](../../packages/ledger-core/src/store.ts)                     | Port interface — `scopeId` on all affected methods                    |
| [DrizzleLedgerAdapter](../../packages/db-client/src/adapters/drizzle-ledger.adapter.ts)          | Store implementation with `scopeId` wired through                     |
| [GitHubSourceAdapter](../../services/scheduler-worker/src/adapters/ingestion/github.ts)          | Working adapter to wire into collect workflow                         |
| [syncGovernanceSchedules](../../packages/scheduler-core/src/services/syncGovernanceSchedules.ts) | LEDGER_INGEST detection, `LedgerScheduleConfig` type                  |
| [schedule-control.port.ts](../../packages/scheduler-core/src/ports/schedule-control.port.ts)     | `workflowType` + `taskQueueOverride` on `CreateScheduleParams`        |
| [Existing worker pattern](../../services/scheduler-worker/src/worker.ts)                         | Follow this pattern for `ledger-worker.ts`                            |
| [Migration 0012](../../src/adapters/server/db/migrations/0012_add_scope_id.sql)                  | scope_id columns, source_scope rename, PK updates                     |
