---
id: task.0101
type: task
title: "Identity resolution activity + curation auto-population (GitHub V0)"
status: done
priority: 1
rank: 7
estimate: 2
summary: "Implement curateAndResolve activity (auto-create curation rows from events, resolve GitHub platform_user_id → user_id via user_bindings), add resolveIdentities to store port + DrizzleLedgerAdapter, wire into CollectEpochWorkflow."
outcome: "After each collection run, curation rows exist for every activity event. GitHub platformUserId resolved to user_id via user_bindings (best-effort — unresolved events flagged with user_id=NULL). Allocation computation can read curated events."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-identity-resolution
pr: https://github.com/Cogni-DAO/node-template/pull/461
reviewer:
revision: 2
blocked_by: task.0089, task.0095
deploy_verified: false
created: 2026-02-22
updated: 2026-02-23
labels: [governance, ledger, identity]
external_refs:
---

# Identity Resolution + Curation Auto-Population

## Problem

The collection pipeline (task.0095) ingests raw `activity_events` but never creates `activity_curation` rows or resolves platform identities to `user_id`. Without this, allocation computation has no input — events are raw facts with `platformUserId` (e.g., GitHub numeric ID) but no `user_id` (UUID from `users` table).

This is the missing link between **ingestion** (task.0095) and **allocation computation** (task.0102).

## Design

### Outcome

After each daily collection run, every ingested activity event has a corresponding `activity_curation` row with a best-effort `user_id` resolved from `user_bindings`. Unresolved events are flagged (null userId), never dropped. task.0102 can then read curated events to compute allocations.

### Approach

**Solution**: One new activity (`curateAndResolve`) added to the existing `createLedgerActivities` factory. The activity queries the DB for uncurated/unresolved events by epochId (delta processing), batch-resolves identities via a new `resolveIdentities()` method on the store port, and inserts/updates curation rows with safe merge semantics. The workflow calls this as step 5, after all collection loops complete.

**Design decision — query by epochId, not window**: The activity takes `{ epochId }` as input and loads the epoch row to get `period_start`/`period_end`. The epoch row is authoritative for window boundaries. `periodStart`/`periodEnd` passed from the workflow serve only as a guard assertion (verify they match the epoch row), not as query parameters.

**Design decision — delta processing**: Instead of processing all events in the window, query only events that need curation work:

- Events with NO existing curation row (new events since last run)
- Events with existing curation row where `user_id IS NULL` (unresolved — may have new bindings since last run)

This reduces write amplification and vacuum pressure. Events already curated with a resolved `user_id` are never touched, preserving admin edits.

**Design decision — insert-or-update-userId-only merge semantics**: The existing `upsertCuration` method uses `onConflictDoUpdate` which overwrites ALL fields — this would clobber admin edits to `included`, `weight_override_milli`, and `note`. Instead, use two-phase writes:

1. **INSERT new curation rows** (`ON CONFLICT DO NOTHING`) for events with no curation row
2. **UPDATE userId only** on existing rows where `user_id IS NULL` — never touch `included`, `weight_override_milli`, `note`

This requires a new store method (`updateCurationUserId`) or a targeted SQL update — NOT the existing `upsertCuration`.

**Design decision — DB query instead of workflow state**: The original requirements passed events through the workflow as an `allEvents` array. This is wrong:

1. **Temporal payload limits**: A week of GitHub activity could produce hundreds of events. Serializing full `ActivityEvent` objects through workflow history grows unboundedly.
2. **Idempotency**: If the workflow retries, events from workflow state would be stale. Querying the DB gets current truth.

**Design decision — resolveIdentities on the ledger port**: The `user_bindings` table lives in the identity domain (`@cogni/db-schema/identity`). The cleanest architecture would be a separate `IdentityStore` port. However:

- The scheduler-worker already has a single `LedgerContainer` with one `ledgerStore`
- Adding a second store port + adapter + DI wiring for a single SELECT query is over-engineering
- V0 has one consumer; extract to separate port when a second consumer appears

