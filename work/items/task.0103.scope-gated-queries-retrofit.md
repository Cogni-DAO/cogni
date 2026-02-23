---
id: task.0103
type: task
title: "SCOPE_GATED_QUERIES: scope-gate all epochId-based adapter methods"
status: needs_merge
priority: 1
rank: 4
estimate: 1
summary: "Retrofit DrizzleLedgerAdapter so every epochId-based read AND write enforces scope_id via a validated epoch lookup. Prevents cross-tenant data access. No port signature changes."
outcome: "Every adapter method that accepts epochId verifies the epoch belongs to the expected scope before operating on child data. Callers get EpochNotFoundError for scope mismatches (same as non-existent epoch)."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: fix/scope-gated-queries
pr: https://github.com/Cogni-DAO/node-template/pull/465
reviewer:
revision: 0
blocked_by: task.0093
deploy_verified: false
created: 2026-02-23
updated: 2026-02-23
labels: [governance, ledger, security]
external_refs:
---

# SCOPE_GATED_QUERIES: Scope-Gate All EpochId-Based Adapter Methods

## Design

### Outcome

Every adapter method that takes `epochId` verifies the epoch belongs to the configured scope before reading/writing child data. A scope mismatch surfaces as `EpochNotFoundError` — indistinguishable from a genuinely missing epoch. This closes a tenant-escape bug where any valid epochId could access data across scopes.

### Approach

**Solution**: Inject `scopeId` into the adapter at construction time (same as how callers already pass `nodeId` to workflows). Add a private `resolveEpochScoped(epochId)` helper that does `WHERE id = $epochId AND scope_id = $scopeId` and throws `EpochNotFoundError` on 0 rows. All epochId-based methods call this before operating.

**Key insight**: Child tables (`activity_curation`, `epoch_allocations`, `epoch_pool_components`, `payout_statements`) do NOT have `scope_id` columns — they reference epochs via FK. Since `epoch_id` is a globally unique bigserial PK, once we validate the epoch belongs to our scope, child queries on `epoch_id` are safe. No schema changes needed.

**Pattern**:

```typescript
export class DrizzleLedgerAdapter implements ActivityLedgerStore {
  constructor(
    private readonly db: Database,
    private readonly scopeId: string // NEW: injected at construction
  ) {}

  /** Validate epoch belongs to this adapter's scope. */
  private async resolveEpochScoped(epochId: bigint): Promise<LedgerEpoch> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, epochId), eq(epochs.scopeId, this.scopeId)))
      .limit(1);
    if (!rows[0]) throw new EpochNotFoundError(epochId.toString());
    return toEpoch(rows[0]);
  }
}
```

**Reuses**:

- Existing `EpochNotFoundError` (already in ledger-core)
- Existing `DrizzleLedgerAdapter` class (no new file)
- Existing adapter integration test (`tests/component/db/drizzle-ledger.adapter.int.test.ts`)

**Rejected**:

1. **Add scope_id to all child tables**: Denormalization not needed — epochId is globally unique (bigserial PK). Scope gating on the epoch lookup is sufficient. Adding scope_id to 4 tables + updating all queries is a larger migration for no safety gain.
2. **Port signature refactor**: Adding scopeId to every port method (e.g., `getCurationForEpoch(scopeId, epochId)`) would require changes to every caller. Option B: scope is an adapter construction-time concern, invisible to the port. Simpler.
3. **RLS policies**: Defense-in-depth, but worker uses service-role (BYPASSRLS). RLS is a future task, not a substitute for correct query predicates.
4. **Middleware/decorator pattern**: Wrapping the adapter in a scope-checking proxy. Over-engineered — the adapter IS the data access layer; scope gating belongs inside it.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] SCOPE_GATED_QUERIES: Every adapter method that takes epochId calls `resolveEpochScoped()` or includes `AND scope_id = this.scopeId` in its WHERE clause. (spec: epoch-ledger)
- [ ] SCOPE_MISMATCH_IS_NOT_FOUND: Scope mismatches throw `EpochNotFoundError`, not a new error type. Callers cannot distinguish "wrong scope" from "doesn't exist." (security)
- [ ] NO_PORT_CHANGES: `ActivityLedgerStore` interface is unchanged. scopeId is adapter-internal.
- [ ] CONSTRUCTOR_INJECTION: scopeId passed at adapter construction, not per-method.
- [ ] SIMPLE_SOLUTION: One private helper method, no new files, no schema changes.
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal pattern — scope is an adapter concern, port stays pure. (spec: architecture)

### Detailed Changes

#### 1. Adapter constructor: add scopeId (`packages/db-client/src/adapters/drizzle-ledger.adapter.ts`)

```typescript
export class DrizzleLedgerAdapter implements ActivityLedgerStore {
  constructor(
    private readonly db: Database,
    private readonly scopeId: string,
  ) {}
```

Add private helper:

```typescript
private async resolveEpochScoped(epochId: bigint): Promise<LedgerEpoch> {
  const rows = await this.db
    .select()
    .from(epochs)
    .where(and(eq(epochs.id, epochId), eq(epochs.scopeId, this.scopeId)))
    .limit(1);
  if (!rows[0]) throw new EpochNotFoundError(epochId.toString());
  return toEpoch(rows[0]);
}
```

#### 2. Patch all epochId-based methods

**Methods that need scope gating** (take epochId, currently no scope check):

