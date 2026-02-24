---
id: task.0106.handoff
type: handoff
work_item_id: task.0106
status: active
created: 2026-02-24
updated: 2026-02-24
branch: feat/ledger-ui
last_commit: c012921e
---

# Handoff: Dev Seed Script for Governance Epoch UI

## Context

- The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) was wired to fetch from the real ledger API in commit `c012921e` on branch `feat/ledger-ui`
- Hooks now multi-fetch from `/api/v1/ledger/epochs`, `/allocations`, `/activity`, `/statement` endpoints and compose view models client-side
- An empty dev database renders blank pages — a seed script is needed to populate realistic data for visual dev workflows
- Real contribution data was sampled from `Cogni-DAO/node-template` via GitHub GraphQL API and saved as reference
- Two real contributors exist: `derekg1729` (human, databaseId 58641509) and `Cogni-1729` (AI agent, databaseId 207977700)

## Current State

- **Done:** API wiring complete, `USE_MOCK=false` in all 3 hooks, `pnpm check` passes clean
- **Done:** View model types (`types.ts`), composition functions (`lib/compose-epoch.ts`, `lib/compose-holdings.ts`) created
- **Done:** Old premature contracts (`governance.epoch.v1.contract.ts`, `governance.holdings.v1.contract.ts`) deleted
- **Done:** Work item `task.0106` created with full requirements and data shape reference
- **Done:** Reference data from real GitHub API saved to `scripts/_seed-reference-data.json`
- **Not done:** Seed script not yet written — task.0106 is `needs_implement`
- **Uncommitted:** Header fixes in hooks, task.0106 work item, project roadmap update, reference data file

## Decisions Made

- Hooks compose view models client-side from flat API responses (no BFF) — see plan in `c012921e` commit
- `p-limit@7` added for concurrency-capped fetch storms (3 concurrent)
- Epoch status expanded to `"open" | "review" | "finalized"` (was `"open" | "closed"`)
- Avatar/color are static placeholders (`👤`, neutral gray) — profiles deferred to separate work item
- `displayName` = `platformLogin` from activity events, fallback to truncated userId
- Finalized epoch data sourced from frozen payout statements, not mutable allocations

## Next Actions

- [ ] Commit uncommitted changes (header fixes, task.0106, reference data, project update)
- [ ] Write `scripts/dev-seed-ledger.ts` per task.0106 requirements
- [ ] Seed 1 open epoch + 2 finalized epochs with activity modeled after real `Cogni-DAO/node-template` data
- [ ] Use `ActivityLedgerStore` via `DrizzleLedgerAdapter(createServiceDbClient(DATABASE_SERVICE_URL), scopeId)`
- [ ] Add `"dev:seed:ledger"` script to `package.json`
- [ ] Verify all 3 UI pages render against seeded data with `pnpm dev`
- [ ] Update `GIT_READ_TOKEN` in `.env.local` — current token returns 401 (expired)

## Risks / Gotchas

- `ONE_OPEN_EPOCH` invariant: DB has unique constraint on `(node_id, scope_id, status)` where `status='open'` — seed script must not create a second open epoch
- `nodeId`/`scopeId` come from `repo-spec.yaml` via `getNodeId()`/`getScopeId()` — seed script must use these, not test constants
- Epoch transitions require specific ordering: `createEpoch` → `closeIngestion` → `finalizeEpoch` — see `seedClosedEpoch()` in fixtures
- Activity events require `payloadHash` (SHA-256) and `producer`/`producerVersion` fields — use `"dev-seed"` / `"0.0.0-seed"`
- Curation rows must link `eventId` to `epochId` with resolved `userId` for the composition functions to work

## Pointers

| File / Resource                                             | Why it matters                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `work/items/task.0106.ledger-dev-seed.md`                   | Full requirements, data shapes, validation steps                             |
| `scripts/_seed-reference-data.json`                         | Real GitHub data from Cogni-DAO/node-template + store API reference          |
| `tests/_fixtures/ledger/seed-ledger.ts`                     | Reusable factories: `makeActivityEvent`, `makeAllocation`, `seedClosedEpoch` |
| `src/features/governance/types.ts`                          | View model types the UI expects                                              |
| `src/features/governance/lib/compose-epoch.ts`              | Composition functions that join API data → view models                       |
| `src/features/governance/hooks/useCurrentEpoch.ts`          | Hook showing exact API endpoints fetched                                     |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | `DrizzleLedgerAdapter` — the store implementation                            |
| `packages/db-schema/src/ledger.ts`                          | All ledger table definitions and constraints                                 |
| `work/projects/proj.transparent-credit-payouts.md`          | Parent project roadmap                                                       |
