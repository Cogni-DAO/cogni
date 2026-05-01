---
id: bug.0442
type: bug
title: "DoltgresOperatorWorkItemAdapter.list has no component test — broken SQL ships green"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "OBSERVED: PR #1158 changed the work_items list ORDER BY clause to use `NULLS LAST`. CI passed all required gates and merged. On deploy, every preview/prod /api/v1/work/items request returned 500 because Doltgres 0.56.2 doesn't support the `NULLS LAST` syntax. EXPECTED: A component test against testcontainer Doltgres should have caught the syntax error before merge. REPRO: `grep -rln 'doltgresWorkItems.*list\\|workItemsAdapter\\.list' nodes/operator/app/src/__tests__` returns nothing — there is zero test coverage for this code path. IMPACT: Any change to the list query ships untested. Took out preview + prod for ~5 hours."
outcome: "A component test exists at nodes/operator/app/src/adapters/server/db/doltgres/__tests__/work-items-adapter.list.component.test.ts that boots a testcontainer Doltgres, applies the work_items migration, inserts a few rows with mixed null/non-null priority and rank, and asserts the adapter's list() returns rows ordered correctly. Any future broken SQL syntax fails CI before merge."
spec_refs: [knowledge-data-plane-spec, work-items-port]
assignees: []
credit:
project: proj.agentic-project-management
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-05-01
updated: 2026-05-01
labels: [test-coverage, doltgres, work-items, p1]
external_refs:
---

# DoltgresOperatorWorkItemAdapter.list has no test

## Problem

`nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` has methods: `get`, `list`, `create`, `patch`, but **none have a real Doltgres test** (just type-only smoke). PR #1158 changed:

```diff
- ORDER BY created_at DESC
+ ORDER BY priority ASC NULLS LAST, rank ASC NULLS LAST, created_at DESC
```

CI passed all required gates because no test runs this query against actual Doltgres. Merged. Deployed. 500 errors immediately on preview + prod.

Loki trace from preview (after auto-deploy of #1158's merge):

```
PostgresError: at or near "last": syntax error: unimplemented: this syntax
code: XX000  route: work.items.list
```

PR #1162 fixed it (`NULLS LAST` → `COALESCE(col, 999) ASC`). But no test prevents the next person from writing a different unsupported clause.

## Approach

Add `nodes/operator/app/src/adapters/server/db/doltgres/__tests__/work-items-adapter.list.component.test.ts`:

1. Spin up Doltgres testcontainer (use existing helper if one exists in `@cogni/knowledge-store/testing`)
2. Apply the operator-doltgres-schema migration (work_items table)
3. Insert ~5 rows with mixed `priority: null | 0 | 1 | 2` and `rank: null | 1 | 2`
4. Call `adapter.list({})` 
5. Assert returned order: priority ASC nulls last, then rank ASC nulls last, then created_at DESC

Same pattern for `get`, `create`, `patch` while you're in there — adapter has 4 methods and 0 tests.

## Why this is P1 (not P0)

The immediate fix is in #1162. Recurrence prevention is medium urgency — the next person to touch this query is the agent who ships the bulk-import follow-up (task.5003). Add the test before that work lands.

## Validation

```bash
pnpm test:component nodes/operator/app/src/adapters/server/db/doltgres/
# new test passes against testcontainer Doltgres 0.56.2
# revert the COALESCE fix → test fails with PostgresError
```
