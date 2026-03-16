---
id: task.0095
type: task
title: "Ledger Temporal workflows (collect + finalize) + weekly cron"
status: done
priority: 1
rank: 4
estimate: 2
summary: "Implement 2 Temporal workflows (CollectEpochWorkflow, FinalizeEpochWorkflow) + activity functions. Register weekly Temporal Schedule for automated collection."
outcome: "Weekly epoch collection runs automatically. Admin triggers finalize. Payouts computed deterministically."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-ingestion
pr:
reviewer:
revision: 1
blocked_by: task.0094
deploy_verified: false
created: 2026-02-20
updated: 2026-02-22
labels: [governance, ledger, temporal]
external_refs:
---

# Ledger Temporal Workflows

## Design

### Outcome

Admin (or daily cron) triggers activity collection for an epoch time window; the system collects from all configured source adapters, resolves identities, computes proposed allocations, and stores them. Collection runs daily so admins can see epoch progress throughout the week. Admin triggers finalize at epoch end, which deterministically computes payouts.

### Approach

**Solution**: Two Temporal workflows + one `createLedgerActivities(deps)` factory, following the exact pattern of existing `createActivities`. A new pure function `computeProposedAllocations` in `@cogni/attribution-ledger/rules` handles the aggregation math. A new `resolveIdentities` method on `ActivityLedgerStore` queries `user_bindings` for batch identity resolution.

**Reuses**:

- Existing `createActivities(deps)` DI pattern (closure factory with injected adapters)
- Existing `DrizzleAttributionAdapter` for all DB operations
- Existing `GitHubSourceAdapter` for activity collection
- Existing `computeStatementItems()` + `computeAllocationSetHash()` from `@cogni/attribution-ledger`
- Existing `createServiceDbClient` for worker DB access
- `node_id` from `repo-spec.yaml` (already in env via `NODE_ID`)
- `scope_id` from repo-spec or project manifests (V0: `'default'`; multi-scope: from `.cogni/projects/*.yaml`)
- Temporal `proxyActivities` pattern from `scheduled-run.workflow.ts`

**Rejected**:

- **Single merged activities file**: Mixing scheduler + ledger activities in one factory would create a god-object. Separate `createLedgerActivities` keeps deps focused.
- **Activity-per-adapter**: Making each adapter call a separate Temporal activity adds unnecessary orchestration complexity. A single `collectFromSource` activity loops internally — adapters are fast I/O, not long-running compute.
- **Curation-at-collect-time**: The original requirements spec curating (assigning epoch + resolving identity) during collection. This is correct — curation rows link events to epochs and carry resolved `userId`. Deferring curation to a separate step would complicate allocation computation.
- **Weekly Schedule in task.0095**: Defer schedule registration to task.0096 (API routes / seed script). The workflows don't care how they're triggered.

### Repo-Spec Configuration (prerequisite)

Epoch config belongs in `.cogni/repo-spec.yaml` — it's governance, not code:

```yaml
activity_ledger:
  epoch_length_days: 7
  activity_sources:
    github:
      credit_estimate_algo: cogni-v0.0
    # discord:
    #   credit_estimate_algo: cogni-v0.0
```

The workflow reads `epoch_length_days` to compute `periodStart`/`periodEnd`. `activity_sources` declares which adapters to run. `credit_estimate_algo` is a named reference to the weight config version — V0 hardcodes `cogni-v0.0` weights in code; vNext loads scoring schemas from repo-spec.

