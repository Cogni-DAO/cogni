---
id: task.0102.handoff
type: handoff
work_item_id: task.0102
status: active
created: 2026-02-23
updated: 2026-02-23
branch: feat/task-0102-allocation-epoch-close
last_commit: 74fb7e00
---

# Handoff: Allocation Computation, Epoch Auto-Close, and FinalizeEpochWorkflow

## Context

- task.0102 bridges raw curated activity events to payout statements — the final pipeline stage in the epoch ledger
- Three frameworks shipped: (1) versioned allocation algorithm (`weight-sum-v0`), (2) pool estimation (`base_issuance` from config), (3) periodic allocation recomputation during collection
- Also adds auto-close ingestion (open→review after grace period) and FinalizeEpochWorkflow (review→finalized with EIP-191 signature)
- Depends on task.0100 (epoch state machine — merged) and task.0101 (identity resolution — merged)
- Parent project: `proj.transparent-credit-payouts`

## Current State

- **All 4 checkpoints implemented** — `pnpm check` passes, 1146 unit tests pass, packages build clean
- **Checkpoint 1** (pure functions): `allocation.ts`, `pool.ts`, `hashing.ts` additions, `validateWeightConfig`, `deriveAllocationAlgoRef` — 44 ledger-core unit tests
- **Checkpoint 2** (store port + schema + adapter): `closeIngestion` extended with 4 params, `upsertAllocations` with ON CONFLICT, `deleteStaleAllocations`, `getCuratedEventsForAllocation`, pool freeze in adapter, `allocation_algo_ref`/`weight_config_hash` columns
- **Checkpoint 3** (activities + workflow): `computeAllocations`, `ensurePoolComponents`, `autoCloseIngestion` activities; steps 6-8 in CollectEpochWorkflow; `pool_config.base_issuance_credits` in repo-spec
- **Checkpoint 4** (finalize): `FinalizeEpochWorkflow`, compound `finalizeEpoch` activity (viem EIP-191 verification), finalize API route (202 + workflowId), Zod contract
- **Not yet done**: stack tests, work item status update to `needs_closeout`, push to remote

## Decisions Made

- **Sign-at-finalize (V0)**: Single `POST /finalize` with `{ signature }` — `signerAddress` from SIWE session. No separate `/sign` route (deferred to V1 for multi-approver quorum). See [spec](../../docs/spec/attribution-ledger.md)
- **Pin config at closeIngestion, not creation**: `allocation_algo_ref` and `weight_config_hash` are NULL while open, set and locked at closeIngestion
- **Weights stay `Record<string, number>` in JSONB**: Validated as safe integers at write time, converted to `BigInt()` at computation boundary
- **Pool components are governance, not per-adapter**: `base_issuance` auto-populated from repo-spec config
- **Upsert semantics for allocations**: ON CONFLICT preserves admin `final_units` — never overwritten by recomputation
- **Auto-close piggybacks on CollectEpochWorkflow**: No separate schedule. Grace period check at end of each collection run
- **viem added to scheduler-worker**: For EIP-191 `verifyMessage` in the finalizeEpoch activity

## Next Actions

- [ ] Run stack tests to validate full pipeline (collect → allocate → close → finalize)
- [ ] Update work item status to `needs_closeout`
- [ ] Push branch to remote
- [ ] Run `/closeout` for docs pass + PR creation
- [ ] Verify Temporal workflow bundling works with the new `ledger-workflows.ts` barrel (two workflows registered on one worker)
- [ ] Consider adding activity-level unit tests for `computeAllocations` and `finalizeEpoch`

## Risks / Gotchas

- **Temporal workflow bundling**: Changed from single `collect-epoch.workflow.js` to `ledger-workflows.js` barrel. Both CollectEpochWorkflow and FinalizeEpochWorkflow are registered on the same ledger-tasks queue. Verify the bundle resolves correctly at runtime.
- **viem dependency in scheduler-worker**: Added for EIP-191 signature verification. First viem usage in this service — may need Docker image adjustments if it pulls native deps.
- **Finalize route creates Temporal connection per request**: V0 simplicity — creates+closes Connection inline. Should be pooled via container for production (same pattern as ScheduleControlAdapter).
- **`LedgerIngestRunV1` extended with optional fields**: `baseIssuanceCredits`, `approvers`, `autoCloseGracePeriodMs` are optional for backward compatibility. Existing schedules without these fields will skip pool/auto-close steps.
- **Atomic finalize is not truly atomic**: `finalizeEpoch` + `insertPayoutStatement` + `insertStatementSignature` are 3 separate DB calls, not in a DB transaction. Temporal activity retry handles partial failures, but a transactional wrapper would be safer.

## Pointers

| File / Resource                                                                                                                                  | Why it matters                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [task.0102 design](../items/task.0102.allocation-computation-epoch-close.md)                                                                     | Full design with invariants, checkpoint plan, code sketches                                 |
| [epoch-ledger spec](../../docs/spec/attribution-ledger.md)                                                                                       | Canonical invariants, schema, API routes, workflow descriptions                             |
| [`packages/attribution-ledger/src/allocation.ts`](../../packages/attribution-ledger/src/allocation.ts)                                           | `computeProposedAllocations()`, `validateWeightConfig()`, `deriveAllocationAlgoRef()`       |
| [`packages/attribution-ledger/src/pool.ts`](../../packages/attribution-ledger/src/pool.ts)                                                       | `estimatePoolComponentsV0()`, `POOL_COMPONENT_ALLOWLIST`                                    |
| [`packages/attribution-ledger/src/hashing.ts`](../../packages/attribution-ledger/src/hashing.ts)                                                 | `computeAllocationSetHash()`, `computeWeightConfigHash()`                                   |
| [`packages/db-client/src/adapters/drizzle-attribution.adapter.ts`](../../packages/db-client/src/adapters/drizzle-attribution.adapter.ts)         | Adapter — upsertAllocations, deleteStaleAllocations, pool freeze, closeIngestion            |
| [`services/scheduler-worker/src/activities/ledger.ts`](../../services/scheduler-worker/src/activities/ledger.ts)                                 | All activities: computeAllocations, ensurePoolComponents, autoCloseIngestion, finalizeEpoch |
| [`services/scheduler-worker/src/workflows/collect-epoch.workflow.ts`](../../services/scheduler-worker/src/workflows/collect-epoch.workflow.ts)   | Steps 6-8: allocate → pool → auto-close                                                     |
| [`services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts`](../../services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts) | FinalizeEpochWorkflow — sign-at-finalize V0                                                 |
| [`src/app/api/v1/attribution/epochs/[id]/finalize/route.ts`](../../src/app/api/v1/attribution/epochs/%5Bid%5D/finalize/route.ts)                 | Finalize API route (202 → workflow)                                                         |
| [`src/contracts/ledger.finalize-epoch.v1.contract.ts`](../../src/contracts/ledger.finalize-epoch.v1.contract.ts)                                 | Zod contract for finalize endpoint                                                          |
| [`.cogni/repo-spec.yaml`](../../.cogni/repo-spec.yaml)                                                                                           | `pool_config.base_issuance_credits` added                                                   |
