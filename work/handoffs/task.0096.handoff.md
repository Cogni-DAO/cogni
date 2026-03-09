---
id: task.0096.handoff
type: handoff
work_item_id: task.0096
status: active
created: 2026-02-23
updated: 2026-02-23
branch: feat/ledger-api-routes
last_commit: 2a08b4e8
---

# Handoff: Ledger Zod Contracts + API Routes

## Context

- The epoch ledger pipeline collects activity and stores it in the DB, but nothing exposes this data over HTTP yet
- The frontend (community-ledger React app) needs epoch data, allocations, and payout statements to render its 3 pages
- This task adds 6 Zod contracts, 7 route handlers (3 public + 2 auth reads + 2 approver-gated writes), and stack tests
- Public routes serve only closed/finalized epoch data; activity with PII fields requires SIWE auth
- Write routes (allocations, pool components) require SIWE + wallet in `ledger.approvers` allowlist from repo-spec

## Current State

- **Done:**
  - 6 Zod contracts defined and passing contract tests
  - 7 route handlers implemented with all review fixes applied (pagination null safety, BigInt parsing, closed-only checks)
  - Approver allowlist in repo-spec schema + yaml + `getLedgerApprovers()`
  - Approver guard utility for write routes
  - DTO mappers for BigInt/Date serialization
  - `contracts/AGENTS.md` surface updated
  - `pnpm check` passes clean
  - Test fixtures enhanced with `seedClosedEpoch()` composite seeder (unstaged)
- **Not done:**
  - Stack test file (`tests/stack/ledger/ledger-api.stack.test.ts`) — fixtures are ready, test not yet written
  - Closeout (commit remaining files, PR creation)
- **Review history:** Passed r3 review after fixing 3 blocking issues (see work item Review Feedback section)

## Decisions Made

- **Public vs auth split:** Raw activity (PII) is auth-only; closed allocations + statements are public — see [work item design](../items/task.0096.ledger-contracts-routes.md#approach)
- **No facades:** Routes are single store calls, no shared orchestration needed
- **In-memory pagination:** `listEpochs()` loads all, slices in route — acceptable for V0 data volumes
- **Activity hard cap removed:** Contract schema already limits to 200 via `PaginationQuerySchema`
- **Statement route returns 200 + null** (not 404) when no statement exists, but enforces closed-only check

## Next Actions

- [ ] Write `tests/stack/ledger/ledger-api.stack.test.ts` — seed closed epoch via `seedClosedEpoch()`, hit 3 public routes, validate contract shapes
- [ ] Stage + commit the enhanced `tests/_fixtures/ledger/seed-ledger.ts`
- [ ] Stage + commit the stack test
- [ ] Run `/closeout task.0096` (commit, PR)

## Risks / Gotchas

- Stack tests need `DATABASE_SERVICE_URL` + running stack — use `pnpm dev:stack:test` or `pnpm docker:test:stack`
- Routes use `getNodeId()` from repo-spec, so stack test data must be seeded with the **real** node_id from `.cogni/repo-spec.yaml` (`4ff8eac1-...`), not `TEST_NODE_ID` — pass `nodeId` override to `seedClosedEpoch()`
- The `seedClosedEpoch()` also needs a real `scopeId` matching the DB — use the value from repo-spec (`a28a8b1e-...`)
- Sequential allocation updates in the PATCH route have no transaction boundary — partial failure is possible (documented, not blocked)
- `handleRouteError` is duplicated in 2 write routes — extract if more write routes are added

## Pointers

| File / Resource                                        | Why it matters                                      |
| ------------------------------------------------------ | --------------------------------------------------- |
| `work/items/task.0096.ledger-contracts-routes.md`      | Full design, invariants, review feedback            |
| `src/contracts/ledger.*.v1.contract.ts` (6 files)      | Zod schemas — single source of truth for all shapes |
| `src/app/api/v1/public/attribution/`                   | 3 public read routes (closed-only)                  |
| `src/app/api/v1/attribution/`                          | 2 auth reads + 2 approver-gated writes              |
| `src/app/api/v1/public/attribution/_lib/ledger-dto.ts` | BigInt/Date → string DTO mappers                    |
| `src/app/api/v1/attribution/_lib/approver-guard.ts`    | Shared approver check for write routes              |
| `src/shared/config/repoSpec.server.ts`                 | `getLedgerApprovers()` with caching                 |
| `tests/_fixtures/ledger/seed-ledger.ts`                | Factories + `seedClosedEpoch()` composite seeder    |
| `tests/contract/app/ledger.*.test.ts` (3 files)        | Contract shape validation tests                     |
| `packages/attribution-ledger/src/store.ts`             | `ActivityLedgerStore` port interface                |
| `docs/spec/attribution-ledger.md`                      | Epoch ledger spec (referenced by `spec_refs`)       |