**Design decision — provider typing**: Constrain `provider` to `'github'` (literal type in V0). The GitHub adapter stores `platformUserId` as the GitHub numeric `databaseId` (string). Verify this matches `user_bindings.external_id` format.

**Reuses**:

- Existing `createLedgerActivities(deps)` DI factory — just add one function
- Existing `getActivityForWindow()` on store port — queries by (nodeId, since, until)
- Existing `userBindings` table from `@cogni/db-schema/identity` — just a SELECT
- Existing `LedgerContainer` DI — no changes to container.ts
- Existing workflow proxy pattern — add to existing `proxyActivities` call

**Rejected**:

- **Full upsertCuration for auto-population**: Overwrites admin-set `included`/`weight_override_milli`/`note` — destructive on re-run. Use insert-only + targeted userId update instead.
- **Separate IdentityStore port**: Over-engineered for V0. Extract when needed.
- **Pass events through workflow state**: Unbounded Temporal payload growth. Query DB instead.
- **Separate activities for resolve + curate**: Two round-trips where one suffices.
- **Per-source resolution in collection loop**: N curateAndResolve calls per run adds workflow complexity. A single post-collection pass is simpler and handles cross-source dedup naturally.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] IDENTITY_BEST_EFFORT: Unresolved events get `userId: null` in curation rows — never dropped or excluded (spec: epoch-ledger-spec)
- [ ] CURATION_AUTO_POPULATE: Insert new curation rows; update only `user_id` on existing rows where it's NULL. Never overwrite `included`, `weight_override_milli`, `note`. (spec: epoch-ledger-spec)
- [ ] NODE_SCOPED: All operations pass `nodeId` from deps, never from input (spec: epoch-ledger-spec)
- [ ] TEMPORAL_DETERMINISM: Workflow contains no I/O — curateAndResolve is an activity (spec: temporal-patterns)
- [ ] SIMPLE_SOLUTION: One activity, two store methods, minimal workflow change
- [ ] ARCHITECTURE_ALIGNMENT: services/ imports only from packages/, never from src/ (spec: architecture)

### Files

**Modify:**

- `packages/ledger-core/src/store.ts` — Add `resolveIdentities(provider, externalIds)` and `getUncuratedEvents(epochId, periodStart, periodEnd)` and `updateCurationUserId(epochId, eventId, userId)` to `ActivityLedgerStore` interface
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — Implement all three: import `userBindings` from `@cogni/db-schema/identity`
- `services/scheduler-worker/src/activities/ledger.ts` — Add `curateAndResolve` activity + types
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Add step 5: proxy + call `curateAndResolve`

**Test:**

- `services/scheduler-worker/tests/ledger-activities.test.ts` — Add tests for `curateAndResolve`

### Implementation Details

#### New Store Methods

```typescript
// packages/ledger-core/src/store.ts — add to ActivityLedgerStore

/**
 * Cross-domain convenience: resolves platform IDs to user UUIDs via user_bindings.
 * Lives on ledger port (not a separate identity port) because V0 has a single consumer.
 * Extract to IdentityStore port if a second consumer appears.
 */
resolveIdentities(
  provider: 'github',     // V0: GitHub only. Extend union for discord etc.
  externalIds: string[]
): Promise<Map<string, string>>; // externalId → userId

/**
 * Returns events in the epoch window that need curation work:
 * - No curation row exists (new events)
 * - Curation row exists but user_id IS NULL (unresolved — may have new bindings)
 *
 * Uses epochId as authoritative scope. periodStart/periodEnd from the epoch row.
 */
getUncuratedEvents(
  nodeId: string,
  epochId: bigint,
  periodStart: Date,
  periodEnd: Date
): Promise<LedgerActivityEvent[]>;

/**
 * Update user_id on a curation row ONLY when existing user_id IS NULL.
 * Never touches included, weight_override_milli, or note (CURATION_AUTO_POPULATE).
 * No-op if user_id already set (preserves admin overrides).
 */
updateCurationUserId(
  epochId: bigint,
  eventId: string,
  userId: string
): Promise<void>;
```

