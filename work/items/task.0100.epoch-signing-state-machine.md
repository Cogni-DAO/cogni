---
id: task.0100
type: task
title: "Epoch 3-phase state machine + approvers + canonical signing message"
status: done
priority: 1
rank: 6
estimate: 2
summary: "DB migration for open→review→finalized lifecycle, updated curation freeze trigger, close-ingestion store method + API route, approvers config in repo-spec, and buildCanonicalMessage() pure function for EIP-191 signing."
outcome: "Epochs transition open→review→finalized with DB constraint enforcement. Curation stays mutable until finalize. Approvers declared in repo-spec. Canonical signing message format shared between frontend and backend."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/task-0100-epoch-state-machine
pr: https://github.com/Cogni-DAO/node-template/pull/468
reviewer:
revision: 4
blocked_by: task.0093, task.0103
deploy_verified: false
created: 2026-02-22
updated: 2026-02-24
labels: [governance, ledger, signing, security]
external_refs:
---

# Epoch 3-Phase State Machine + Approvers + Canonical Signing

## Design

### Outcome

Epochs gain the `open → review → finalized` lifecycle required by EPOCH_THREE_PHASE. Curation remains mutable during review (CURATION_FREEZE_ON_FINALIZE). Approvers are declared in repo-spec (APPROVERS_PER_SCOPE). The canonical signing message format is defined for EIP-191 (SIGNATURE_SCOPE_BOUND). This unblocks task.0102 (allocation computation + FinalizeEpochWorkflow) and task.0096 (API routes).

### Approach

**Solution**: Edit existing migrations in place (ledger tables have never been deployed to production) to use 3-phase (`open`/`review`/`finalized`) from the start. One new store method (`closeIngestion`). One new API route (`close-ingestion`). Approvers added to repo-spec. Pure `buildCanonicalMessage()` in ledger-core. No sign route in V0 — signature passed inline to finalize (task.0102).

**Reuses**:

- Existing `closeEpoch()` store method (rename to `finalizeEpoch()`, update transition from `open→closed` to `review→finalized`)
- Existing repo-spec config pattern (`getNodeId()`, `getPaymentConfig()`, `getGovernanceConfig()`)
- Existing `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })` for SIWE route
- Existing `insertStatementSignature()` / `getSignaturesForStatement()` store methods (already implemented)
- CollectEpochWorkflow already enforces INGESTION_CLOSED_ON_REVIEW at app layer (line 126: `if (epoch.status !== "open") return;`)

**Rejected**:

1. **Separate sign route (V0)**: `statement_signatures` has FK to `payout_statements` — can't store signatures before the statement exists. Workarounds (nullable FK, staging table) add complexity for a V0 single-approver model. Simpler: finalize route (task.0102) takes signature inline, creates statement + signature atomically. Sign route is a V1 concern (multi-sig).
2. **DB trigger for INGESTION_CLOSED_ON_REVIEW**: `activity_events` has no `epoch_id` column (epoch membership is at curation layer). A trigger would require joining on `event_time` against epoch windows — fragile and slow. The workflow already skips collection when status != 'open' (app-level enforcement). Good enough for V0.
3. **viem in ledger-core**: Considered adding `verifyMessage` to ledger-core for a `verifyStatementSignature()` function. Rejected — ledger-core has zero runtime deps and should stay pure. Verification happens in the finalize route (task.0102) using viem at the app layer. `buildCanonicalMessage()` is all that needs sharing.
4. **Full state machine abstraction**: `EpochStateMachine` class with event-sourced transitions. Over-engineered — the state machine is a column with 3 values and 2 forward-only transitions, enforced by WHERE clauses on UPDATE.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] EPOCH_THREE_PHASE: Status enum is `open | review | finalized`. No backward transitions. DB CHECK constraint + UPDATE WHERE clause enforce. (spec: epoch-ledger)
- [ ] ONE_OPEN_EPOCH: Partial unique index on `WHERE status = 'open'`. Only one open epoch per (nodeId, scopeId). Review epochs coexist with the next open epoch — no schedule deadlock. (spec: epoch-ledger)
- [ ] CURATION_FREEZE_ON_FINALIZE: DB trigger rejects curation writes only when `status = 'finalized'`. Curation stays mutable during `open` and `review`. (spec: epoch-ledger)
- [ ] INGESTION_CLOSED_ON_REVIEW: App-level enforcement — CollectEpochWorkflow exits when `status != 'open'`. No DB trigger on `activity_events`. (spec: epoch-ledger)
- [ ] APPROVERS_PER_SCOPE: `ledger.approvers` in repo-spec as array of EVM addresses. `getLedgerApprovers()` accessor cached same as `getNodeId()`. (spec: epoch-ledger)
- [ ] APPROVERS_PINNED_AT_REVIEW: `closeIngestion` stores `approver_set_hash` (SHA-256 of sorted, lowercased approver addresses) on the epoch row. `finalizeEpoch` verifies the signer against this pinned snapshot — repo-spec drift cannot block older epochs. (spec: epoch-ledger)
- [ ] SIGNATURE_SCOPE_BOUND: `buildCanonicalMessage()` includes version header (`Cogni Payout Statement v1`) + `node_id + scope_id + epoch_id + allocation_set_hash + pool_total_credits`. Newline separator is `\n` only (no `\r`). Tests assert exact byte output. (spec: epoch-ledger)
- [ ] SCOPE_GATED_QUERIES: New adapter methods (`closeIngestion`, `finalizeEpoch`) enforce `AND scope_id = this.scopeId` in WHERE clause. No cross-scope epoch transitions possible. (dep: task.0103)
- [ ] SIMPLE_SOLUTION: Reuses existing store methods, DB trigger function, and repo-spec patterns.
- [ ] ARCHITECTURE_ALIGNMENT: Pure function in ledger-core. Route uses existing auth wrappers. Config follows repo-spec pattern. (spec: architecture)

