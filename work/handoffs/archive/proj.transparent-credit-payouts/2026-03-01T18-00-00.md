---
id: proj.transparent-credit-payouts
type: handoff
work_item_id: proj.transparent-credit-payouts
status: active
created: 2026-02-21
updated: 2026-02-21
branch: feat/ledger-v0
last_commit: "cd9fdcbb"
---

# Handoff: Weekly Activity Pipeline for Credit Payouts

## Context

- CogniDAO needs transparent credit payouts replacing SourceCred's opaque algorithmic scoring
- The system is an **activity-to-payout pipeline**: source adapters collect contribution activity (GitHub PRs/reviews, Discord messages) every week, propose credit allocations via weight policy, and an admin finalizes the distribution
- **P0 was revised on 2026-02-21** from per-receipt wallet signing to automated activity ingestion — the receipt-signing model is deferred to P1
- Core payout math (BIGINT, largest-remainder rounding) is already implemented and reusable
- Schema foundation (task.0093) is done; 5 tasks remain for port/adapters/workflows/routes

## Current State

- **Spec revised**: [epoch-ledger.md](../../docs/spec/epoch-ledger.md) — 18 invariants, activity-ingestion model, 2 workflows, 9 routes
- **Project revised**: [proj.transparent-credit-payouts.md](../projects/proj.transparent-credit-payouts.md) — P0 = activity pipeline, P1 = wallet signing + UI
- **task.0093 (Done)**: Foundation schema (epochs, pool_components, payout_statements) + `computeStatementItems()` in `packages/ledger-core/` + 31 unit tests. Needs PR to staging.
- **task.0089 (Not Started)**: Identity bindings (`user_bindings` table) — **dependency** for activity attribution
- **task.0094 (Not Started)**: `ActivityLedgerStore` port + Drizzle adapter + schema migration for new tables (`activity_events`, `epoch_allocations`, `source_cursors`) + epochs modifications
- **task.0097 (Not Started)**: GitHub + Discord source adapters using `@octokit/graphql` and `discord.js`
- **task.0095 (Not Started)**: 2 Temporal workflows (CollectEpochWorkflow + FinalizeEpochWorkflow) + weekly cron
- **task.0096 (Not Started)**: Zod contracts + 9 API routes + stack tests
- **Old receipt-signing tables** (`work_receipts`, `receipt_events`, `ledger_issuers`) exist in DB but are superseded — not deleted (append-only principle), reactivated in P1

## Decisions Made

- **Activity ingestion over receipt signing** — automated collection replaces manual per-PR wallet-signed receipts ([spec revision commit cd9fdcbb](../../docs/spec/epoch-ledger.md))
- **Integer milli-unit weights** — `8000` not `8.0`, enforces ALL_MATH_BIGINT ([spec: Weight Policy](../../docs/spec/epoch-ledger.md#weight-policy))
- **Cursor state from day 1** — `source_cursors` table for incremental sync, avoids full-window rescans ([spec: CURSOR_STATE_PERSISTED](../../docs/spec/epoch-ledger.md#core-invariants))
- **3-field identity split** — `source` + `platform_user_id` (numeric) + `platform_login` (display name), not a single overloaded field
- **Epoch window uniqueness** — `UNIQUE(period_start, period_end)` prevents re-collect conflicts
- **Adapters out of ledger-core** — pure domain in `packages/ledger-core/`, adapters in `services/scheduler-worker/`
- **Verification = recompute from stored data** — not re-fetch from GitHub/Discord (may be private)
- **All writes via Temporal** — Next.js returns 202, scheduler-worker executes

## Next Actions

- [ ] Create PR for task.0093 to `staging` (schema + domain logic already done, needs merge)
- [ ] Implement task.0089 — `user_bindings` + `identity_events` tables (blocks adapter identity resolution)
- [ ] Implement task.0094 — `ActivityLedgerStore` port + adapter + schema migration (new tables + epochs mods)
- [ ] Implement task.0097 — GitHub + Discord source adapters (blocked by task.0089 + task.0094)
- [ ] Implement task.0095 — 2 Temporal workflows + weekly Schedule (blocked by task.0094 + task.0097)
- [ ] Implement task.0096 — Zod contracts + API routes + stack tests (blocked by task.0095)

## Risks / Gotchas

- **task.0089 is a cross-project dependency** — identity bindings live in `proj.decentralized-identity`, not this project, but adapters can't resolve `platform_user_id` → `user_id` without it
- **Old receipt-signing schema coexists** — `work_receipts`, `receipt_events`, `ledger_issuers` tables remain in migrations. New migration must add tables alongside, not drop existing ones
- **`packages/ledger-core` must be built** before tests — `pnpm packages:build` after source changes
- **Discord rate limits** — paginated (100 msgs/call), cursor-based sync essential; `discord.js` bot token already configured via OpenClaw
- **`signing.ts` still in ledger-core** — exported but not used in P0 workflows. Don't delete; P1 reactivates it

## Pointers

| File / Resource                                    | Why it matters                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/spec/epoch-ledger.md`                        | Authoritative spec — 18 invariants, schema, API, workflows              |
| `docs/research/epoch-event-ingestion-pipeline.md`  | Research: SourceCred patterns, OSS tooling choices, adapter design      |
| `work/projects/proj.transparent-credit-payouts.md` | Roadmap, P0/P1/P2 phases, definition of done                            |
| `packages/ledger-core/src/rules.ts`                | `computeStatementItems()` — reused unchanged for payout math            |
| `packages/ledger-core/src/model.ts`                | `ApprovedReceipt`, `StatementLineItem` types                            |
| `packages/db-schema/src/ledger.ts`                 | Existing Drizzle tables (epochs, pool, statements + old receipt tables) |
| `work/items/task.0089.user-identity-bindings.md`   | Cross-project dependency for identity resolution                        |
| `work/items/task.0094.ledger-port-adapter.md`      | Next implementation task — port + adapter + migration                   |
| `work/items/task.0097.ledger-source-adapters.md`   | GitHub + Discord adapter task                                           |
| `tests/unit/core/ledger/`                          | 31 existing tests — rules.test.ts + signing.test.ts                     |
