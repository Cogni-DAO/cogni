---
id: task.0106.handoff
type: handoff
work_item_id: task.0106
status: active
created: 2026-02-24
updated: 2026-02-24
branch: feat/ledger-ui
last_commit: e4b9d37d
---

# Handoff: Dev Seed Script + Missing Ledger API Routes

## Context

- The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) was wired to real ledger API endpoints in `c012921e` — hooks multi-fetch epochs, allocations, activity, and statements, then compose view models client-side
- An empty dev database rendered blank pages — `pnpm db:seed` now populates realistic data for visual dev workflows
- Two GET API routes were missing (`allocations`, `statement`) that the hooks depend on — these returned 405 and blocked rendering
- Seed data is modeled after real GitHub activity from `Cogni-DAO/node-template` with 2 real contributors: `derekg1729` (human) and `Cogni-1729` (AI agent)
- The seed script coexists safely with Temporal's `LEDGER_INGEST` schedule — `ensureEpochForWindow()` reuses seeded epochs by window match

## Current State

- **Done:** `scripts/db/seed.mts` seeds 2 finalized epochs + 1 open epoch with activity, curations, allocations, pool components, and payout statements
- **Done:** `pnpm db:seed` command works via `node --import tsx/esm` (ESM loader required for `@cogni/*` subpath exports)
- **Done:** `GET /api/v1/ledger/epochs/:id/allocations` route added (was PATCH-only, returning 405)
- **Done:** `GET /api/v1/ledger/epochs/:id/statement` route created (didn't exist at all)
- **Done:** All 3 governance UI pages render against seeded data
- **MVP quality:** UI is functional but needs polish — placeholder avatars, no profile system, basic layout
- **Not done:** `pnpm check` not run after latest commit; doc headers on new route files may need validation
- **Not done:** task.0106 work item status still `needs_implement` — should be updated

## Decisions Made

- Seed script uses `node --import tsx/esm` (not bare `tsx`) because root `package.json` lacks `"type": "module"` and tsx's CJS hook can't resolve ESM-only subpath exports from `@cogni/db-client`
- File extension is `.mts` to explicitly signal ESM to Node — avoids `ERR_REQUIRE_CYCLE_MODULE` that occurs with `.ts` + `--import tsx/esm`
- Seed creates user rows in `users` table (FK target for `activity_curation.user_id`) with deterministic UUIDs derived from GitHub databaseIds
- `dotenv -e .env.local --` used for env loading (matches `db:migrate:dev` pattern), not manual `dotenv.config()` in script
- No Temporal interaction needed — `ensureEpochForWindow()` in the scheduler worker reuses existing epochs by window match

## Next Actions

- [ ] Run `pnpm check` and fix any lint/header issues on new files
- [ ] Update task.0106 status from `needs_implement` to `done` (or `needs_review`)
- [ ] Add idempotency: seed script currently aborts if open epoch exists — consider a `--force` flag that cleans and re-seeds
- [ ] Add user profile system (avatar, display name, color) — currently hardcoded placeholders
- [ ] Consider adding a `db:seed:reset` script to truncate ledger tables (append-only triggers block DELETE on `activity_events`)
- [ ] Verify `GIT_READ_TOKEN` in `.env.local` — was returning 401 (expired) during development

## Risks / Gotchas

- `activity_events` table has an append-only trigger (`ledger_reject_mutation`) that blocks DELETE — to re-seed, you must drop/recreate the DB (`pnpm db:drop:test` pattern) or disable the trigger
- `ONE_OPEN_EPOCH` invariant: DB unique constraint on `(node_id, scope_id, status='open')` — seed script checks for existing open epoch and aborts if found
- `activity_curation.user_id` FK references `users.id` — seed must insert user rows before curations
- `@cogni/*` packages are ESM-only (`format: ["esm"]` in tsup) — scripts that import them need ESM loader, not bare `tsx`
- Seeded epoch windows are relative to `Date.now()` via `daysAgo()` — re-running seed on different days creates different windows

## Pointers

| File / Resource                                             | Why it matters                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `scripts/db/seed.mts`                                       | The seed script — all epoch/event/allocation data definitions     |
| `scripts/_seed-reference-data.json`                         | Real GitHub data from Cogni-DAO/node-template used to model seed  |
| `src/app/api/v1/ledger/epochs/[id]/allocations/route.ts`    | GET + PATCH handlers for epoch allocations                        |
| `src/app/api/v1/ledger/epochs/[id]/statement/route.ts`      | GET handler for epoch payout statements                           |
| `src/features/governance/hooks/useCurrentEpoch.ts`          | Hook showing exact API endpoints the UI fetches                   |
| `src/features/governance/lib/compose-epoch.ts`              | Composition functions joining API data into view models           |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | `DrizzleAttributionAdapter` — the store used by seed + routes     |
| `services/scheduler-worker/src/activities/ledger.ts`        | `ensureEpochForWindow()` — how Temporal coexists with seeded data |
| `work/items/task.0106.ledger-dev-seed.md`                   | Full requirements and data shape reference                        |
