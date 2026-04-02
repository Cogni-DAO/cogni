---
id: task.0258
type: task
title: "Multi-node stack test infrastructure — per-node billing + data isolation tests"
status: needs_design
priority: 0
rank: 2
estimate: 3
summary: "Build stack test infra for dev:stack:full (3 nodes). Tests hit real running nodes via HTTP. Prove per-node billing routing, DB isolation, and auth isolation end-to-end."
outcome: "pnpm test:stack:multi runs 7 tests against live multi-node stack. Each test proves a multi-node-tenancy invariant. CI runs operator tests in check:full, multi-node tests separately."
spec_refs:
  - docs/spec/multi-node-tenancy.md
  - docs/spec/billing-ingest.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0257
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [testing, multi-node, stack-tests, billing]
external_refs:
---

## Context

task.0256 built per-node DB/auth/billing isolation. task.0257 fixes node identity
via repo-spec. But no stack tests prove the multi-node pipeline end-to-end.

Existing stack tests (`apps/operator/tests/stack/`) run against a single operator
instance. Multi-node tests need `dev:stack:full` (all 3 nodes + shared infra).

## Design

### Test location

`apps/operator/tests/stack/internal/multi-node-billing.stack.test.ts`

Operator is the test infrastructure host. Multi-node tests test the _system_,
not individual nodes.

### Test cases (7)

| #   | Test                                       | Invariant                             |
| --- | ------------------------------------------ | ------------------------------------- |
| 1   | Operator callback → receipt in operator DB | Baseline backward compat              |
| 2   | Poly callback → receipt in poly DB         | NODE_LOCAL_METERING_PRIMARY           |
| 3   | Resy callback → receipt in resy DB         | NODE_LOCAL_METERING_PRIMARY           |
| 4   | Missing node_id → defaults to operator     | MISSING_NODE_ID_DEFAULTS_OPERATOR     |
| 5   | Duplicate callback idempotent per node     | CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID |
| 6   | Poly receipt absent from resy DB           | DB_PER_NODE / NO_CROSS_NODE_QUERIES   |
| 7   | Invalid token rejected                     | CALLBACK_AUTHENTICATED                |

### Infrastructure changes

- `.env.test.example`: add `TEST_BASE_URL_POLY`, `TEST_BASE_URL_RESY`,
  per-node `DATABASE_URL_POLY_TEST`, `DATABASE_SERVICE_URL_POLY_TEST`, etc.
- `wait-for-probes.ts`: extend to poll `/readyz` on poly:3100, resy:3300
- `reset-db.ts`: reset all 3 node DBs (operator, poly, resy)
- Per-node seed client (connects to each node's test DB)
- Tests use `fetch()` against real running nodes — not route handler import

### Runner shorthands

```json
"test:stack:multi": "dotenv -e .env.test -- vitest run --config apps/operator/vitest.stack-multi.config.mts"
```

Separate vitest config for multi-node tests (different global setup — waits
for all 3 nodes, not just operator).

### CI integration

- `check:full`: operator stack tests (existing, single-node)
- Multi-node tests: separate CI job requiring `dev:stack:full` (expensive)
- Future: per-node test shorthands (`test:stack:poly`, `test:stack:resy`)

### Note for task.0248 (package extraction)

Expect massive test deduplication after platform extraction. Each node currently
has identical test fixtures (~200 files) copied from operator. After extraction,
test helpers live in the shared package, nodes only add node-specific test cases.

## Allowed Changes

- `apps/operator/tests/stack/internal/multi-node-billing.stack.test.ts` — CREATE
- `apps/operator/vitest.stack-multi.config.mts` — CREATE (multi-node setup)
- `apps/operator/tests/stack/setup/wait-for-probes-multi.ts` — CREATE
- `apps/operator/tests/_fixtures/stack/multi-node-seed.ts` — CREATE
- `.env.test.example` — add per-node test vars
- `package.json` — add `test:stack:multi` script

## Validation

- [ ] `pnpm test:stack:multi` runs 7 tests against `dev:stack:full`
- [ ] All 7 tests pass with live nodes on :3000, :3100, :3300
- [ ] Cross-node isolation proven: poly receipt absent from resy DB
- [ ] `pnpm check:fast` passes (no lint/type regressions)
