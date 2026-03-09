---
id: task.0095.handoff
type: handoff
work_item_id: task.0095
status: active
created: 2026-02-22
updated: 2026-02-23
branch: feat/ledger-ingestion
last_commit: fd71bcae
---

# Handoff: Ledger Collection Pipeline — Review Feedback + Closeout

## Context

- Building automated GitHub activity collection for the transparent credit payouts pipeline (`proj.transparent-credit-payouts`)
- Three-layer design: (1) schedule reconciliation → (2) epoch lifecycle → (3) cursor-based ingestion — each idempotent, separately testable
- Phases 1-3 (DB migration, config, schedule reconciliation) were done by a previous developer; phases 4-5 (activities, workflow, worker, tests) were completed in this session
- A code review produced 9 feedback items — 3 blocking, 6 important — that need to be addressed before closeout
- The work item is at `needs_closeout` but should remain there until review feedback is resolved

## Current State

- **Done (Phases 1-3):** `scope_id` on ledger tables, repo-spec config, `LEDGER_INGEST` schedule reconciliation
- **Done (Phases 4-5):** 5 ledger activities, `CollectEpochWorkflow`, `ledger-worker.ts`, container wiring, dual-worker `main.ts`, 12 unit tests passing, `pnpm check` green
- **Done:** Stack test proving workflow-ID semantics (3 tests, passing) — documents blocking bug #1
- **Done:** External test for collection pipeline (10 tests) — **not yet validated** (requires GitHub App credentials + testcontainers)
- **Not done:** 9 review feedback items (see Next Actions)
- **Deferred:** `computeProposedAllocations()`, `resolveIdentities()`, `FinalizeEpochWorkflow` — out of collection-phase scope

## Decisions Made

- Separate `ledger-tasks` task queue + `ledger-worker.ts` — existing `worker.ts` and `activities/index.ts` untouched
- Ledger worker is opt-in: returns null if `NODE_ID`/`SCOPE_ID` env vars not set
- Activities use closure-factory DI pattern matching existing `createActivities(deps)`
- Monotonic cursor advancement: `saveCursor` enforces `cursor = max(existing, new)`
- Epoch statuses in DB model are only `"open"` | `"closed"` (not review/finalized yet)

## Next Actions

- [ ] **Fix blocking #1:** Workflow ID prevents multiple collects per epoch — include run date in ID or use ALLOW_DUPLICATE policy (`collect-epoch.workflow.ts`, schedule sync)
- [ ] **Fix blocking #2:** `ensureEpochForWindow` throws on closed epoch — catch EPOCH_WINDOW_UNIQUE or query by window regardless of status (`activities/ledger.ts:110-156`)
- [ ] **Fix blocking #3:** Hardcoded `getStreamsForSource` in workflow — pass stream IDs through workflow input instead (`collect-epoch.workflow.ts:133-140`)
- [ ] **Fix #4:** Remove `scopeId` from `EnsureEpochInput` — use only the closure-captured value from deps
- [ ] **Fix #5:** `producerVersion` hardcoded as `"0.1.0"` — propagate `adapter.version` through `CollectFromSourceOutput`
- [ ] **Fix #6:** Cursor monotonicity assumes ISO timestamps — document or branch on cursor type
- [ ] **Fix #8:** Dead ledger worker doesn't trigger shutdown — propagate `worker.run()` rejection
- [ ] Add missing unit tests: closed-epoch handling, wrong-window epoch, cursor with non-null value, producerVersion mapping
- [ ] Run `pnpm test:external` to validate external tests (requires GitHub App creds)
- [ ] `/closeout` after all feedback resolved

## Risks / Gotchas

- The external test for closed-epoch handling (`ensureEpochForWindow` with closed epoch) is written as a try/catch — it documents feedback bug #2 and will fail until fixed
- The stack test for duplicate workflow IDs _expects_ `WorkflowExecutionAlreadyStartedError` — update the assertion after fixing #1
- `NODE_ID`/`SCOPE_ID` are optional in env schema — ledger container returns null if missing, but the workflow still receives `scopeId` in input (dual-source confusion, feedback #4)
- Feedback #7 (no allocation recomputation) is a product question, not a code bug — decide whether to add a step to `CollectEpochWorkflow` or defer to a separate on-demand API

## Pointers

| File / Resource                                                                                      | Why it matters                                                  |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [task.0095 work item](../items/task.0095.ledger-temporal-workflows.md)                               | Full design, invariants, plan checklist                         |
| [activities/ledger.ts](../../services/scheduler-worker/src/activities/ledger.ts)                     | 5 activity functions — feedback items #2, #4, #5, #6 apply here |
| [collect-epoch.workflow.ts](../../services/scheduler-worker/src/workflows/collect-epoch.workflow.ts) | Workflow orchestration — feedback items #1, #3 apply here       |
| [ledger-worker.ts](../../services/scheduler-worker/src/ledger-worker.ts)                             | Ledger task queue worker — feedback #8 applies here             |
| [main.ts](../../services/scheduler-worker/src/main.ts)                                               | Dual-worker startup                                             |
| [container.ts](../../services/scheduler-worker/src/bootstrap/container.ts)                           | `createLedgerContainer()` — opt-in wiring                       |
| [Unit tests](../../services/scheduler-worker/tests/ledger-activities.test.ts)                        | 12 tests — add missing coverage per feedback #9                 |
| [External tests](../../tests/external/ingestion/ledger-collection.external.test.ts)                  | 10 tests — **unvalidated**, needs GitHub App creds              |
| [Stack test](../../tests/stack/ledger/collect-epoch-workflow-id.stack.test.ts)                       | Workflow-ID semantics — 3 tests, passing                        |
| [epoch-ledger spec](../../docs/spec/attribution-ledger.md)                                           | Invariants, state machine, schema                               |
