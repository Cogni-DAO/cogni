---
id: task.0046.handoff
type: handoff
work_item_id: task.0046
status: active
created: 2026-02-14
updated: 2026-02-14
branch: feat/system-tenant-bootstrap
last_commit: 111fa584
---

# Handoff: System Tenant Bootstrap — Migration Fix + Test Updates

## Context

- task.0046 adds `cogni_system` billing account (system tenant) + purchase-time revenue share (25% bonus credits minted to system tenant on every payment)
- Migration `0008_seed_system_tenant.sql` seeds the system tenant rows into RLS-protected tables
- Migration failed because `app_user` has `FORCE ROW LEVEL SECURITY` — fixed by adding `set_config('app.current_user_id')` before inserts
- `drizzle.config.ts` had been changed to prefer `DATABASE_SERVICE_URL` (BYPASSRLS) but `app_service` lacks DDL rights (can't CREATE SCHEMA) — reverted to use `DATABASE_URL` (app_user, DB owner)
- Stack test `reset-db.ts` truncates all tables before each run, wiping seed data — fixed by re-seeding system tenant after truncation

## Current State

- Migration fix committed (`e37c8d69`) — `set_config` + drizzle.config.ts revert
- `reset-db.ts` updated to re-seed system tenant after truncation — **NOT YET COMMITTED**
- Payment stack tests updated to scope ledger queries by `billingAccountId` (avoiding collision with system tenant revenue share entries) — **NOT YET COMMITTED**
- `readyz` and `credits-confirm` tests pass after reset-db fix
- Payment `numeric-flow` and `mvp-scenarios` tests have edits ready but **not yet validated** (run `pnpm test:stack:dev`)
- `siwe-session` timeout and `scheduler-worker-execution` timeout are **pre-existing flaky tests**, unrelated

## Decisions Made

- Option A chosen: run migrations as `app_user` (DB owner) with `set_config()` for RLS context, NOT as `app_service`
- Revenue share is BONUS credits (minted to system tenant), NOT deducted from user — user gets full amount
- P2 task.0055 created for dedicated `app_migrator` role (proper DDL/DML separation)

## Next Actions

- [ ] Run `pnpm test:stack:dev` to validate payment test fixes
- [ ] If tests pass, stage and commit: `tests/stack/setup/reset-db.ts`, `tests/stack/payments/numeric-flow.stack.test.ts`, `tests/stack/payments/mvp-scenarios.stack.test.ts`
- [ ] Run `pnpm check` to validate lint/types
- [ ] Consider adding a stack test that asserts system tenant receives revenue share bonus after payment
- [ ] Create PR against `staging` via `/pull-request`

## Risks / Gotchas

- `reset-db.ts` uses `DATABASE_URL` (app_user, RLS enforced) — the re-seed SQL must be wrapped in `sql.begin()` so `set_config` persists across inserts
- `seedDb` in stack tests is `app_service` (BYPASSRLS) — `findFirst` on `creditLedger` by `reference` alone returns EITHER user OR system tenant entry non-deterministically. Always filter by `billingAccountId`
- `set_config(..., true)` = transaction-local only. Without explicit `BEGIN`, each statement is its own autocommit transaction and the setting is lost

## Pointers

| File / Resource                                                 | Why it matters                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/adapters/server/db/migrations/0008_seed_system_tenant.sql` | Seed migration with `set_config` fix                                    |
| `drizzle.config.ts`                                             | Reverted to `DATABASE_URL` only (no service URL)                        |
| `tests/stack/setup/reset-db.ts`                                 | Re-seeds system tenant after truncation                                 |
| `tests/stack/payments/numeric-flow.stack.test.ts`               | Ledger queries scoped by `billingAccountId`                             |
| `tests/stack/payments/mvp-scenarios.stack.test.ts`              | Same — all 7 ledger queries updated                                     |
| `tests/stack/payments/credits-confirm.stack.test.ts`            | Already correct — reference pattern for the fix                         |
| `src/features/payments/services/creditsConfirm.ts`              | Revenue share logic — user credit (line 72) then system bonus (line 98) |
| `work/items/task.0055.dedicated-migrator-role.md`               | P2 follow-up for proper DDL/DML role separation                         |
