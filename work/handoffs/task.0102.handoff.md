---
id: task.0102.handoff
type: handoff
work_item_id: task.0102
status: active
created: 2026-02-23
updated: 2026-02-23
branch: feat/task-0100-epoch-state-machine
last_commit: d9dad43c
---

# Handoff: Allocation Computation, Epoch Auto-Close, and FinalizeEpochWorkflow

## Context

- task.0102 bridges raw activity events to payout statements — the final pipeline stage in the epoch ledger
- Three frameworks: (1) versioned allocation algorithm, (2) pool estimation, (3) periodic allocation recomputation during collection
- Also adds auto-close ingestion (open→review) and FinalizeEpochWorkflow (review→finalized with EIP-191 signature)
- Blocked by task.0100 (epoch state machine — in review) and task.0101 (identity resolution — merged)
- Parent project: `proj.transparent-credit-payouts`

## Current State

- **Design is done** — status: `needs_implement`, all review feedback incorporated
- **Spec updated** — `docs/spec/epoch-ledger.md` has new invariants (CONFIG_LOCKED_AT_REVIEW, ALLOCATION_ALGO_PINNED, ALLOCATION_PRESERVES_OVERRIDES, POOL_LOCKED_AT_REVIEW, WEIGHTS_INTEGER_ONLY) and schema changes (`allocation_algo_ref`, `weight_config_hash` nullable columns on epochs)
- **No implementation code written yet** — this is a green-field implementation task
- **Blocker**: task.0100 must merge first (provides `closeIngestion`, `finalizeEpoch`, `approverSetHash`, signing module)

## Decisions Made

- **Sign-at-finalize (V0)**: Single `POST /finalize` with `{ signature }` — `signerAddress` from SIWE session. No separate `/sign` route (deferred to V1 for multi-approver quorum). See [spec FinalizeEpochWorkflow](../../docs/spec/epoch-ledger.md#finalizeworkflow)
- **Pin config at closeIngestion, not creation**: `allocation_algo_ref` and `weight_config_hash` are NULL while epoch is open, set and locked at closeIngestion. See [design Framework 1](../items/task.0102.allocation-computation-epoch-close.md#framework-1-versioned-allocation-algorithm)
- **Weights stay `Record<string, number>` in JSONB**: JSON doesn't support bigint. Validated as safe integers at write time via `validateWeightConfig()`, converted to `BigInt()` at computation boundary
- **Pool components are governance, not per-adapter**: `base_issuance` auto-populated from repo-spec config. Admins add `kpi_bonus_v0`, `top_up` via API. Component allowlist enforced at write time
- **Upsert semantics for allocations**: ON CONFLICT preserves admin `final_units` — never overwritten by recomputation. Stale allocations auto-removed only if no admin override
- **Auto-close piggybacks on CollectEpochWorkflow**: No separate schedule/workflow. Grace period check at end of each collection run
- **`closeIngestion` extended signature**: `(epochId, approverSetHash, allocationAlgoRef, weightConfigHash)` — extends task.0100's `(epochId, approverSetHash)`
- **Pool freeze at adapter layer**: `insertPoolComponent` port signature unchanged; `DrizzleLedgerAdapter` checks epoch status internally

## Next Actions

- [ ] Implement Checkpoint 1: Pure functions in `ledger-core` (allocation.ts, pool.ts, hashing additions, validateWeightConfig)
- [ ] Implement Checkpoint 2: Store port + schema + adapter (upsertAllocations, getCuratedEventsForAllocation, deleteStaleAllocations, closeIngestion signature update, pool freeze)
- [ ] Implement Checkpoint 3: Activities + CollectEpochWorkflow integration (computeAllocations, ensurePoolComponents, autoCloseIngestion, repo-spec pool_config)
- [ ] Implement Checkpoint 4: FinalizeEpochWorkflow + finalize API route + contract
- [ ] Run `pnpm check` + unit tests + stack tests at each checkpoint

## Risks / Gotchas

- **task.0100 must merge first** — it provides `closeIngestion`, `finalizeEpoch`, signing module (`buildCanonicalMessage`, `computeApproverSetHash`), and the review API route. Rebase after merge.
- **Empty proposed set guard**: If no resolved events exist, `deleteStaleAllocations` must be skipped (don't wipe all allocations). Already in the design pseudocode.
- **`approverSetHash` already pinned by task.0100**: The `closeIngestion` signature change adds params alongside the existing `approverSetHash` — don't break task.0100's existing behavior.
- **Migration edits are in-place** (never deployed) — add both `allocation_algo_ref` and `weight_config_hash` as nullable columns to the existing epochs migration.

## Pointers

| File / Resource                                                                                                                                | Why it matters                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [task.0102 design](../items/task.0102.allocation-computation-epoch-close.md)                                                                   | Full design with code sketches, invariants, checkpoint plan     |
| [epoch-ledger spec](../../docs/spec/epoch-ledger.md)                                                                                           | Canonical invariants, schema, API routes, workflow descriptions |
| [`packages/ledger-core/src/store.ts`](../../packages/ledger-core/src/store.ts)                                                                 | Port interface — add new methods here                           |
| [`packages/ledger-core/src/rules.ts`](../../packages/ledger-core/src/rules.ts)                                                                 | Existing `computePayouts()` — reused unchanged                  |
| [`packages/db-client/src/adapters/drizzle-ledger.adapter.ts`](../../packages/db-client/src/adapters/drizzle-ledger.adapter.ts)                 | Adapter — implement port methods here                           |
| [`services/scheduler-worker/src/workflows/collect-epoch.workflow.ts`](../../services/scheduler-worker/src/workflows/collect-epoch.workflow.ts) | Add steps 6-8 (allocate, pool, auto-close)                      |
| [`services/scheduler-worker/src/activities/ledger.ts`](../../services/scheduler-worker/src/activities/ledger.ts)                               | Add new activities here                                         |
| [`.cogni/repo-spec.yaml`](../../.cogni/repo-spec.yaml)                                                                                         | Add `pool_config.base_issuance_credits`                         |
| [`packages/db-schema/src/ledger.ts`](../../packages/db-schema/src/ledger.ts)                                                                   | Drizzle schema — add nullable columns                           |
