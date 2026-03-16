---
id: task.0094.handoff
type: handoff
work_item_id: task.0094
status: active
created: 2026-02-21
updated: 2026-02-21
branch: feat/user-identity-bindings
last_commit: 9906517c
---

# Handoff: Ledger Port + Drizzle Adapter + Schema Migration

## Context

- Part of [proj.transparent-credit-payouts](../projects/proj.transparent-credit-payouts.md) — building the epoch-based activity-to-payout pipeline
- Implements a three-layer immutability model: raw activity (immutable always) → curation (mutable until epoch close) → ledger statement (immutable once signed)
- Replaces the old receipt-signing model (ledgerIssuers, workReceipts, receiptEvents) with activity-ingestion model
- All tables scoped by `node_id UUID` per [node-operator-contract spec](../../docs/spec/node-operator-contract.md)
- Blocked by task.0093 (identity bindings); builds on that foundation for identity resolution

## Current State

- **Done:** Port interface (`ActivityLedgerStore`), Drizzle schema (8 tables), adapter (`DrizzleAttributionAdapter`), migrations (0010 DDL + 0011 triggers), container wiring, node_id in repo-spec (`getNodeId()` from `@/shared/config`), spec update, all re-exports, AGENTS.md updates
- **Done:** All 1028 unit tests pass, typecheck passes, arch:check passes, packages build + validate
- **Not done:** Drizzle snapshot files (`meta/0010_snapshot.json`, `meta/0011_snapshot.json`) — `pnpm db:generate` requires interactive prompts to resolve table renames vs creates. Must be run manually.
- **Not done:** Contract test (`tests/contract/ledger-store.contract.ts`) — deferred to next dev
- **Not done:** Migrations have not been applied to any database yet

## Decisions Made

- No `user_id` on `activity_events` — identity resolution lands in `activity_curation.user_id` (Layer 2). See [epoch-ledger spec](../../docs/spec/attribution-ledger.md)
- No `epoch_id` on `activity_events` — raw log is epoch-agnostic; epoch membership assigned in `activity_curation`
- Single `DrizzleAttributionAdapter` in `@cogni/db-client` shared by app + worker (no duplication)
- Old migrations 0010/0011 deleted (never shipped) and replaced
- `ApprovedReceipt` renamed to `FinalizedAllocation` throughout
- `signing.ts` replaced by `hashing.ts` (`computeAllocationSetHash`)
- `statement_signatures` table is schema-only — signing UX/API is a follow-up

## Next Actions

- [ ] Run `pnpm db:generate` interactively — select "create table" for each new table prompt, generating snapshot files
- [ ] Write contract test at `tests/contract/ledger-store.contract.ts` covering all `ActivityLedgerStore` methods
- [ ] Apply migrations to test DB: `pnpm dev:stack:test:setup` then verify triggers work
- [x] ~~Add `.env.example` entry for `NODE_ID`~~ — node_id now sourced from `.cogni/repo-spec.yaml` via `getNodeId()`, not env var
- [ ] Verify `pnpm check:docs` passes (currently blocked by unrelated worktree biome config issue)

## Risks / Gotchas

- **Drizzle snapshots missing**: Without `meta/0010_snapshot.json` and `meta/0011_snapshot.json`, future `pnpm db:generate` runs won't diff correctly against the current schema. Must run interactively first.
- **node_id sourced from repo-spec**: `getNodeId()` from `@/shared/config` reads `.cogni/repo-spec.yaml` — no env var needed. Fails fast if repo-spec is missing or node_id is invalid UUID.
- **`activity_curation` freeze trigger**: The `curation_freeze_on_close()` function queries `epochs.status` on every INSERT/UPDATE/DELETE to `activity_curation`. Acceptable at current scale but may need review for bulk operations.
- **`pnpm lint` blocked by stale worktree**: `.claude/worktrees/ingestion-core-github-adapter/biome.json` causes biome to error. Not related to this task — another dev's active worktree.

## Pointers

| File / Resource                                                    | Why it matters                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `docs/spec/attribution-ledger.md`                                  | Canonical spec — schema tables, invariants, lifecycle |
| `packages/attribution-ledger/src/store.ts`                         | Port interface (`ActivityLedgerStore`) + all types    |
| `packages/attribution-ledger/src/hashing.ts`                       | `computeAllocationSetHash()`                          |
| `packages/db-schema/src/ledger.ts`                                 | Drizzle schema — all 8 tables                         |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`   | Adapter implementation                                |
| `src/bootstrap/container.ts`                                       | Container wiring (`activityLedgerStore`)              |
| `src/shared/config/repoSpec.server.ts`                             | `getNodeId()` — node identity from repo-spec          |
| `src/adapters/server/db/migrations/0010_ledger_activity_model.sql` | DDL migration                                         |
| `src/adapters/server/db/migrations/0011_ledger_triggers.sql`       | Trigger migration (append-only + freeze-on-close)     |
| `work/items/task.0094.ledger-port-adapter.md`                      | Work item with full implementation checklist          |
