---
id: task.0102
type: task
title: "Allocation computation, epoch auto-close, and FinalizeEpochWorkflow"
status: done
priority: 1
rank: 8
estimate: 3
summary: "Versioned allocation algorithm framework, pool estimation, periodic allocation computation during collection, auto-close ingestion, and FinalizeEpochWorkflow. Bridges the gap between raw events and payout statements."
outcome: "After each collection run, proposed allocations are computed from curated events using a versioned algorithm. Pool components auto-populated from config. Epochs auto-transition open→review when period ends. FinalizeEpochWorkflow deterministically computes payouts and atomically closes epochs."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/task-0102-allocation-epoch-close
pr: https://github.com/Cogni-DAO/node-template/pull/470
reviewer:
revision: 2
blocked_by: task.0100, task.0101
deploy_verified: false
created: 2026-02-22
updated: 2026-02-23
reviewed: 2026-02-23
labels: [governance, ledger, temporal]
external_refs:
---

# Allocation Computation + Epoch Close + Finalize Workflow

## Design

### Outcome

The pipeline goes from raw events to payout statements. Three frameworks ship: (1) a versioned allocation algorithm abstraction so the computation method can evolve independently of the data model, (2) a pool estimation framework that auto-populates base_issuance from config, and (3) periodic allocation computation — allocations refresh on every collection run and finalize at the open→review transition.

### Approach

**Solution**: Three pure-function modules in `ledger-core` (allocation, pool estimation, hash), one new store method (`getCuratedEventsForAllocation` — joined query), upsert semantics for allocations, two new activities (`computeAllocations`, `ensurePoolComponents`), auto-close check in `CollectEpochWorkflow`, and `FinalizeEpochWorkflow`.

**Reuses**:

- Existing `computeStatementItems()` in `ledger-core/rules.ts` — unchanged
- Existing `insertAllocations` store method — changed to upsert (ON CONFLICT UPDATE proposed_units, activity_count; never touch final_units)
- Existing `insertPoolComponent` store method — idempotent via POOL_UNIQUE_PER_TYPE
- Existing `closeIngestion` store method (task.0100) — status transition
- Existing `finalizeEpoch` store method (task.0100) — status transition + pool total
- Existing `deriveWeightConfigV0()` pattern in CollectEpochWorkflow
- Existing `insertPayoutStatement`, `getPoolComponentsForEpoch`, `getAllocationsForEpoch` store methods

**Rejected**:

1. **Formal strategy-pattern `AllocationAlgorithm` interface with registry**: Considered a class-based `AllocationAlgorithm` interface with a `Map<string, AlgorithmFactory>` registry. Over-engineered — V0 has one algorithm; a simple function dispatch via `switch` on the algorithm ID is sufficient. The function signature IS the interface. Adding a class hierarchy for a single implementation is premature.
2. **Per-adapter pool components**: Considered making each source adapter contribute its own pool amount (e.g., GitHub → 1000 credits, Discord → 500). Rejected — pool components are governance decisions about budget, not adapter outputs. `base_issuance` is a fixed amount regardless of which adapters ran. Weight config already handles per-source valuation.
3. **Separate CloseIngestionWorkflow on Temporal schedule** (Option B): Adds infra (new schedule, new workflow) for something the existing CollectEpochWorkflow already handles. Option A is simpler — auto-close check runs at the end of each collection pass.
4. **Delete-and-reinsert allocations on recomputation**: Preserving admin `final_units` overrides via delete+reinsert requires loading overrides, deleting, reinserting with overrides restored. Upsert is simpler and correct — ON CONFLICT UPDATE only touches `proposed_units` and `activity_count`, never `final_units` or `override_reason`. Stale allocations (user removed from computation) are handled by a cleanup step that removes allocations where the user is no longer in the proposed set (excluding rows with admin-set `final_units`).

### Framework 1: Versioned Allocation Algorithm

The allocation algorithm is a pure function identified by a version string. The version is **pinned at `closeIngestion` (open→review), not at epoch creation**. During `open`, the algorithm can iterate as repo-spec changes; at review the ref locks and becomes the reproducibility anchor (CONFIG_LOCKED_AT_REVIEW).

**`packages/ledger-core/src/allocation.ts`:**

