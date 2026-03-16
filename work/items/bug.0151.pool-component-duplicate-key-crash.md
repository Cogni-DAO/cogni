---
id: bug.0151
type: bug
title: "ensurePoolComponents crashes on duplicate key — Drizzle wraps PostgresError, catch block misses it"
status: needs_merge
priority: 0
rank: 5
estimate: 1
summary: "CollectEpochWorkflow crashes in ensurePoolComponents when inserting base_issuance for an epoch that already has it. The catch block checks err.message for 'duplicate key' but Drizzle wraps the PostgresError — the DrizzleQueryError message is 'Failed query: ...' and the duplicate key text is only in err.cause.message. Workflow retries in a loop and never processes collected events."
outcome: "Pool component insertion is idempotent at the DB layer via ON CONFLICT DO NOTHING, matching the established adapter pattern. CollectEpochWorkflow completes successfully on retry."
spec_refs: [attribution-ledger]
assignees: []
credit:
project:
project_id:
branch: fix/bug-0151-pool-component-idempotent
pr: https://github.com/Cogni-DAO/node-template/pull/546
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-11
labels: [attribution, preview, production-blocker]
external_refs:
---

# ensurePoolComponents crashes on duplicate key — Drizzle wraps PostgresError, catch block misses it

## Observed

On preview, `CollectEpochWorkflow` for epoch #12 crashes repeatedly at `ensurePoolComponents`:

```
DrizzleQueryError: Failed query: insert into "epoch_pool_components" ...
  cause: PostgresError: duplicate key value violates unique constraint "epoch_pool_components_epoch_component_unique"
  detail: Key (epoch_id, component_id)=(12, base_issuance) already exists.
```

The catch block in `ledger.ts:901-914` checks `err.message` for `"duplicate key"` or `"unique constraint"`, but:

- `DrizzleQueryError.message` = `"Failed query: insert into ..."` (no match)
- The constraint text is only in `err.cause.message`

The workflow retries 5+ times, same crash each time. **All 9 collected PR events and 1 review event are never attributed.**

Timeline (2026-03-10):

- `13:48:15` — PR review webhook (derekg1729 approval)
- `13:48:33-39` — PR merge webhooks (4x pull_request events)
- `13:49:17` — Ledger collects 9 PR events + 1 review
- `13:49:38+` — `ensurePoolComponents` crashes on duplicate key, retries in loop

## Expected

Pool component insertion should be idempotent. If `(epoch_id, component_id)` already exists, skip silently. The workflow should complete and attribute the collected events.

## Design

### Outcome

CollectEpochWorkflow no longer crashes on pool component re-insertion, unblocking event attribution for all collected activity.

### Approach

**Solution**: Change `insertPoolComponent` in the Drizzle adapter to use `.onConflictDoNothing()` + SELECT fallback, matching the established INSERT-ON-CONFLICT-DO-NOTHING pattern used 10+ times in the same adapter file. Remove the now-unnecessary catch block in `ensurePoolComponents`.

**Reuses**: Existing `onConflictDoNothing` pattern from the same adapter (ingestion receipts at line 953, selections at lines 608/697, statements at line 1416, etc.)

**Rejected**:

- _Fix the catch block to also check `err.cause.message`_: Works but treats the symptom. The error should never be thrown — idempotency belongs at the DB layer, not in string-matching error handlers.

### Invariants

- [x] POOL_UNIQUE_PER_TYPE: unique constraint on (epoch_id, component_id) preserved (spec: attribution-ledger)
- [x] POOL_LOCKED_AT_REVIEW: reject inserts after closeIngestion — existing epoch status check stays (spec: attribution-ledger)
- [x] POOL_IMMUTABLE: immutable trigger on epoch_pool_components stays — no UPDATE path added
- [x] SIMPLE_SOLUTION: 1 adapter method change, 1 activity cleanup
- [x] ARCHITECTURE_ALIGNMENT: matches established onConflictDoNothing pattern in same file (spec: architecture)

### Files

- Modify: `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — change `insertPoolComponent` to use `.onConflictDoNothing()` + SELECT fallback for existing row
- Modify: `services/scheduler-worker/src/activities/ledger.ts` — remove catch block for duplicate key (no longer needed), simplify `ensurePoolComponents`
- Test: `tests/component/db/drizzle-attribution.adapter.int.test.ts` — add test for idempotent re-insert
- Test: `services/scheduler-worker/tests/ledger-activities.test.ts` — verify ensurePoolComponents succeeds on repeat call

## Reproduction

1. Preview epoch dashboard shows stale data despite merged PR #544
2. Loki logs: `{app="cogni-template", env="preview", service="scheduler-worker"} |~ "duplicate key.*epoch_pool_components"`
3. Workflow retries visible as repeated "Ensuring pool components" → DrizzleQueryError cycles

## Impact

**P0** — Blocks all attribution processing for the current epoch. Every `CollectEpochWorkflow` invocation crashes before reaching the attribution phase. New activity (PR merges, reviews) is collected but never credited.

## Validation

```bash
pnpm test tests/component/db/drizzle-attribution.adapter.int.test.ts
pnpm test services/scheduler-worker/tests/ledger-activities.test.ts
```

**Expected:** Idempotent re-insert test passes; ensurePoolComponents succeeds on repeat call without errors.

## Attribution

- derekg1729 — reported and investigated