| Method                                     | Current WHERE                               | Fix                                |
| ------------------------------------------ | ------------------------------------------- | ---------------------------------- |
| `getEpoch(id)`                             | `id = $id`                                  | `id = $id AND scope_id = $scopeId` |
| `closeEpoch(epochId, poolTotal)`           | `id = $epochId AND status = 'open'`         | Add `AND scope_id = $scopeId`      |
| `getCurationForEpoch(epochId)`             | `epoch_id = $epochId`                       | Call `resolveEpochScoped` first    |
| `getUnresolvedCuration(epochId)`           | `epoch_id = $epochId`                       | Call `resolveEpochScoped` first    |
| `updateAllocationFinalUnits(epochId, ...)` | `epoch_id = $epochId AND user_id = $userId` | Call `resolveEpochScoped` first    |
| `getAllocationsForEpoch(epochId)`          | `epoch_id = $epochId`                       | Call `resolveEpochScoped` first    |
| `getPoolComponentsForEpoch(epochId)`       | `epoch_id = $epochId`                       | Call `resolveEpochScoped` first    |
| `getStatementForEpoch(epochId)`            | `epoch_id = $epochId`                       | Call `resolveEpochScoped` first    |
| `getUncuratedEvents(nodeId, epochId, ...)` | `node_id = $nodeId AND ...`                 | Call `resolveEpochScoped` first    |
| `updateCurationUserId(epochId, ...)`       | `epoch_id = $epochId AND ...`               | Call `resolveEpochScoped` first    |

**Epoch-direct methods** (`getEpoch`, `closeEpoch`): Add `eq(epochs.scopeId, this.scopeId)` directly to the WHERE clause.

**Child-table methods** (all others above): Call `await this.resolveEpochScoped(epochId)` at the top. This validates scope ownership before the child query runs. One extra SELECT per call — acceptable for correctness. Can be optimized with caching later if needed.

**Methods that are already scope-safe** (no changes needed):

| Method                                   | Why safe                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `createEpoch(params)`                    | Caller passes scopeId explicitly                                                       |
| `getOpenEpoch(nodeId, scopeId)`          | Already filters by scopeId                                                             |
| `getEpochByWindow(nodeId, scopeId, ...)` | Already filters by scopeId                                                             |
| `listEpochs(nodeId)`                     | Add `AND scope_id = $scopeId` for consistency                                          |
| `insertActivityEvents(events)`           | Events carry their own scopeId                                                         |
| `getActivityForWindow(nodeId, ...)`      | Epoch-independent (time-windowed)                                                      |
| `upsertCuration(params)`                 | Params carry nodeId + epochId (could add scope check but writes are workflow-internal) |
| `insertCurationDoNothing(params)`        | Same as upsertCuration                                                                 |
| `upsertCursor / getCursor`               | Already scope-parameterized                                                            |
| `insertPoolComponent(params)`            | Params carry nodeId + epochId                                                          |
| `insertPayoutStatement(params)`          | Params carry nodeId + epochId                                                          |
| `insertStatementSignature(params)`       | FK to statement (no epochId)                                                           |
| `getSignaturesForStatement(statementId)` | FK to statement (no epochId)                                                           |
| `resolveIdentities(...)`                 | Cross-domain, no epoch                                                                 |

**`listEpochs(nodeId)`**: Add `AND scope_id = this.scopeId` to WHERE clause for consistency (currently returns all epochs for a nodeId across scopes).

#### 3. Update adapter construction sites

Every place that creates `new DrizzleLedgerAdapter(db)` must pass `scopeId`:

- `src/adapters/server/container.ts` — app container (get from `getScopeId()` or equivalent config)
- `services/scheduler-worker/src/activities/ledger-activities.ts` — Temporal worker (get from workflow input or config)
- `tests/component/db/drizzle-ledger.adapter.int.test.ts` — tests (use test scopeId)
- `tests/stack/ledger/*.stack.test.ts` — stack tests (use test scopeId)

#### 4. Add scope-isolation test cases

Add to existing `drizzle-ledger.adapter.int.test.ts`:

```typescript
describe("SCOPE_GATED_QUERIES", () => {
  it("getEpoch rejects epochId from different scope", async () => {
    // Create epoch in scope-A, query from adapter bound to scope-B
    const epochA = await adapterA.createEpoch({ scopeId: scopeA, ... });
    await expect(adapterB.getEpoch(epochA.id)).rejects.toThrow(EpochNotFoundError);
  });

  it("getCurationForEpoch rejects cross-scope epochId", async () => { ... });
  it("closeEpoch rejects cross-scope epochId", async () => { ... });
  it("getAllocationsForEpoch rejects cross-scope epochId", async () => { ... });
  // ... one test per method
});
```

### Files

<!-- High-level scope -->

- Modify: `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — add scopeId to constructor, add `resolveEpochScoped()`, patch all epochId methods
- Modify: `src/adapters/server/container.ts` — pass scopeId to adapter construction
- Modify: `services/scheduler-worker/src/activities/ledger-activities.ts` — pass scopeId to adapter construction
- Test: `tests/component/db/drizzle-ledger.adapter.int.test.ts` — scope-isolation test cases

## Validation

**Command:**

```bash
pnpm check
pnpm packages:build
pnpm dotenv -e .env.test -- vitest run tests/component/db/drizzle-ledger.adapter.int.test.ts
```

**Expected:** Types pass, all existing adapter tests still green, new scope-isolation tests green.

## Review Checklist

- [ ] **Work Item:** `task.0103` linked in PR body
- [ ] **Spec:** SCOPE_GATED_QUERIES invariant enforced on every epochId method
- [ ] **Tests:** Cross-scope rejection for getEpoch, closeEpoch, getCuration, getAllocations, getPoolComponents, getStatement
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0103.handoff.md)

## Attribution

-
