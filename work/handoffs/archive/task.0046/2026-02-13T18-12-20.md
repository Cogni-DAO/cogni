---
id: task.0046.handoff
type: handoff
work_item_id: task.0046
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/system-tenant-bootstrap
last_commit: 923a7c18
---

# Handoff: System Tenant Bootstrap + Purchase-Time Revenue Share

## Context

- Cogni needs a `cogni_system` billing account so governance AI loops can execute under a first-class tenant with proper billing attribution
- When users buy credits (USDC → DAO wallet), the system tenant should automatically receive bonus credits (75% of the user's purchased amount) to fund governance operations
- The user's credit allocation is **unchanged** — they get 100% of what they paid for; the system tenant bonus is additional minting backed by the 2× markup at consumption time
- This is the P0 foundation for [proj.system-tenant-governance](../projects/proj.system-tenant-governance.md) — everything else (PolicyResolverPort, tool policy, governance heartbeat) builds on this

## Current State

- **Planning complete:** Research doc, task definition, project roadmap update, and index entry are committed on branch `feat/system-tenant-bootstrap`
- **No implementation yet:** Zero code changes — all deliverables are still pending
- Branch is based on `staging` at commit `9e7d7406` (post AI SDK streaming merge)
- Worktree at `/Users/derek/dev/cogni-task0046` has deps installed and `pnpm check:docs` passes

## Decisions Made

- **Revenue share model:** Purchase-time bonus credits, not consumption-time split — see [research doc §Area 3](../../docs/research/system-tenant-seeding-heartbeat-funding.md)
- **User gets 100%:** No change to existing `confirmCreditsPayment()` user credit amount
- **No DAO reserve account:** DAO already holds the money (sent to DAO wallet). The 25% not minted is implicit margin
- **Partial unique index:** Exactly one system tenant enforced at DB level — reviewer requirement
- **Idempotency:** Both user and system tenant credits keyed by `clientPaymentId` with different `reason` values
- **System tenant consumes at standard markup:** Whether to exempt from 2× markup is deferred (separate policy decision)

## Next Actions

- [ ] Add `isSystemTenant` column to Drizzle schema in `packages/db-schema/src/refs.ts`
- [ ] Write migration `0007_system_tenant.sql` — column + unique index + seed user + seed billing account
- [ ] Add `SYSTEM_TENANT_ID` / `SYSTEM_TENANT_PRINCIPAL_ID` constants in `src/shared/constants/`
- [ ] Create `src/bootstrap/healthchecks.ts` — fail fast if `cogni_system` missing, wire into startup
- [ ] Add `calculateRevenueShareBonus()` pure function to `src/core/billing/pricing.ts`
- [ ] Add `SYSTEM_TENANT_REVENUE_SHARE` env var to `src/shared/env/server.ts` (default 0.75)
- [ ] Update `confirmCreditsPayment()` — add atomic system tenant bonus credit after user credit
- [ ] Write unit tests: bonus math, confirm service with two credits, idempotency on retry
- [ ] Write stack test: E2E purchase creates two ledger entries, retry is idempotent

## Risks / Gotchas

- `confirmCreditsPayment()` currently uses `accountService` (user-scoped, RLS). The system tenant credit needs `serviceAccountService` (BYPASSRLS) — the function signature will need a second service injected
- `credit_ledger` has a unique constraint on `(reference) WHERE reason='widget_payment'`. The system tenant credit uses `reason='platform_revenue_share'` with the same reference — verify the unique constraint doesn't collide (it shouldn't — different `reason` values are different partial indexes)
- The `cogni_system_principal` user has `wallet_address=NULL`. If any code assumes all users have wallets, it will break — check auth and UI paths
- RLS on `billing_accounts` scopes by `owner_user_id` — all system tenant queries must go through `ServiceDrizzleAccountService` (BYPASSRLS), never the user-scoped adapter

## Pointers

| File / Resource                                                                | Why it matters                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [task.0046](../items/task.0046.system-tenant-bootstrap-revenue-split.md)       | Full requirements, plan, validation commands                                       |
| [Research doc](../../docs/research/system-tenant-seeding-heartbeat-funding.md) | Economics model, options considered, reviewer feedback incorporated                |
| [system-tenant spec](../../docs/spec/system-tenant.md)                         | Governing invariants (SYSTEM_TENANT_STARTUP_CHECK, IS_SYSTEM_TENANT_METADATA_ONLY) |
| [billing-evolution spec](../../docs/spec/billing-evolution.md)                 | Credit unit standard, idempotency constraints, charge receipt schema               |
| `packages/db-schema/src/refs.ts`                                               | `billingAccounts` table definition — add column here                               |
| `src/core/billing/pricing.ts`                                                  | Pure billing math — add `calculateRevenueShareBonus()` here                        |
| `src/features/payments/services/creditsConfirm.ts`                             | Payment confirmation service — wire revenue share here                             |
| `src/adapters/server/accounts/drizzle.adapter.ts`                              | User vs Service account adapters — understand RLS boundary                         |
| `src/shared/env/server.ts`                                                     | Zod-validated env — add `SYSTEM_TENANT_REVENUE_SHARE` here                         |
| `tests/_fixtures/stack/seed.ts`                                                | Test seed utilities — reference pattern for idempotent seeding                     |