#### `resolveIdentities` Adapter Implementation

```typescript
// packages/db-client/src/adapters/drizzle-ledger.adapter.ts
import { userBindings } from "@cogni/db-schema/identity";

async resolveIdentities(
  provider: 'github',
  externalIds: string[]
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const rows = await this.db
    .select({ externalId: userBindings.externalId, userId: userBindings.userId })
    .from(userBindings)
    .where(and(
      eq(userBindings.provider, provider),
      inArray(userBindings.externalId, [...new Set(externalIds)])
    ));
  return new Map(rows.map(r => [r.externalId, r.userId]));
}
```

#### `getUncuratedEvents` Adapter Implementation

```typescript
// LEFT JOIN activity_events with activity_curation
// Return events WHERE: no curation row OR curation.user_id IS NULL
async getUncuratedEvents(
  nodeId: string,
  epochId: bigint,
  periodStart: Date,
  periodEnd: Date
): Promise<LedgerActivityEvent[]> {
  const rows = await this.db
    .select({ event: activityEvents })
    .from(activityEvents)
    .leftJoin(
      activityCuration,
      and(
        eq(activityCuration.epochId, epochId),
        eq(activityCuration.eventId, activityEvents.id)
      )
    )
    .where(and(
      eq(activityEvents.nodeId, nodeId),
      gte(activityEvents.eventTime, periodStart),
      lte(activityEvents.eventTime, periodEnd),
      or(
        isNull(activityCuration.id),          // no curation row
        isNull(activityCuration.userId)        // curation exists but unresolved
      )
    ))
    .orderBy(activityEvents.eventTime);
  return rows.map(r => toActivityEvent(r.event));
}
```

#### `updateCurationUserId` Adapter Implementation

```typescript
async updateCurationUserId(
  epochId: bigint,
  eventId: string,
  userId: string
): Promise<void> {
  await this.db
    .update(activityCuration)
    .set({ userId, updatedAt: new Date() })
    .where(and(
      eq(activityCuration.epochId, epochId),
      eq(activityCuration.eventId, eventId),
      isNull(activityCuration.userId)   // only update if not already resolved
    ));
}
```

#### `curateAndResolve` Activity

```typescript
export interface CurateAndResolveInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

export interface CurateAndResolveOutput {
  readonly totalEvents: number;
  readonly newCurations: number; // inserted (no prior row)
  readonly resolved: number; // userId filled in (new or updated)
  readonly unresolved: number; // userId still null
}
```

Logic:

1. Load epoch by ID → get `periodStart`, `periodEnd` (fail if not found)
2. `getUncuratedEvents(nodeId, epochId, periodStart, periodEnd)` — delta: only events needing work
3. Group unique `platformUserId` values by source
4. For each source: `resolveIdentities(source, externalIds)` — batch query
5. For events with NO curation row: batch `INSERT` via existing `upsertCuration` with `userId = resolved ?? null`, `included = true`. (These are new rows — no conflict possible since `getUncuratedEvents` filtered them.)
   - Actually: use a dedicated insert path (`ON CONFLICT DO NOTHING`) to be safe against races.
6. For events with existing curation row where `userId IS NULL`: call `updateCurationUserId(epochId, eventId, resolvedUserId)` for each resolved ID. Skip if still unresolved (no-op).
7. Return counts

**How to distinguish new vs existing-but-unresolved**: `getUncuratedEvents` returns both. Check: does a curation row exist? The LEFT JOIN result tells us — if `activityCuration.id IS NULL`, it's new; if `activityCuration.id IS NOT NULL` but `userId IS NULL`, it's existing-but-unresolved.

Update `getUncuratedEvents` return type to include a flag:

```typescript
interface UncuratedEvent {
  event: LedgerActivityEvent;
  hasExistingCuration: boolean; // true = row exists with userId=NULL
}
```