### Detailed Changes

#### 1. Edit existing migrations in place (no new migration file)

Ledger tables have never been deployed to production. Edit the source-of-truth files directly:

**`packages/db-schema/src/ledger.ts`** — update Drizzle schema:

```typescript
// epochs table: 3-phase CHECK + partial unique index + approver snapshot
approverSetHash: text("approver_set_hash"), // set at closeIngestion, nullable for open epochs
check("epochs_status_check", sql`${table.status} IN ('open', 'review', 'finalized')`),
uniqueIndex("epochs_one_open_per_node")
  .on(table.nodeId, table.scopeId)
  .where(sql`${table.status} = 'open'`),
```

**`0010_shallow_paibok.sql`** — edit in place:

- Change CHECK from `('open', 'closed')` to `('open', 'review', 'finalized')`
- Keep index name as `epochs_one_open_per_node`
- Keep index WHERE as `status = 'open'` (only one open epoch at a time; review epochs coexist with the next open)
- Add column: `approver_set_hash TEXT` (nullable — only set on closeIngestion)

**`0011_triggers_and_backfill.sql`** — edit in place:

- Rename `curation_freeze_on_close()` → `curation_freeze_on_finalize()`
- Change check from `epoch_status = 'closed'` to `epoch_status = 'finalized'`
- Update error message from "is closed" to "is finalized"
- Update trigger name reference

Dev databases that ran old migrations: `pnpm db:reset` (drop + re-migrate).

#### 2. Model type update (`packages/ledger-core/src/model.ts`)

```typescript
export const EPOCH_STATUSES = ["open", "review", "finalized"] as const;
export type EpochStatus = (typeof EPOCH_STATUSES)[number];
```

#### 3. Store port: add `closeIngestion`, rename `closeEpoch` → `finalizeEpoch` (`packages/ledger-core/src/store.ts`)

```typescript
/** Transition epoch open → review (INGESTION_CLOSED_ON_REVIEW).
 *  Pins approverSetHash — SHA-256 of sorted, lowercased approver addresses. */
closeIngestion(epochId: bigint, approverSetHash: string): Promise<LedgerEpoch>;

/** Transition epoch review → finalized (was closeEpoch). */
finalizeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch>;
```

Note: `closeIngestion` matches existing `closeEpoch` pattern — epochId only, no nodeId (epoch PK is sufficient). Rename `closeEpoch` → `finalizeEpoch` since it now transitions review→finalized, not open→closed.