**Scope parameter:** Workflows accept `scope_id` (V0: always `'default'`). Deterministic workflow IDs include scope: `ledger-collect-{scopeId}-{periodStart}-{periodEnd}`. Epoch invariants (`ONE_OPEN_EPOCH`, `EPOCH_WINDOW_UNIQUE`) are composite on `(node_id, scope_id)`. See [attribution-ledger.md §Project Scoping](../../docs/spec/attribution-ledger.md#project-scoping).

**Collection cadence** is a Temporal Schedule concern (daily cron `0 6 * * *`), not repo-spec. Daily runs let admins track epoch progress throughout the week. Each run is additive — cursor-based sync picks up where the last run left off.

### Architecture: Two-Task-Queue Approach

Ledger workflows run on a **separate Temporal task queue** (`ledger-tasks`) from the scheduler queue (`scheduler-tasks`). This:

- Prevents ledger work from contending with graph execution
- Allows independent scaling
- Keeps the existing worker.ts unchanged (no merge conflicts)

A new `ledger-worker.ts` creates the ledger-specific Worker. `main.ts` starts both workers on the same process (single deployment, two pollers).

### Activity Functions (7 activities)

All activities created via `createLedgerActivities(deps)` factory:

```
LedgerActivityDeps {
  ledgerStore: ActivityLedgerStore;  // DrizzleAttributionAdapter
  adapters: SourceAdapter[];         // [GitHubSourceAdapter, ...]
  nodeId: string;                    // from NODE_ID env
  logger: Logger;
}
```

| Activity             | Input                              | Output               | Idempotency                              |
| -------------------- | ---------------------------------- | -------------------- | ---------------------------------------- |
| `createOrFindEpoch`  | window, weightConfig               | epoch                | EPOCH_WINDOW_UNIQUE (DB constraint)      |
| `collectFromSource`  | source, streams, cursor, window    | events[], nextCursor | ACTIVITY_IDEMPOTENT (PK conflict → skip) |
| `insertEvents`       | events[]                           | void                 | onConflictDoNothing on PK                |
| `saveCursor`         | source, stream, scope, cursorValue | void                 | upsert (last-write-wins)                 |
| `curateAndResolve`   | epochId, events[]                  | void                 | upsertCuration (idempotent)              |
| `computeAllocations` | epochId, weightConfig              | void                 | delete+reinsert pattern                  |
| `finalizeEpoch`      | epochId                            | payoutStatement      | EPOCH_CLOSE_IDEMPOTENT                   |

### CollectEpochWorkflow

```
Input: { periodStart, periodEnd, weightConfig }
Deterministic ID: ledger-collect-{periodStart}-{periodEnd}

1. createOrFindEpoch(nodeId, window, weightConfig) → epoch
2. For each adapter in [github, discord]:
     For each stream in adapter.streams():
       cursor = loadCursor(nodeId, source, stream, scope)
       { events, nextCursor } = collectFromSource(source, streams, cursor, window)
       insertEvents(events)
       saveCursor(nodeId, source, stream, scope, nextCursor)
       allEvents.push(...events)
3. curateAndResolve(epoch.id, allEvents)
4. computeAllocations(epoch.id, epoch.weightConfig)
```

**Note on collectFromSource**: This activity calls `adapter.collect()` directly (not via HTTP). The adapter is in-process in the worker. This is safe because:

- Adapters are stateless (cursor persisted in DB)
- `collect()` is idempotent (deterministic event IDs)
- Rate limit errors throw `GitHubRateLimitError` → Temporal retries with backoff

### FinalizeEpochWorkflow

```
Input: { epochId }
Deterministic ID: ledger-finalize-{epochId}

1. finalizeEpoch(epochId) → payoutStatement
   - Activity internally:
     a. getEpoch(epochId) — verify exists, check status
     b. If closed → return existing statement (EPOCH_CLOSE_IDEMPOTENT)
     c. getPoolComponentsForEpoch(epochId) — verify POOL_REQUIRES_BASE
     d. getAllocationsForEpoch(epochId) — build FinalizedAllocation[]
     e. computeStatementItems(allocations, poolTotal)
     f. computeAllocationSetHash(allocations)
     g. Atomic: closeEpoch + insertPayoutStatement
     h. Return statement
```

**Why single activity for finalize?** The finalize logic must be atomic (close epoch + insert statement in one transaction). Splitting across multiple activities would require saga/compensation patterns. A single activity keeps it simple — the DB transaction is the atomicity boundary.

### New pure function: `computeProposedAllocations`

Added to `packages/attribution-ledger/src/rules.ts`:

```typescript
interface CuratedEventForAllocation {
  eventId: string;
  userId: string; // resolved identity (null events excluded before calling)
  source: string; // "github", "discord"
  eventType: string; // "pr_merged", "review_submitted", etc.
  included: boolean;
  weightOverrideMilli: bigint | null;
}

function computeProposedAllocations(
  events: readonly CuratedEventForAllocation[],
  weightConfig: Record<string, number> // key: "source:eventType", value: milli-units
): Array<{ userId: string; proposedUnits: bigint; activityCount: number }>;
```

Logic:

1. Filter to `included === true` events
2. For each event: weight = `weightOverrideMilli ?? weightConfig[source:eventType] ?? 0`
3. Group by userId, sum weights → proposedUnits, count → activityCount
4. Return sorted by userId (deterministic)

### New store method: `resolveIdentities`

Added to `ActivityLedgerStore` port:

```typescript
resolveIdentities(
  provider: string,
  externalIds: string[]
): Promise<Map<string, string>>  // externalId → userId
```

Implementation in `DrizzleAttributionAdapter`: queries `user_bindings` table with `WHERE provider = $1 AND external_id = ANY($2)`.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] WRITES_VIA_TEMPORAL: Both workflows execute all writes in Temporal activities (spec: epoch-ledger-spec)
- [ ] EPOCH_CLOSE_IDEMPOTENT: Closing a closed epoch returns existing statement (spec: epoch-ledger-spec)
- [ ] POOL_REQUIRES_BASE: Finalize rejects if no `base_issuance` pool component (spec: epoch-ledger-spec)
- [ ] PAYOUT_DETERMINISTIC: `computeStatementItems` used — same inputs produce byte-identical output (spec: epoch-ledger-spec)
- [ ] CURSOR_STATE_PERSISTED: Cursors saved after each adapter.collect() call (spec: epoch-ledger-spec)
- [ ] ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert (spec: epoch-ledger-spec)
- [ ] ALL_MATH_BIGINT: `computeProposedAllocations` uses bigint throughout (spec: epoch-ledger-spec)
- [ ] NODE_SCOPED: All operations pass nodeId from env (spec: epoch-ledger-spec)
- [ ] TEMPORAL_DETERMINISM: Workflows contain no I/O — only proxyActivities calls (spec: temporal-patterns)
- [ ] IDENTITY_BEST_EFFORT: Unresolved events get null userId in curation, excluded from allocations (spec: epoch-ledger-spec)
- [ ] SIMPLE_SOLUTION: Follows existing createActivities DI pattern, reuses all existing domain logic
- [ ] ARCHITECTURE_ALIGNMENT: services/ imports only from packages/, never from src/ (spec: architecture)

