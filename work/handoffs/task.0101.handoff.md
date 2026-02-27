---
id: task.0101.handoff
type: handoff
work_item_id: task.0101
status: active
created: 2026-02-22
updated: 2026-02-22
branch: staging
last_commit:
---

# Handoff: Identity Resolution + Curation Auto-Population (task.0101)

## Context

You are implementing the missing link between raw activity collection and allocation computation in the transparent credit payouts pipeline (`proj.transparent-credit-payouts`).

The collection pipeline (task.0095, merged) ingests GitHub activity into `activity_events`. The identity schema (task.0089, merged) provides `user_bindings` for mapping platform identities to users. But nothing connects them — no curation rows are created, no identities are resolved. Without this, task.0102 (allocation computation) has no input.

**Read the full design in the work item**: `work/items/task.0101.identity-resolution-curation.md`

## Critical Design Constraints (from review)

These four rules are non-negotiable — the design review specifically required them:

1. **Merge semantics**: On conflict, update ONLY `user_id` when existing `user_id IS NULL`. Never touch `included`, `weight_override_milli`, `note` on re-runs. Do NOT use the existing `upsertCuration()` for auto-population — it overwrites all fields.

2. **Query by epochId**: Treat `epochId` as authoritative. Load the epoch row to get period dates. Do not accept period dates as input to the activity — only `epochId`.

3. **Delta processing**: Process only events missing curation rows OR with `user_id IS NULL`. Never re-process events already curated with a resolved userId. This preserves admin edits and reduces write amplification.

4. **Provider typing**: Constrain `provider` to `'github'` (literal type). Verify that `platformUserId` in `activity_events` matches `external_id` format in `user_bindings` (both are GitHub numeric `databaseId` as string).

## What Exists (All Merged to Staging)

### Collection Pipeline (task.0095)

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — `CollectEpochWorkflow` with 4 steps. **You add step 5: curateAndResolve.**
- `services/scheduler-worker/src/activities/ledger.ts` — `createLedgerActivities(deps)` factory with 5 activities. **You add `curateAndResolve` here.**
- `LedgerActivities` type alias = `ReturnType<typeof createLedgerActivities>` — adding a function auto-exports it
- `LedgerActivityDeps`: `{ ledgerStore, sourceAdapters, nodeId, scopeId, logger }`

### Identity Schema (task.0089)

- `packages/db-schema/src/identity.ts` — `userBindings` table: `(id, user_id, provider, external_id, created_at)` with `UNIQUE(provider, external_id)`
- Provider check constraint: `IN ('wallet', 'discord', 'github')`

### Store Port + Adapter

- `packages/ledger-core/src/store.ts` — `ActivityLedgerStore` interface
- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — `DrizzleAttributionAdapter`
- Currently does NOT import identity tables — you add `import { userBindings } from "@cogni/db-schema/identity"`

### Existing Curation Methods (DO NOT use for auto-population)

- `upsertCuration(params[])` — uses `onConflictDoUpdate` which OVERWRITES all fields. Safe for admin API edits, NOT for auto-population.
- `getCurationForEpoch(epochId)`, `getUnresolvedCuration(epochId)` — read methods, usable.

## What You Build

### 3 New Store Methods

**1. `resolveIdentities(provider, externalIds)`** — query `user_bindings` by provider + external_id batch. Returns `Map<externalId, userId>`.

**2. `getUncuratedEvents(nodeId, epochId, periodStart, periodEnd)`** — LEFT JOIN `activity_events` with `activity_curation`. Returns events where: no curation row exists OR curation.user_id IS NULL. Include a `hasExistingCuration` flag so the activity knows whether to INSERT or UPDATE.

**3. `updateCurationUserId(epochId, eventId, userId)`** — UPDATE `user_id` on curation row WHERE `user_id IS NULL`. Conditional — no-op if already resolved. Never touches other fields.

### 1 New Activity

**`curateAndResolve({ epochId })`** — the sole input is epochId (string, bigint serialized for Temporal).

Logic:

1. Load epoch by ID → get periodStart, periodEnd (fail if not found)
2. `getUncuratedEvents(nodeId, epochId, periodStart, periodEnd)` — delta only
3. Group unique platformUserId by source
4. For each source: `resolveIdentities('github', externalIds)` — batch
5. **New events** (hasExistingCuration=false): INSERT curation rows with `userId = resolved ?? null`, `included = true`. Use `ON CONFLICT DO NOTHING` for race safety.
6. **Existing unresolved** (hasExistingCuration=true, userId was NULL): call `updateCurationUserId` for each newly resolved ID. Skip if still unresolved.
7. Return `{ totalEvents, newCurations, resolved, unresolved }`

### 1 Workflow Change

After the collection loops in `collect-epoch.workflow.ts`, add:

```typescript
// 5. Curate events and resolve identities (CURATION_AUTO_POPULATE)
await curateAndResolve({ epochId: epoch.epochId });
```

Add `curateAndResolve` to the existing default `proxyActivities` call (2-minute timeout).

## Gotchas

- `DrizzleAttributionAdapter` currently imports only from `@cogni/db-schema/ledger`. You add `import { userBindings } from "@cogni/db-schema/identity"` — run `pnpm check` to verify dep-cruiser allows it
- `epochId` is serialized as string in Temporal (bigint doesn't serialize). Parse back with `BigInt(input.epochId)`
- The LEFT JOIN in `getUncuratedEvents` needs to distinguish "no curation row" from "curation with null userId" — use `isNull(activityCuration.id)` for the former
- `getActivityForWindow` queries by `(nodeId, eventTime)` without scopeId. V0: single scope, not an issue. Add a `// TODO: scopeId filter for multi-scope` comment
- The existing `upsertCuration` loops one-by-one (N round-trips). For new curation row inserts, consider batching if possible, or accept the N queries for V0

## File Map

| File                                                                | Action | What                                       |
| ------------------------------------------------------------------- | ------ | ------------------------------------------ |
| `packages/ledger-core/src/store.ts`                                 | Modify | Add 3 methods to `ActivityLedgerStore`     |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts`         | Modify | Import `userBindings`, implement 3 methods |
| `services/scheduler-worker/src/activities/ledger.ts`                | Modify | Add `curateAndResolve` + types             |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | Modify | Add step 5, add to proxyActivities         |
| `services/scheduler-worker/tests/ledger-activities.test.ts`         | Modify | Add 5+ tests                               |

## Validation

```bash
pnpm check                   # types + lint + dep-cruiser
pnpm packages:build          # rebuild packages
pnpm test -- services/scheduler-worker/tests/ledger-activities
```

## Pointers

- **Work item (full design)**: `work/items/task.0101.identity-resolution-curation.md`
- **Spec (curation rules)**: `docs/spec/epoch-ledger.md` — see CURATION_AUTO_POPULATE invariant + CollectEpochWorkflow step 6
- Project: `work/projects/proj.transparent-credit-payouts.md`
- Identity spec: `docs/spec/decentralized-identity.md`
- Next task: `task.0102` (allocation computation + epoch close + finalize)
- Existing tests: `services/scheduler-worker/tests/ledger-activities.test.ts`