This lets the activity decide: INSERT (new) vs UPDATE (existing-but-unresolved).

#### Workflow Wiring

```typescript
// After line 149 in collect-epoch.workflow.ts (after all collection loops):

// 5. Curate events and resolve identities (CURATION_AUTO_POPULATE)
await curateAndResolve({ epochId: epoch.epochId });
```

Add `curateAndResolve` to the existing default `proxyActivities` call (2-minute timeout group).

Note: `periodStart`/`periodEnd` are NOT passed — the activity loads the epoch row and uses its dates. The epochId (already a string from `ensureEpochForWindow` output) is the sole input.

## Plan

- [ ] **Checkpoint 1: Store port + adapter (3 new methods)**
  - Milestone: Port interface and Drizzle adapter have resolveIdentities, getUncuratedEvents, updateCurationUserId
  - Invariants: NODE_SCOPED, CURATION_AUTO_POPULATE, IDENTITY_BEST_EFFORT
  - Todos:
    - [ ] Add `UncuratedEvent` type + 3 methods to `ActivityLedgerStore` in `packages/ledger-core/src/store.ts`
    - [ ] Import `userBindings` from `@cogni/db-schema/identity` in `packages/db-client/src/adapters/drizzle-ledger.adapter.ts`
    - [ ] Implement `resolveIdentities()` — batch SELECT from user_bindings
    - [ ] Implement `getUncuratedEvents()` — LEFT JOIN activity_events with activity_curation
    - [ ] Implement `updateCurationUserId()` — conditional UPDATE where user_id IS NULL
  - Validation:
    - [ ] `pnpm packages:build` succeeds
    - [ ] `pnpm check` passes (types + dep-cruiser)

- [ ] **Checkpoint 2: curateAndResolve activity + workflow wiring**
  - Milestone: Activity implemented, workflow calls it as step 5 after collection loops
  - Invariants: TEMPORAL_DETERMINISM, NODE_SCOPED, CURATION_AUTO_POPULATE, IDENTITY_BEST_EFFORT
  - Todos:
    - [ ] Add `CurateAndResolveInput`, `CurateAndResolveOutput` types to `services/scheduler-worker/src/activities/ledger.ts`
    - [ ] Implement `curateAndResolve` in `createLedgerActivities` factory (two-phase: insert new + update unresolved)
    - [ ] Add `curateAndResolve` to proxyActivities in workflow, call after collection loops
  - Validation:
    - [ ] `pnpm check` passes

- [ ] **Checkpoint 3: Tests**
  - Milestone: 5+ unit tests proving curateAndResolve behavior
  - Invariants: TESTS_PROVE_WORK
  - Todos:
    - [ ] Add mock store methods for new port methods
    - [ ] Test: curateAndResolve creates new curation rows with correct userId/null
    - [ ] Test: curateAndResolve re-run with new binding updates only unresolved rows
    - [ ] Test: curateAndResolve re-run does NOT overwrite admin-set fields
    - [ ] Test: curateAndResolve with zero uncurated events (no-op)
    - [ ] Test: curateAndResolve with epoch not found throws
  - Validation:
    - [ ] `pnpm test -- services/scheduler-worker/tests/ledger-activities` passes
    - [ ] `pnpm check` passes

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test -- services/scheduler-worker/tests/ledger-activities
```

## Review Checklist

- [ ] **Work Item:** `task.0101` linked in PR body
- [ ] **Spec:** IDENTITY_BEST_EFFORT + CURATION_AUTO_POPULATE upheld
- [ ] **Merge semantics:** Re-run never overwrites admin-set `included`/`weight_override_milli`/`note`
- [ ] **Delta processing:** Only uncurated or unresolved events processed (not full window)
- [ ] **Provider typing:** `provider` constrained to `'github'` literal
- [ ] **Tests:** 5+ test cases covering new/resolved/unresolved/admin-override/no-op
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0101.handoff.md)

## Attribution

-