No new methods needed for signatures — `insertStatementSignature()` and `getSignaturesForStatement()` already exist on the port and adapter.

#### 4. Store adapter: implement `closeIngestion`, rename + update `closeEpoch` → `finalizeEpoch` (`packages/db-client/src/adapters/drizzle-ledger.adapter.ts`)

**`closeIngestion(epochId, approverSetHash)`**: UPDATE epochs SET status='review', approver_set_hash=approverSetHash WHERE id=epochId AND status='open'. Idempotent: if already review, return as-is. If finalized, throw. If not found, throw.

**`finalizeEpoch(epochId, poolTotal)`** (renamed from `closeEpoch`): Change WHERE from `status='open'` to `status='review'`. Same idempotent pattern — already-finalized returns existing. This method is the review→finalized transition used by FinalizeEpochWorkflow (task.0102).

#### 5. Signing module (`packages/ledger-core/src/signing.ts`)

```typescript
export interface CanonicalMessageParams {
  readonly nodeId: string;
  readonly scopeId: string;
  readonly epochId: string; // string (bigint serialized)
  readonly allocationSetHash: string;
  readonly poolTotalCredits: string; // string (bigint serialized)
}

/** Build the EIP-191 canonical message for payout statement signing.
 *  Newline is always \n (no \r). Tests must assert exact bytes. */
export function buildCanonicalMessage(params: CanonicalMessageParams): string {
  return [
    "Cogni Payout Statement v1",
    `Node: ${params.nodeId}`,
    `Scope: ${params.scopeId}`,
    `Epoch: ${params.epochId}`,
    `Allocation Hash: ${params.allocationSetHash}`,
    `Pool Total: ${params.poolTotalCredits}`,
  ].join("\n");
}
```

```typescript
/** Compute deterministic hash of an approver set for pinning at closeIngestion.
 *  Sorted, lowercased, SHA-256. */
export function computeApproverSetHash(approvers: readonly string[]): string {
  const canonical = [...approvers]
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");
  return createHash("sha256").update(canonical).digest("hex");
}
```

Zero runtime deps (uses Node `crypto`). Shared between frontend (wallet signing) and backend (verification in task.0102). Export from `packages/ledger-core/src/index.ts`.

#### 6. Approvers config

**`src/shared/config/repoSpec.schema.ts`** — add `ledger` section:

```typescript
export const ledgerSpecSchema = z.object({
  approvers: z
    .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid EVM address"))
    .min(1, "At least one approver required"),
});

// Add to repoSpecSchema:
ledger: ledgerSpecSchema.optional(),
```

**`src/shared/config/repoSpec.server.ts`** — add `getLedgerApprovers()`:

```typescript
let cachedLedgerApprovers: string[] | null = null;

export function getLedgerApprovers(): string[] {
  if (cachedLedgerApprovers) return cachedLedgerApprovers;
  const spec = loadRepoSpec();
  cachedLedgerApprovers = spec.ledger?.approvers ?? [];
  return cachedLedgerApprovers;
}
```

**`src/shared/config/index.ts`** — add export.

**`.cogni/repo-spec.yaml`** — add section:

```yaml
ledger:
  approvers:
    - "0xYourWalletAddress" # Replace with actual scope approver
```

#### 7. API route: close-ingestion

**Contract**: `src/contracts/ledger.close-ingestion.v1.contract.ts`

```typescript
export const closeIngestionOperation = {
  id: "ledger.close-ingestion.v1",
  params: z.object({ id: z.string() }), // from URL path param — no body input
  output: z.object({
    epoch: EpochDtoSchema, // task.0096 contracts landed — import from there
  }),
};
```

If task.0096 contracts are not yet merged, define a minimal inline `EpochDtoSchema` (id, status, periodStart, periodEnd) and replace with the shared one later.

**Route**: `src/app/api/v1/ledger/epochs/[id]/close-ingestion/route.ts`

POST handler (no request body — epochId from URL path param):

1. SIWE session → get walletAddress
2. Check `walletAddress.toLowerCase()` against `getLedgerApprovers().map(a => a.toLowerCase())` → 403 if not (EVM addresses are case-insensitive; SIWE returns EIP-55 checksummed)
3. Parse epochId from URL path param `[id]`
4. Compute `approverSetHash = computeApproverSetHash(getLedgerApprovers())`
5. Call `store.closeIngestion(BigInt(epochId), approverSetHash)`
6. Return epoch DTO

