---
id: handoff.task.0093
type: handoff
work_item_id: task.0093
status: active
created: 2026-02-21
updated: 2026-02-21
branch: feat/ledger-v0
last_commit: "66644058"
---

# Handoff: Ledger DB Schema + Core Domain

## Context

- **Project:** [proj.transparent-credit-payouts](../projects/proj.transparent-credit-payouts.md) — epoch-based auditable decision ledger for credit payouts
- **Work item:** [task.0093](../items/task.0093.ledger-schema-domain.md) — 6 Drizzle tables + pure domain logic (model, rules, signing, errors)
- **Spec:** [attribution-ledger.md](../../docs/spec/attribution-ledger.md) — 20 invariants, 6 tables, API contracts, Temporal workflow IDs
- **Why:** Foundation layer for the ledger. Schema + domain logic must exist before ports/adapters (task.0094), Temporal workflows (task.0095), or routes (task.0096)

## Current State

- **Schema (Done):** 6 Drizzle tables in `packages/db-schema/src/ledger.ts` — `ledger_issuers`, `epochs`, `work_receipts`, `receipt_events`, `epoch_pool_components`, `payout_statements`
- **Domain logic (Done):** `packages/attribution-ledger/` — model types, `computeStatementItems()` (BIGINT largest-remainder), `buildReceiptMessage()` (domain-bound SHA-256), 5 error classes with type guards
- **Re-export barrel (Done):** `src/core/attribution/public.ts` re-exports from `@cogni/attribution-ledger` — app code uses `@/core/ledger`
- **Tests (Done):** 31 passing — payout math edge cases, signing determinism, input guards (negative units, newline injection)
- **Migrations (Uncommitted):** Another dev regenerated migrations — old 0010+0011 collapsed into clean `0010_redundant_misty_knight.sql` (DDL) + `0011_ledger_append_only_triggers.sql` (idempotent triggers). These are unstaged and need to be committed before PR.
- **PR:** Not yet created. Branch is `feat/ledger-v0`, target is `staging`.
- **Design review:** Passed (revision 1). Implementation review: Approved.

## Decisions Made

- **Package boundary:** Domain logic in `packages/attribution-ledger/` (not `src/core/attribution/`) — `scheduler-worker` cannot import from `src/`. Design review [9c414ad9].
- **ADDRESS_NORMALIZED not CHECKSUMMED:** Addresses stored lowercase hex. EIP-55 checksum is UX-layer only. [8de671d9]
- **LATEST_EVENT_WINS:** No state machine for receipt events. Most recent event by `created_at` determines state. Any transition valid.
- **POOL_UNIQUE_PER_TYPE:** `UNIQUE(epoch_id, component_id)` — change amount by recording a new component_id, not updating.
- **Append-only triggers:** DB-level `BEFORE UPDATE OR DELETE` triggers on 3 tables. Separated into own migration for idempotency.
- **Share computation:** `wholePart.fracPart` with 10^6 scale — handles 100% correctly (`"1.000000"`).

## Next Actions

- [ ] Commit the unstaged migration changes (from the other dev)
- [ ] Create PR to `staging` — use `feat(ledger): epoch ledger schema, domain logic, and project foundation`
- [ ] Set `pr:` field in task.0093 frontmatter after PR creation
- [ ] After merge: begin task.0094 (ledger port + Drizzle adapter + container wiring)

## Risks / Gotchas

- **Migration has custom SQL triggers** — `0011_ledger_append_only_triggers.sql` is hand-written (Drizzle can't express triggers). Future `drizzle-kit generate` will not touch it, but be aware it exists outside drizzle's tracking.
- **`packages/ledger-core` must be built** before tests run — tests import from `@cogni/attribution-ledger` which resolves to `dist/`. Run `pnpm packages:build` or `pnpm --filter @cogni/attribution-ledger build` after source changes.
- **Branch contains project-level planning changes** beyond task.0093 (spec, guide, task.0094–0096, project updates, identity reframe). All coherent with `proj.transparent-credit-payouts` but the PR is broader than just task.0093.
- **`rules.ts:87`** — `index` field in allocation struct is unused (dead field, non-blocking).

## Pointers

| File / Resource                                    | Why it matters                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| `docs/spec/attribution-ledger.md`                  | Authoritative spec — 20 invariants, schema, API contracts |
| `packages/attribution-ledger/src/`                 | Pure domain: model.ts, rules.ts, signing.ts, errors.ts    |
| `packages/db-schema/src/ledger.ts`                 | 6 Drizzle table definitions                               |
| `src/core/attribution/public.ts`                   | Re-export barrel — app imports from here                  |
| `src/adapters/server/db/migrations/0010_*.sql`     | DDL migration (tables, FKs, indexes, CHECK constraints)   |
| `src/adapters/server/db/migrations/0011_*.sql`     | Custom trigger migration (append-only enforcement)        |
| `tests/unit/core/ledger/`                          | 31 tests — rules.test.ts + signing.test.ts                |
| `work/items/task.0093.ledger-schema-domain.md`     | Work item with plan checklist + review feedback           |
| `work/projects/proj.transparent-credit-payouts.md` | Project roadmap — task.0093 is first of 4 deliverables    |
