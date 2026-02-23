---
id: task.0103.handoff
type: handoff
work_item_id: task.0103
status: active
created: 2026-02-23
updated: 2026-02-23
branch: fix/scope-gated-queries
last_commit: e2ac1b60
---

# Handoff: SCOPE_GATED_QUERIES — scope-gate all epochId-based adapter methods

## Context

- The ledger system tracks epoch-based credit payouts scoped to (node_id, scope_id) pairs
- Before this task, `DrizzleLedgerAdapter` methods that took `epochId` only checked `WHERE id = $epochId` — no scope enforcement, enabling cross-tenant data access
- This is a security fix: scope mismatches now throw `EpochNotFoundError` (indistinguishable from non-existent epoch)
- The port interface (`ActivityLedgerStore`) is unchanged — scope is an adapter-internal concern via constructor injection
- This task is a blocker for task.0100 (3-phase state machine) and transitively task.0102 (finalize workflow)

## Current State

- **Implementation: COMPLETE** — all reads and writes scope-gated, committed at `c6e5cca3`
- **Merged staging** into branch at `5d2c29fc` (resolved 2 conflicts cleanly)
- **Tests: 40/40 green** including 12 new `SCOPE_GATED_QUERIES` isolation tests
- **`pnpm check`: all pass** (typecheck, lint, format, arch, docs)
- **Status: `needs_review`** — ready for code review and PR creation
- task.0100 design is on this same branch at `needs_implement` (not yet coded)

## Decisions Made

- **Option B chosen**: scopeId injected at adapter construction, not added to port method signatures — see [task.0103 design](../items/task.0103.scope-gated-queries-retrofit.md#approach)
- **No schema changes**: child tables lack `scope_id` but `epoch_id` is globally unique (bigserial PK), so scope-gating the epoch lookup is sufficient
- **RLS deferred**: app-level `WHERE scope_id` is the V0 fix; Postgres RLS is defense-in-depth for later
- **Write methods also gated** (review feedback): `upsertCuration`, `insertCurationDoNothing`, `insertAllocations`, `insertPoolComponent`, `insertPayoutStatement` all validate epochId scope before writing
- **Added `getScopeId()`** to `repoSpec.server.ts` following the existing `getNodeId()` cached accessor pattern

## Next Actions

- [ ] Create PR for this branch against staging
- [ ] Get code review on the scope-gating implementation
- [ ] Merge task.0103
- [ ] Implement task.0100 (3-phase epoch state machine — design complete, on same branch)
- [ ] Design task.0102 (allocation computation + FinalizeEpochWorkflow — blocked by 0100 + 0101)

## Risks / Gotchas

- **Extra SELECT per call**: `resolveEpochScoped` adds one epoch lookup before each child-table query. Acceptable for correctness in V0; can optimize with per-request caching later if profiling shows need
- **`getScopeId()` throws** if `scope_id` missing from repo-spec — this is intentional (fail-fast), but means ledger features require `scope_id` in `.cogni/repo-spec.yaml`
- **Branch carries multiple tasks**: `feat/ledger-api-routes` has task.0096 (merged to staging), task.0100 (design only), and task.0103 (implementation) — may want to split PRs
- **Other dev's unstaged changes**: there are unstaged changes from task.0096 work (route files, AGENTS.md) on the working tree — don't accidentally commit those

## Pointers

| File / Resource                                             | Why it matters                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | Core change: constructor, `resolveEpochScoped()`, `validateEpochIds()`, all patched methods |
| `src/shared/config/repoSpec.server.ts`                      | New `getScopeId()` accessor                                                                 |
| `src/bootstrap/container.ts:389`                            | App container passes `getScopeId()` to adapter                                              |
| `services/scheduler-worker/src/bootstrap/container.ts:103`  | Worker container passes `config.SCOPE_ID`                                                   |
| `tests/component/db/drizzle-ledger.adapter.int.test.ts`     | 40 tests including 12 new scope-isolation tests                                             |
| `work/items/task.0103.scope-gated-queries-retrofit.md`      | Full design doc with method-by-method audit                                                 |
| `work/items/task.0100.epoch-signing-state-machine.md`       | Next task: 3-phase state machine (design complete)                                          |
| `docs/spec/epoch-ledger.md`                                 | Governing spec for the ledger system                                                        |