Uses `wrapRouteHandlerWithLogging({ auth: { mode: "required" } })`. Route lives under `/api/v1/ledger/` (SIWE-protected namespace).

### What This Does NOT Include (deferred)

| Feature                               | Deferred to     | Why                                                                                              |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| sign API route                        | task.0102 or V1 | `statement_signatures` FK requires statement to exist first. V0: signature inline with finalize. |
| finalize API route                    | task.0102       | Triggers FinalizeEpochWorkflow which computes payouts                                            |
| FinalizeEpochWorkflow                 | task.0102       | Needs `computeProposedAllocations()` + payout computation                                        |
| `verifyStatementSignature()`          | task.0102       | Uses viem at app layer; called by finalize route                                                 |
| `computeProposedAllocations()`        | task.0102       | Weight policy → allocations                                                                      |
| INGESTION_CLOSED_ON_REVIEW DB trigger | Never (V0)      | App-level enforcement via workflow skip sufficient                                               |

### Files

<!-- High-level scope -->

- Create: `packages/ledger-core/src/signing.ts` — `buildCanonicalMessage()` pure function
- Create: `src/contracts/ledger.close-ingestion.v1.contract.ts` — Zod contract
- Create: `src/app/api/v1/ledger/epochs/[id]/close-ingestion/route.ts` — SIWE + approver route
- Modify: `packages/db-schema/src/ledger.ts` — 3-phase CHECK + partial unique index
- Modify: `src/adapters/server/db/migrations/0010_shallow_paibok.sql` — match Drizzle schema (edit in place, never deployed)
- Modify: `src/adapters/server/db/migrations/0011_triggers_and_backfill.sql` — rename trigger to `curation_freeze_on_finalize`, check `'finalized'`
- Modify: `packages/ledger-core/src/model.ts` — `EPOCH_STATUSES = ["open", "review", "finalized"]`
- Modify: `packages/ledger-core/src/store.ts` — add `closeIngestion()` to port
- Modify: `packages/ledger-core/src/index.ts` — export signing module
- Modify: `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — implement `closeIngestion()`, rename + update `closeEpoch()` → `finalizeEpoch()`
- Modify: `src/shared/config/repoSpec.schema.ts` — add `ledger.approvers` schema
- Modify: `src/shared/config/repoSpec.server.ts` — add `getLedgerApprovers()`
- Modify: `src/shared/config/index.ts` — export `getLedgerApprovers`
- Modify: `.cogni/repo-spec.yaml` — add `ledger.approvers` section
- Test: `services/scheduler-worker/tests/ledger-activities.test.ts` — state transition tests
- Test: `tests/unit/packages/ledger-core/signing.test.ts` — canonical message format
- Test: `tests/stack/ledger/close-ingestion.stack.test.ts` — API route + approver check

## Plan

- [x] **Checkpoint 1 — Schema + Model + Port**
  - Milestone: 3-phase status compiles, port has closeIngestion + finalizeEpoch
  - Invariants: EPOCH_THREE_PHASE, ONE_OPEN_EPOCH, APPROVERS_PINNED_AT_REVIEW
  - Todos:
    - [x] Edit `packages/db-schema/src/ledger.ts` — 3-phase CHECK, partial unique WHERE status='open', add approverSetHash column
    - [x] Edit `0010_shallow_paibok.sql` — match Drizzle schema
    - [x] Edit `0012_add_scope_id.sql` — index matches new status
    - [x] Edit `0011_triggers_and_backfill.sql` — rename trigger to curation_freeze_on_finalize, check 'finalized'
    - [x] Edit `packages/ledger-core/src/model.ts` — EPOCH_STATUSES = ["open", "review", "finalized"]
    - [x] Edit `packages/ledger-core/src/store.ts` — add closeIngestion, rename closeEpoch→finalizeEpoch, add approverSetHash to LedgerEpoch
    - [x] Edit `packages/ledger-core/src/errors.ts` — update EpochAlreadyClosedError → EpochAlreadyFinalizedError
  - Validation: `pnpm check` passes (types + lint)

- [x] **Checkpoint 2 — Adapter + Signing + Tests**
  - Milestone: Adapter implements new methods, signing module exists, unit tests pass
  - Invariants: SCOPE_GATED_QUERIES, SIGNATURE_SCOPE_BOUND, CURATION_FREEZE_ON_FINALIZE
  - Todos:
    - [x] Edit `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — implement closeIngestion, rename+update closeEpoch→finalizeEpoch
    - [x] Create `packages/ledger-core/src/signing.ts` — buildCanonicalMessage + computeApproverSetHash
    - [x] Edit `packages/ledger-core/src/index.ts` — export signing module
    - [x] Create `tests/unit/packages/ledger-core/signing.test.ts` — exact bytes, version header, newlines
    - [x] Update all callers of closeEpoch → finalizeEpoch (seed-ledger, integration tests, mock store, external tests)
    - [x] Update all references to "closed" status → "finalized" (contracts, routes, tests)
  - Validation: `pnpm check` + `pnpm test -- tests/unit/packages/ledger-core/signing`