### Files

**Create:**

- `services/scheduler-worker/src/activities/ledger.ts` — `createLedgerActivities(deps)` factory with 7 activity functions
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — collection orchestration
- `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` — finalization orchestration
- `services/scheduler-worker/src/ledger-worker.ts` — Temporal Worker for `ledger-tasks` queue

**Modify:**

- `packages/attribution-ledger/src/rules.ts` — add `computeProposedAllocations()` pure function
- `packages/attribution-ledger/src/store.ts` — add `resolveIdentities()` to port interface
- `packages/attribution-ledger/src/index.ts` — re-export new types
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — implement `resolveIdentities()`
- `services/scheduler-worker/src/main.ts` — start ledger worker alongside scheduler worker
- `services/scheduler-worker/src/config.ts` — add `NODE_ID` env var (required)

**Test:**

- `tests/unit/core/ledger/rules.test.ts` — add `computeProposedAllocations` tests
- Integration/stack tests deferred to task.0096

## Requirements

- 2 workflows in `services/scheduler-worker/src/workflows/`:
  - `collect-epoch.workflow.ts`:
    1. Create or find epoch for target time window (EPOCH_WINDOW_UNIQUE)
    2. Check no other epoch open for different window (ONE_OPEN_EPOCH)
    3. For each registered source adapter:
       - Activity: load cursor from `source_cursors`
       - Activity: `adapter.collect({ streams, cursor, window })` → events
       - Activity: insert `activity_events` (idempotent by PK)
       - Activity: save cursor to `source_cursors`
    4. Activity: resolve identities via `user_bindings` lookup
    5. Activity: compute proposed allocations from events + weight_config → insert `epoch_allocations`
  - `finalize-epoch.workflow.ts`:
    1. Verify epoch exists and is open
    2. If already closed, return existing statement (EPOCH_CLOSE_IDEMPOTENT)
    3. Verify POOL_REQUIRES_BASE (at least one `base_issuance`)
    4. Read `epoch_allocations` — use `final_units` where set, fall back to `proposed_units`
    5. Read pool components → `pool_total_credits = SUM(amount_credits)`
    6. `computeStatementItems(allocations, pool_total)` — BIGINT, largest-remainder
    7. Compute `allocation_set_hash`
    8. Atomic: set `pool_total_credits`, close epoch, insert `payout_statement`