```typescript
/** Input: joined curation + activity_events data (only resolved, included events) */
export interface CuratedEventForAllocation {
  readonly eventId: string;
  readonly userId: string; // resolved (null events filtered before calling)
  readonly source: string; // "github"
  readonly eventType: string; // "pr_merged", "review_submitted"
  readonly included: boolean;
  readonly weightOverrideMilli: bigint | null;
}

export interface ProposedAllocation {
  readonly userId: string;
  readonly proposedUnits: bigint;
  readonly activityCount: number;
}

/**
 * Compute proposed allocations using the named algorithm version.
 * Pure function — no I/O, deterministic output for same inputs.
 * Throws if algoRef is unknown.
 */
export function computeProposedAllocations(
  algoRef: string,
  events: readonly CuratedEventForAllocation[],
  weightConfig: Record<string, number>
): ProposedAllocation[];
```

**Weight config type**: stored as `Record<string, number>` in JSONB (JSON doesn't support bigint). All values MUST be safe integers (milli-units). **Validated at write time** — `deriveWeightConfigV0()` and repo-spec schema reject non-integer / unsafe values. Computation converts via `BigInt()` at the boundary. `weightOverrideMilli` on curation is already bigint — consistent at the computation layer.

**V0 algorithm — `weight-sum-v0`** (the only algorithm shipped):

1. Filter to `included === true`
2. For each event: `weight = weightOverrideMilli ?? BigInt(weightConfig[`${source}:${eventType}`] ?? 0)`
3. Group by userId, sum weights → `proposedUnits`, count → `activityCount`
4. Return sorted by userId (deterministic)

The dispatch is a simple `switch` on `algoRef`:

```typescript
function computeProposedAllocations(algoRef, events, weightConfig) {
  switch (algoRef) {
    case "weight-sum-v0":
      return weightSumV0(events, weightConfig);
    default:
      throw new Error(`Unknown allocation algorithm: ${algoRef}`);
  }
}
```

Adding a new algorithm = add function + add case. No registry, no classes.

**Epoch schema addition**: Two nullable columns on the epochs table, both set at `closeIngestion`:

- `allocation_algo_ref TEXT` — NULL while open, set at closeIngestion. V0: `"weight-sum-v0"`. Future: content-addressable ref `{repo, commit_sha, path, content_hash}`.
- `weight_config_hash TEXT` — SHA-256 of canonical weight config JSON. NULL while open, set at closeIngestion. Reproducibility anchor for verification.

Edit migrations in place (never deployed).

**Repo-spec mapping**: `credit_estimate_algo: cogni-v0.0` in repo-spec maps to `allocation_algo_ref: "weight-sum-v0"` via `deriveAllocationAlgoRef()` — pure function in the workflow, same pattern as `deriveWeightConfigV0()`.

**Weight validation**: Add `validateWeightConfig(config: Record<string, number>): void` to `ledger-core`. Rejects non-integer values, `NaN`, `Infinity`, values outside `Number.isSafeInteger()`. Called at epoch creation AND at `closeIngestion` before locking.

### Framework 2: Pool Estimation

Pool components are governance decisions about budget, not adapter outputs. The framework auto-populates `base_issuance` from config; admins add additional components (kpi_bonus, top_up) via API.

**Repo-spec addition:**

```yaml
activity_ledger:
  pool_config:
    base_issuance_credits: "10000" # string → bigint (100.000 units at milli-unit scale)
```

**`packages/ledger-core/src/pool.ts`:**

```typescript
export interface PoolComponentEstimate {
  readonly componentId: string;
  readonly algorithmVersion: string;
  readonly inputsJson: Record<string, unknown>;
  readonly amountCredits: bigint;
  readonly evidenceRef?: string;
}

/** Estimate pool components for an epoch from config. Pure function.
 *  V0: returns only base_issuance. Future: volume-based bonuses. */
export function estimatePoolComponentsV0(config: {
  baseIssuanceCredits: bigint;
}): PoolComponentEstimate[] {
  return [
    {
      componentId: "base_issuance",
      algorithmVersion: "config-constant-v0",
      inputsJson: {
        baseIssuanceCredits: config.baseIssuanceCredits.toString(),
      },
      amountCredits: config.baseIssuanceCredits,
    },
  ];
}
```

**Activity**: `ensurePoolComponents` — calls `estimatePoolComponentsV0()`, then `insertPoolComponent()` for each (idempotent via POOL_UNIQUE_PER_TYPE — existing PK conflict handling). Runs during CollectEpochWorkflow only while epoch is `open`.

**Pool freeze (POOL_LOCKED_AT_REVIEW)**: After `closeIngestion`, no new pool component inserts are allowed. Enforced at the application layer: `insertPoolComponent` checks epoch status and rejects if `!= 'open'`. The existing `pool-components` API route also checks epoch status.

**Component allowlist**: V0 validates `component_id` against `["base_issuance", "kpi_bonus_v0", "top_up"]`. Rejects unknown component IDs at write time. Application-level enforcement in `insertPoolComponent` and the API route.

### Framework 3: Periodic Allocation Computation

Allocations are recomputed on every collection run so admins always see current proposed values. A final computation runs at the open→review transition.

**Store port changes:**

1. **`getCuratedEventsForAllocation(epochId)`** — new joined query: `activity_curation JOIN activity_events ON event_id`, filtered to `userId IS NOT NULL` (resolved only). Returns `CuratedEventForAllocation[]`. This is the only new read method needed.

2. **`upsertAllocations`** — replaces `insertAllocations`. Uses ON CONFLICT `(epoch_id, user_id)` DO UPDATE SET `proposed_units = EXCLUDED.proposed_units, activity_count = EXCLUDED.activity_count, updated_at = now()`. Never touches `final_units` or `override_reason` — admin overrides survive recomputation.

3. **`deleteStaleAllocations(epochId, activeUserIds)`** — new method. Removes allocation rows where `user_id NOT IN (activeUserIds)` AND `final_units IS NULL`. Admin-overridden allocations are never auto-deleted (the admin explicitly valued that user; system doesn't second-guess).

4. **`closeIngestion` updated signature** — extends the existing `(epochId, approverSetHash)` from task.0100. Full signature:

```typescript
closeIngestion(
  epochId: bigint,
  approverSetHash: string,
  allocationAlgoRef: string,
  weightConfigHash: string
): Promise<AttributionEpoch>;
```

Sets `approver_set_hash` (task.0100), `allocation_algo_ref`, and `weight_config_hash` on the epoch row atomically. All three are NULL while open, immutable after review.

5. **`insertPoolComponent` enforcement** — port signature unchanged. Adapter (`DrizzleAttributionAdapter`) checks epoch status internally via `resolveEpochScoped` and rejects if `status != 'open'` (POOL_LOCKED_AT_REVIEW). Consistent with existing scope-gating pattern.

**`computeAllocations` activity:**

```typescript
async function computeAllocations(input: {
  nodeId: string;
  epochId: string;
  algorithmId: string;
  weightConfig: Record<string, number>;
}): Promise<{ totalAllocations: number; totalProposedUnits: string }> {
  const { nodeId, epochId, algorithmId, weightConfig } = input;

  // 1. Load curated events (joined query — resolved users only)
  const events = await store.getCuratedEventsForAllocation(BigInt(epochId));

  // 2. Compute proposed allocations (pure)
  const proposed = computeProposedAllocations(
    algorithmId,
    events,
    weightConfig
  );

  // 3. Upsert allocations (preserves admin final_units)
  await store.upsertAllocations(
    proposed.map((p) => ({
      nodeId,
      epochId: BigInt(epochId),
      userId: p.userId,
      proposedUnits: p.proposedUnits,
      activityCount: p.activityCount,
    }))
  );

  // 4. Remove stale allocations (users no longer in proposed set)
  // Guard: skip if proposed is empty (no resolved events) — don't wipe all allocations
  if (proposed.length > 0) {
    const activeUserIds = proposed.map((p) => p.userId);
    await store.deleteStaleAllocations(BigInt(epochId), activeUserIds);
  }

  const totalProposedUnits = proposed.reduce(
    (acc, p) => acc + p.proposedUnits,
    0n
  );
  return {
    totalAllocations: proposed.length,
    totalProposedUnits: totalProposedUnits.toString(),
  };
}
```

**Workflow integration — CollectEpochWorkflow changes:**

```
Existing steps 1-5: compute window → ensure epoch → collect → insert → curate
New step 6:        computeAllocations (with current algoRef + epoch's weightConfig)
New step 7:        ensurePoolComponents (auto-insert base_issuance from config, open epochs only)
New step 8:        auto-close check: if now > periodEnd + gracePeriod → closeIngestion
                   closeIngestion locks: sets allocation_algo_ref, weight_config_hash on epoch
                   After lock: no more event inserts, no more pool component inserts
```

The auto-close check (step 8) uses Option A — no new workflow, no new schedule. The CollectEpochWorkflow runs daily and already knows the epoch window. Grace period comes from config (default 24h). Before closing, step 6 ensures allocations are up-to-date. The `closeIngestion` call is idempotent — if already `review`, returns as-is.

### `computeAllocationSetHash()` Pure Function

**`packages/ledger-core/src/hashing.ts`** (or add to existing `hashing.ts` if it exists):

```typescript
export function computeAllocationSetHash(
  allocations: readonly FinalizedAllocation[]
): string {
  // Canonical JSON: sorted by userId, bigint as string
  const canonical = [...allocations]
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((a) => ({
      userId: a.userId,
      valuationUnits: a.valuationUnits.toString(),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
```

Deterministic: same allocations → same hash, regardless of input order.

### FinalizeEpochWorkflow

New workflow: `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts`

```
Input: { epochId, signature, signerAddress }
  signerAddress: derived from SIWE session (never client-supplied)
Deterministic ID: ledger-finalize-{scopeId}-{epochId}

1. Activity: loadEpochForFinalize(epochId)
   → Verify epoch exists, is 'review'. If 'finalized' → return existing statement (idempotent).
   → Verify allocation_algo_ref and weight_config_hash are set (CONFIG_LOCKED_AT_REVIEW).
   → Load approverSetHash from epoch row.

2. Activity: verifySignatureAndFinalize(epochId, signature, signerAddress)
   → Verify signer is in scope's approvers[] AND matches pinned approverSetHash.
   → Build canonical finalize message from epoch data.
   → ecrecover(message, signature) — verify recovered address matches signerAddress.
   → Read epoch_allocations — use final_units where set, fall back to proposed_units.
   → Read pool components → pool_total = SUM(amount_credits).
   → Verify ≥1 base_issuance component (POOL_REQUIRES_BASE).
   → computeStatementItems(allocations, pool_total) — BIGINT, largest-remainder.
   → computeAllocationSetHash(allocations).
   → Atomic transaction:
     - finalizeEpoch(epochId, pool_total)
     - insertPayoutStatement(epochId, hash, pool_total, payouts)
     - insertStatementSignature(statementId, signerWallet, signature)
   → Return statement.
```

Single compound activity wrapping the atomic transaction. Idempotent via EPOCH_FINALIZE_IDEMPOTENT. V0 is sign-at-finalize — no separate `/sign` route (deferred to V1 for multi-approver quorum).

**Finalize API route**: `POST /api/v1/ledger/epochs/:id/finalize`

```typescript
// Input: { signature: string } (EIP-191 hex)
// Auth: SIWE session required. signerAddress derived from session wallet.
// Action: Start FinalizeEpochWorkflow with { epochId, signature, signerAddress }.
// Response: 202 + workflowId (WRITES_VIA_TEMPORAL)
```

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONFIG_LOCKED_AT_REVIEW: `closeIngestion` sets `allocation_algo_ref` and `weight_config_hash` on epoch — both NULL while open, immutable after review. FinalizeEpochWorkflow verifies both are set before proceeding. (spec: epoch-ledger)
- [ ] ALLOCATION_ALGO_VERSIONED: `allocation_algo_ref` pinned at closeIngestion (not creation). `computeProposedAllocations(algoRef, events, weightConfig)` dispatches to the correct version. Same inputs + same algoRef → identical output. (spec: epoch-ledger)
- [ ] WEIGHTS_VALIDATED: Weight config values validated as safe integers (milli-units) at epoch creation and at closeIngestion. `validateWeightConfig()` rejects floats, NaN, Infinity, unsafe integers. Computation converts to BigInt at boundary. (spec: epoch-ledger WEIGHTS_INTEGER_ONLY)
- [ ] ALLOCATION_PRESERVES_OVERRIDES: `upsertAllocations` ON CONFLICT updates only `proposed_units` and `activity_count`. Never touches `final_units` or `override_reason`. `deleteStaleAllocations` skips rows with `final_units IS NOT NULL`. (spec: epoch-ledger ADMIN_FINALIZES_ONCE)
- [ ] POOL_AUTO_POPULATED: `ensurePoolComponents` activity inserts `base_issuance` from config. Idempotent via POOL_UNIQUE_PER_TYPE. Admin can add additional components via API while epoch is open. (spec: epoch-ledger POOL_REQUIRES_BASE)
- [ ] POOL_LOCKED_AT_REVIEW: No pool component inserts after `closeIngestion`. `insertPoolComponent` rejects if epoch status != 'open'. `component_id` validated against V0 allowlist (`base_issuance`, `kpi_bonus_v0`, `top_up`). (spec: epoch-ledger)
- [ ] POOL_REPRODUCIBLE: Each pool component stores `algorithm_version + inputs_json + amount_credits`. `estimatePoolComponentsV0` is a pure function. (spec: epoch-ledger)
- [ ] PAYOUT_DETERMINISTIC: `computeStatementItems` + `computeAllocationSetHash` are pure functions. Same allocations + pool → identical statement + hash. (spec: epoch-ledger)
- [ ] ALL_MATH_BIGINT: All weight, unit, credit, and pool values use BigInt. No floating point. (spec: epoch-ledger)
- [ ] IDENTITY_BEST_EFFORT: `getCuratedEventsForAllocation` returns only resolved events (`userId IS NOT NULL`). Unresolved events excluded from allocation, not silently dropped. (spec: epoch-ledger)
- [ ] EPOCH_FINALIZE_IDEMPOTENT: FinalizeEpochWorkflow returns existing statement if epoch already finalized. No error, no mutation. (spec: epoch-ledger)
- [ ] WRITES_VIA_TEMPORAL: All write operations (computeAllocations, ensurePoolComponents, finalizeEpoch) execute in Temporal activities. Finalize API route returns 202 + workflow ID. (spec: epoch-ledger)
- [ ] SCOPE_GATED_QUERIES: New store methods enforce `AND scope_id = this.scopeId`. (dep: task.0103)
- [ ] SIMPLE_SOLUTION: Allocation versioning uses simple switch dispatch, not class registry. Pool estimation is a pure function, not an adapter interface. Auto-close piggybacks on existing workflow.
- [ ] ARCHITECTURE_ALIGNMENT: Pure functions in ledger-core. Activities in scheduler-worker. No direct DB calls from routes. (spec: architecture)

### Files

<!-- High-level scope -->

- Create: `packages/ledger-core/src/allocation.ts` — `computeProposedAllocations()` + types + V0 algorithm
- Create: `packages/ledger-core/src/pool.ts` — `estimatePoolComponentsV0()` pure function
- Create: `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` — FinalizeEpochWorkflow
- Create: `src/contracts/ledger.finalize-epoch.v1.contract.ts` — Zod contract for finalize route
- Create: `src/app/api/v1/ledger/epochs/[id]/finalize/route.ts` — finalize API route (202 → workflow)
- Modify: `packages/ledger-core/src/hashing.ts` — add `computeAllocationSetHash()`
- Modify: `packages/ledger-core/src/index.ts` — export allocation + pool modules
- Modify: `packages/ledger-core/src/store.ts` — add `getCuratedEventsForAllocation()`, rename `insertAllocations` → `upsertAllocations`, add `deleteStaleAllocations()`, update `closeIngestion` signature (accepts `allocationAlgoRef` + `weightConfigHash`), update `insertPoolComponent` (reject if epoch != open)
- Modify: `packages/ledger-core/src/model.ts` — add `allocationAlgoRef` and `weightConfigHash` to model, add `CuratedEventForAllocation` and `ProposedAllocation` types
- Modify: `packages/db-schema/src/ledger.ts` — add `allocation_algo_ref` and `weight_config_hash` nullable columns to epochs table
- Modify: `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — implement new/changed store methods, pool freeze enforcement, updated `closeIngestion` with config locking
- Modify: `services/scheduler-worker/src/activities/ledger.ts` — add `computeAllocations`, `ensurePoolComponents`, `finalizeEpoch` activities
- Modify: `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — add steps 6-8 (allocate, pool, auto-close)
- Modify: `.cogni/repo-spec.yaml` — add `pool_config.base_issuance_credits`
- Modify: `src/shared/config/repoSpec.schema.ts` — add `pool_config` schema
- Modify: `src/shared/config/repoSpec.server.ts` — add `getLedgerPoolConfig()` accessor
- Modify: migration SQL files — add `allocation_algo_ref` and `weight_config_hash` columns (edit in place, never deployed)
- Test: `tests/unit/packages/ledger-core/allocation.test.ts` — weight-sum-v0, deterministic ordering, weight overrides, empty inputs
- Test: `tests/unit/packages/ledger-core/pool.test.ts` — estimatePoolComponentsV0
- Test: `tests/unit/packages/ledger-core/hashing.test.ts` — allocation set hash determinism
- Test: `services/scheduler-worker/tests/ledger-allocations.test.ts` — computeAllocations activity, upsert preserves overrides
- Test: `tests/stack/ledger/finalize-epoch.stack.test.ts` — full pipeline: collect → allocate → close → finalize → verify

## Plan

- [ ] **Checkpoint 1 — Pure Functions (ledger-core)**
  - Milestone: allocation, pool, hash, and validation functions exist and pass unit tests
  - Invariants: ALLOCATION_ALGO_VERSIONED, POOL_REPRODUCIBLE, PAYOUT_DETERMINISTIC, ALL_MATH_BIGINT, WEIGHTS_VALIDATED
  - Todos:
    - [ ] Create `packages/ledger-core/src/allocation.ts` — types + `computeProposedAllocations` + `weightSumV0`
    - [ ] Create `packages/ledger-core/src/pool.ts` — `estimatePoolComponentsV0`
    - [ ] Add `computeAllocationSetHash` to `packages/ledger-core/src/hashing.ts`
    - [ ] Add `validateWeightConfig(config)` to `packages/ledger-core/src/allocation.ts` — rejects floats, NaN, Infinity, unsafe integers
    - [ ] Add `computeWeightConfigHash(config)` to `packages/ledger-core/src/hashing.ts` — SHA-256 of canonical JSON
    - [ ] Update `packages/ledger-core/src/model.ts` — add types, add `allocationAlgoRef` to model
    - [ ] Update `packages/ledger-core/src/index.ts` — export new modules
    - [ ] Unit tests: allocation algo, pool estimation, allocation set hash, weight validation, weight config hash
  - Validation: `pnpm check` + `pnpm test -- tests/unit/packages/ledger-core/`

- [ ] **Checkpoint 2 — Store Port + Schema + Adapter**
  - Milestone: store port has new methods, adapter implements them, schema updated with nullable config columns
  - Invariants: ALLOCATION_PRESERVES_OVERRIDES, SCOPE_GATED_QUERIES, IDENTITY_BEST_EFFORT, CONFIG_LOCKED_AT_REVIEW, POOL_LOCKED_AT_REVIEW
  - Todos:
    - [ ] Edit `packages/db-schema/src/ledger.ts` — add `allocation_algo_ref TEXT` (nullable) and `weight_config_hash TEXT` (nullable) columns to epochs
    - [ ] Edit migration SQL in place — add both nullable columns (no default, NULL while open)
    - [ ] Update `packages/ledger-core/src/store.ts`:
      - Add `getCuratedEventsForAllocation(epochId)` — joined query, resolved users only
      - Rename `insertAllocations` → `upsertAllocations` — ON CONFLICT preserves `final_units`
      - Add `deleteStaleAllocations(epochId, activeUserIds)` — skips admin-overridden rows
      - Update `closeIngestion` signature — accepts `allocationAlgoRef` and `weightConfigHash`, sets both on epoch row
      - Update `insertPoolComponent` — reject if epoch status != 'open' (POOL_LOCKED_AT_REVIEW)
    - [ ] Implement all changes in `packages/db-client/src/adapters/drizzle-ledger.adapter.ts`
    - [ ] Update mock store in test fakes
  - Validation: `pnpm check` + `pnpm packages:build`

- [ ] **Checkpoint 3 — Activities + Workflow Integration**
  - Milestone: CollectEpochWorkflow computes allocations, ensures pool, auto-closes with config locking
  - Invariants: WRITES_VIA_TEMPORAL, POOL_AUTO_POPULATED, CONFIG_LOCKED_AT_REVIEW, WEIGHTS_VALIDATED, POOL_LOCKED_AT_REVIEW
  - Todos:
    - [ ] Add `computeAllocations` activity to `createLedgerActivities`
    - [ ] Add `ensurePoolComponents` activity to `createLedgerActivities` — checks epoch is `open` before insert
    - [ ] Add `autoCloseIngestion` activity to `createLedgerActivities` — calls `validateWeightConfig`, computes `weightConfigHash`, derives `allocationAlgoRef`, passes all to `closeIngestion`
    - [ ] Wire steps 6-8 into `CollectEpochWorkflow`
    - [ ] Add `pool_config.base_issuance_credits` to repo-spec schema + accessor
    - [ ] Update `.cogni/repo-spec.yaml` with `pool_config` section
    - [ ] Stack test: verify pool freeze after closeIngestion (insert rejected when epoch is `review`)
    - [ ] Stack test: verify config lock — `allocation_algo_ref` and `weight_config_hash` set at closeIngestion, immutable after
  - Validation: `pnpm check` + activity unit tests + freeze enforcement stack tests

- [ ] **Checkpoint 4 — FinalizeEpochWorkflow + API Route**
  - Milestone: Finalize workflow + API route work end-to-end
  - Invariants: EPOCH_FINALIZE_IDEMPOTENT, PAYOUT_DETERMINISTIC, POOL_REQUIRES_BASE, CONFIG_LOCKED_AT_REVIEW
  - Todos:
    - [ ] Create `FinalizeEpochWorkflow` in scheduler-worker
    - [ ] Create `finalizeEpoch` compound activity (atomic transaction)
    - [ ] FinalizeEpochWorkflow verifies `allocation_algo_ref` and `weight_config_hash` are non-null before proceeding
    - [ ] Create finalize API route contract + route handler
    - [ ] Stack test: full pipeline collect → allocate → close → finalize → verify
  - Validation: `pnpm check` + stack tests

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test -- tests/unit/packages/ledger-core/
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

## Review Checklist

- [ ] **Work Item:** `task.0102` linked in PR body
- [ ] **Spec:** PAYOUT_DETERMINISTIC, POOL_REQUIRES_BASE, EPOCH_FINALIZE_IDEMPOTENT, ALL_MATH_BIGINT, IDENTITY_BEST_EFFORT, ALLOCATION_ALGO_VERSIONED, CONFIG_LOCKED_AT_REVIEW, WEIGHTS_VALIDATED, POOL_LOCKED_AT_REVIEW upheld
- [ ] **Tests:** allocation algorithm, pool estimation, allocation set hash, weight validation, upsert-preserves-overrides, pool freeze after review, config lock at closeIngestion, full pipeline stack test
- [ ] **Reviewer:** assigned and approved

## Review Feedback

### Revision 2 — Blocking Issues

1. **Non-atomic finalize with lost signature on retry** (`services/scheduler-worker/src/activities/ledger.ts:L892-914`): The `finalizeEpoch` activity makes 3 separate DB calls (`finalizeEpoch` → `insertPayoutStatement` → `insertStatementSignature`). On partial failure (e.g., signature insert fails after statement inserted), Temporal retry hits the EPOCH_FINALIZE_IDEMPOTENT path and returns the existing statement — but the signature is never written. Fix options: (a) wrap in a DB transaction via Drizzle `db.transaction()`, (b) add a `getSignaturesForStatement` check in the idempotent path and re-insert if missing, or (c) explicitly document as known V0 limitation with a TODO and tracking issue.

2. **Missing component tests for new adapter methods**: `upsertAllocations`, `deleteStaleAllocations`, `getCuratedEventsForAllocation`, and POOL_LOCKED_AT_REVIEW (insertPoolComponent rejected after closeIngestion) have zero component test coverage. These methods have DB-level semantics (ON CONFLICT DO UPDATE, NOT IN, JOIN, epoch status check) that need real database verification. Especially critical: ALLOCATION_PRESERVES_OVERRIDES — verify that `final_units` survives an upsert against real Postgres.

3. **Brittle error detection in finalize route** (`src/app/api/v1/ledger/epochs/[id]/finalize/route.ts:L102-103`): Error message string matching for `WorkflowExecutionAlreadyStartedError` is fragile. Use `instanceof` with the exported error class from `@temporalio/client`.

### Suggestions (Non-blocking)

- Hashing: `hashing.ts` uses Web Crypto (async) while `signing.ts` uses Node `createHash` (sync). Consider standardizing.
- Finalize route `L79`: Connection-per-request. Add TODO for connection pooling.
- `insertAllocations` still on store port alongside `upsertAllocations` (design said rename). Consider deprecating.
- `creditEstimateAlgo` selection (`collect-epoch.workflow.ts:L173`): `Object.values(config.activitySources)[0]` depends on object key order — consider making this explicit at LedgerIngestRunV1 level.

## PR / Links

- Handoff: [handoff](../handoffs/task.0102.handoff.md)

## Attribution

-