- [x] **Checkpoint 3 — API Route + Contract**
  - Milestone: review route works, all tests green
  - Invariants: WRITE_ROUTES_APPROVER_GATED, APPROVERS_PER_SCOPE
  - Todos:
    - [x] Create `src/contracts/ledger.review-epoch.v1.contract.ts`
    - [x] Create `src/app/api/v1/ledger/epochs/[id]/review/route.ts`
  - Validation: `pnpm check` passes

## Validation

**Command:**

```bash
pnpm check
pnpm packages:build
pnpm test -- tests/unit/packages/ledger-core/signing
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** Types pass, signing unit tests green, stack tests green.

## Review Feedback (revision 3)

### Blocking Issues

1. **`finalizeEpoch` fallback silently returns wrong-state epoch.** In `drizzle-ledger.adapter.ts`, when `finalizeEpoch` is called on an `open` epoch (skipping review), the WHERE clause `status = 'review'` matches no rows, fallback finds the open epoch via `getEpoch()`, and returns it silently. The caller may proceed thinking finalization succeeded. **Fix:** In the fallback branch after `getEpoch()`, check `if (existing.status === 'open') throw new EpochNotOpenError(epochId.toString())`. Apply same pattern to `closeIngestion` — if `existing.status === 'finalized'`, throw `EpochAlreadyFinalizedError`.

2. **Spec/impl mismatch: ONE_OPEN_EPOCH.** `docs/spec/epoch-ledger.md` L50 and L83 say `WHERE status != 'finalized'` but the actual DB index is `WHERE status = 'open'`. The design review deliberately changed this. **Fix:** Update spec L50 description to say "at most one epoch with `status = 'open'`" and L83 composite invariant to `WHERE status = 'open'`. Rename invariant to `ONE_OPEN_EPOCH` for clarity.

3. **Spec/impl mismatch: INGESTION_CLOSED_ON_REVIEW.** Spec L45 says "DB trigger rejects INSERT on activity_events" but no such trigger exists — enforcement is app-level (workflow skips when `status != 'open'`). **Fix:** Update spec to say "App-level enforcement — CollectEpochWorkflow exits when status != 'open'. No DB trigger on activity_events (V0)."

### Non-blocking Suggestions

- Add test for curation mutable during `review` status (CURATION_FREEZE_ON_FINALIZE)
- Add test for `closeIngestion` on finalized epoch and `finalizeEpoch` on open epoch
- `toEpochDto` doesn't include `approverSetHash` — consider adding
- Rename variable `closedEpochs` → `finalizedEpochs` in `epochs/route.ts`
- Alphabetize signing exports in `packages/ledger-core/src/index.ts`

## Review Checklist

- [ ] **Work Item:** `task.0100` linked in PR body
- [ ] **Spec:** EPOCH_THREE_PHASE, ONE_OPEN_EPOCH, CURATION_FREEZE_ON_FINALIZE, APPROVERS_PER_SCOPE, SIGNATURE_SCOPE_BOUND invariants enforced
- [ ] **Tests:** state transitions (open→review, review→finalized, reject backward), curation mutable during review, canonical message format, approver check on close-ingestion
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0100.handoff.md)

## Attribution

-