- Deterministic workflow IDs:
  - `ledger-collect-{periodStart}-{periodEnd}` (ISO date strings)
  - `ledger-finalize-{epochId}`

- Activity functions in `services/scheduler-worker/src/activities/ledger.ts` following `createLedgerActivities(deps)` pattern

- Activities import pure domain logic from `@cogni/attribution-ledger` and DB operations from `@cogni/db-client` (`DrizzleAttributionAdapter`)

- Register workflows + activities on `ledger-tasks` task queue via `ledger-worker.ts`

## Allowed Changes

- `.cogni/repo-spec.yaml` (add activity_ledger section)
- `services/scheduler-worker/src/workflows/` (2 new workflow files)
- `services/scheduler-worker/src/activities/ledger.ts` (new)
- `services/scheduler-worker/src/ledger-worker.ts` (new)
- `services/scheduler-worker/src/main.ts` (start ledger worker)
- `services/scheduler-worker/src/config.ts` (add NODE_ID)
- `packages/attribution-ledger/src/rules.ts` (add computeProposedAllocations)
- `packages/attribution-ledger/src/store.ts` (add resolveIdentities)
- `packages/attribution-ledger/src/index.ts` (re-export)
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` (implement resolveIdentities)

## Plan

- [x] Add `scope_id` to ledger tables (epochs, activity_events, source_cursors) — DB schema, port, adapter, migration 0012, tests
- [x] Rename `source_cursors.scope` → `source_ref` (reserve "scope" for governance domain)
- [x] Add `activity_ledger` section to `.cogni/repo-spec.yaml` (epoch_length_days, activity_sources)
- [x] Add `scope_id`, `scope_key` to repo-spec.yaml (uuidv5(node_id, "default"))
- [x] Add `scopeIdSchema`, `scopeKeySchema`, `activityLedgerSpecSchema` to `repoSpec.schema.ts`
- [x] Add `NODE_ID`, `SCOPE_ID`, `SCOPE_KEY` to scheduler-worker env schema
- [x] Extend `CreateScheduleParams` with optional `workflowType` + `taskQueueOverride`
- [x] Extend `syncGovernanceSchedules` for LEDGER_INGEST → CollectEpochWorkflow on `ledger-tasks` queue
- [x] Add LEDGER_INGEST schedule to governance schedules in repo-spec
- [ ] Add `computeProposedAllocations()` to `packages/attribution-ledger/src/rules.ts` + unit tests → moved to task.0102
- [ ] Add `resolveIdentities()` to store port + implement in DrizzleAttributionAdapter → moved to task.0101
- [x] Create `services/scheduler-worker/src/activities/ledger.ts` with `createLedgerActivities(deps)`
- [x] Implement `CollectEpochWorkflow` — create epoch, collect from sources, insert events, save cursors
- [ ] Implement `FinalizeEpochWorkflow` — read allocations + pool, compute payouts, atomic close → moved to task.0102
- [x] Create `ledger-worker.ts` and wire into `main.ts`
- [ ] Rename `governance:` schedule prefix to distinguish agent runs vs data pipelines (deferred)

## Validation

**Command:**

```bash
pnpm check
pnpm --filter scheduler-worker build
pnpm test -- tests/unit/core/ledger/
```

**Expected:** Types pass, worker builds, unit tests green. Full pipeline tested in task.0096 stack tests.

## Review Checklist

- [ ] **Work Item:** `task.0095` linked in PR body
- [ ] **Spec:** WRITES_VIA_TEMPORAL, EPOCH_CLOSE_IDEMPOTENT, POOL_REQUIRES_BASE, PAYOUT_DETERMINISTIC, CURSOR_STATE_PERSISTED, ACTIVITY_IDEMPOTENT
- [ ] **Tests:** `computeProposedAllocations` unit tested; workflow pipeline tested in task.0096
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0095.handoff.md)

## Attribution

-
