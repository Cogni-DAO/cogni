---
id: task.0046.handoff
type: handoff
work_item_id: task.0046
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/system-tenant-bootstrap
last_commit: e564d718
---

# Handoff: System Tenant Bootstrap + Purchase-Time Revenue Share

## Context

- Cogni needs a `cogni_system` billing account so governance AI loops execute under a first-class tenant with proper billing attribution
- On every credit purchase, the system tenant receives **bonus credits** (75% of the user's purchased amount) — the user's allocation is unchanged (100% of what they paid for)
- The bonus is backed economically by the 2× markup at consumption time ($100 of credits buys ~$50 of compute — the surplus funds the system tenant)
- This is the P0 foundation for [proj.system-tenant-governance](../projects/proj.system-tenant-governance.md) — PolicyResolverPort, tool policy, governance heartbeat all build on this

## Current State

**Committed (4 implementation commits on branch):**

1. **Schema + migration** (`2812a44d`): `is_system_tenant` boolean on `billing_accounts` + partial unique index + `credit_ledger_revenue_share_ref_unique` idempotency index + seed migration (user, billing account, virtual key)
2. **Constants + env** (`ae202923`): `SYSTEM_TENANT_ID`, `SYSTEM_TENANT_PRINCIPAL_ID`, `PLATFORM_REVENUE_SHARE_REASON` + `SYSTEM_TENANT_REVENUE_SHARE` env var (default 0.75)
3. **Port + adapter** (`43557417`): `ServiceAccountService` extended with `creditAccount()` and `findCreditLedgerEntryByReference()`, implemented in `ServiceDrizzleAccountService` (BYPASSRLS)
4. **Healthcheck** (`e564d718`): `verifySystemTenant()` in `src/bootstrap/healthchecks.ts`

**Uncommitted (in working tree, partially complete):**

- `src/core/billing/pricing.ts` — `calculateRevenueShareBonus()` pure function added (COMPLETE, uses scaled bigint math)
- `src/core/public.ts` — export added for above (COMPLETE)
- `src/app/(infra)/readyz/route.ts` — import of `verifySystemTenant` added but **NOT yet called** in the handler (INCOMPLETE — must add the call)

**Not started:**

- Update `confirmCreditsPayment()` to accept `serviceAccountService` param and mint system tenant bonus
- Update facade caller to pass `serviceAccountService` from container
- Unit tests for bonus math + creditsConfirm service (two credits, idempotency)
- `pnpm check` validation pass

## Decisions Made

- **Revenue share = bonus credits, not a split** — user gets 100% unchanged; system tenant gets additional 75%. See [research doc §Area 3](../../docs/research/system-tenant-seeding-heartbeat-funding.md)
- **No single transaction across RLS boundary** — user credit uses appDb (RLS), system tenant credit uses serviceDb (BYPASSRLS). Sequential with idempotency guards, not one transaction. If crash between the two: retry skips user credit (idempotent), applies system tenant credit
- **Scaled bigint math** — `calculateRevenueShareBonus` uses `REVENUE_SHARE_SCALE = 10_000n` to avoid float arithmetic on bigint credits, consistent with `usdCentsToCredits` pattern
- **No DAO reserve account** — DAO already holds the money. The 25% not minted is implicit margin
- **Partial unique index** for `platform_revenue_share` reason in `credit_ledger` for DB-level idempotency (defense-in-depth)

## Next Actions

- [ ] Commit the uncommitted pricing function + public export (ready as-is)
- [ ] Finish readyz wiring — call `verifySystemTenant(container.serviceAccountService)` in the handler after Temporal check
- [ ] Update `confirmCreditsPayment()` signature: add `serviceAccountService: ServiceAccountService` param
- [ ] After user credit, add idempotency check + bonus credit via `serviceAccountService.creditAccount()` with `reason: PLATFORM_REVENUE_SHARE_REASON`
- [ ] When `SYSTEM_TENANT_REVENUE_SHARE=0`, skip system tenant credit entirely
- [ ] Update `confirmCreditsPaymentFacade` to pass `getContainer().serviceAccountService`
- [ ] Update facade test mock to include `serviceAccountService` in the `confirmCreditsPayment` call assertion
- [ ] Write unit test: `calculateRevenueShareBonus` — standard 75%, zero share, 100% share, rounding
- [ ] Write unit test: `confirmCreditsPayment` — two `creditAccount` calls (user + system), idempotency on retry
- [ ] Run `pnpm check` — lint, typecheck, format, tests must all pass

## Risks / Gotchas

- **readyz import is dead code** — `verifySystemTenant` is imported but never called. This will fail lint (`unused imports`). Must either add the call or remove the import before committing
- **`confirmCreditsPayment` callers** — the function signature change (adding `serviceAccountService`) is breaking. Check `credits.server.ts` facade and the existing unit/facade tests
- **Mock needs updating** — `createMockAccountService()` in `tests/_fakes/accounts/mock-account.service.ts` returns `AccountService` (not `ServiceAccountService`). You'll need a separate `createMockServiceAccountService()` or pass the mock directly
- **`credit_ledger` FK requires `virtual_key_id`** — the migration seeds one for `cogni_system`. The `ServiceDrizzleAccountService.creditAccount()` resolves it via `findDefaultKey()`. If you ever reset the DB without re-running migrations, the healthcheck will catch it

## Pointers

| File / Resource                                                                | Why it matters                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [task.0046](../items/task.0046.system-tenant-bootstrap-revenue-split.md)       | Full requirements, plan, validation commands              |
| [Research doc](../../docs/research/system-tenant-seeding-heartbeat-funding.md) | Economics model, options considered                       |
| [system-tenant spec](../../docs/spec/system-tenant.md)                         | Governing invariants (12 items)                           |
| [billing-evolution spec](../../docs/spec/billing-evolution.md)                 | Credit unit standard, idempotency constraints             |
| `packages/db-schema/src/refs.ts`                                               | `billingAccounts` table with `isSystemTenant` column      |
| `packages/db-schema/src/billing.ts`                                            | `creditLedger` with `revenueShareRefUnique` index         |
| `src/core/billing/pricing.ts`                                                  | `calculateRevenueShareBonus()` (uncommitted)              |
| `src/features/payments/services/creditsConfirm.ts`                             | Payment confirmation — wire revenue share here            |
| `src/app/_facades/payments/credits.server.ts`                                  | Facade — pass `serviceAccountService` from container here |
| `src/ports/accounts.port.ts`                                                   | `ServiceAccountService` interface (already extended)      |
| `src/adapters/server/accounts/drizzle.adapter.ts`                              | `ServiceDrizzleAccountService` (already extended)         |
| `tests/unit/features/payments/services/creditsConfirm.spec.ts`                 | Existing unit tests — update for new param                |
| `tests/_fakes/accounts/mock-account.service.ts`                                | Mock factory — may need ServiceAccountService variant     |
