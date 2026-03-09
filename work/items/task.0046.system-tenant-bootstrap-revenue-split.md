---
id: task.0046
type: task
title: System tenant bootstrap + purchase-time revenue share
status: done
priority: 0
estimate: 3
summary: Seed cogni_system billing account, add startup healthcheck, and on every credit purchase mint bonus credits to the system tenant (75% of user's purchased amount).
outcome: cogni_system exists in DB with is_system_tenant=true (unique), app fails fast if missing, and every credit purchase credits the user (full amount) then mints bonus credits to system tenant (sequential + idempotent).
spec_refs: system-tenant, billing-evolution-spec, accounts-design-spec
assignees: cogni-dev
credit:
project: proj.system-tenant-governance
branch: feat/system-tenant-bootstrap
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-14
labels: [system-tenant, billing]
external_refs:
  - docs/research/system-tenant-seeding-heartbeat-funding.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# System Tenant Bootstrap + Purchase-Time Revenue Share

## Economics

Users buy credits by sending money to the DAO wallet address. The DAO holds the money — no new accounting needed for inbound funds.

| Event                     | Credits minted | Recipient                                      |
| ------------------------- | -------------- | ---------------------------------------------- |
| User buys $100 of credits | 1,000,000,000  | User (100% of purchase — unchanged from today) |
| Revenue share bonus       | 750,000,000    | System tenant (75% of user's purchased amount) |

The user always receives exactly what they paid for. The system tenant receives **additional** bonus credits funded by markup revenue (the 2× markup at consumption means the user's $100 of credits buys $50 of compute — the $50 surplus is the economic backing for the system tenant's bonus).

No DAO reserve account is needed — the DAO already holds the money.

## Requirements

### Schema

- `billing_accounts` has `is_system_tenant BOOLEAN NOT NULL DEFAULT false` column
- Partial unique index enforces exactly one system tenant: `UNIQUE WHERE is_system_tenant = true`
- `cogni_system_principal` user and `cogni_system` billing account seeded by migration (idempotent, balance 0, `is_system_tenant=true`)
- Seed IDs are fixed string constants referenced by code across all environments

### Startup

- Application startup fails fast with clear error if `cogni_system` billing account is missing or `is_system_tenant` is not true — per `SYSTEM_TENANT_STARTUP_CHECK`

### Revenue share

- `confirmCreditsPayment()` sequentially performs two ledger credits with idempotency guards (not one transaction — user credit uses appDb/RLS, system tenant credit uses serviceDb/BYPASSRLS):
  1. User: `purchasedCredits` (reason `widget_payment`) — **unchanged amount, same as today**
  2. System tenant: `floor(purchasedCredits × SYSTEM_TENANT_REVENUE_SHARE)` (reason `platform_revenue_share`)
- If crash between steps: retry skips user credit (idempotent via `clientPaymentId`), applies system tenant credit
- `SYSTEM_TENANT_REVENUE_SHARE` env var: `z.coerce.number().min(0).max(1).default(0.75)`
- `calculateRevenueShareBonus()` is a pure function in `src/core/billing/pricing.ts` — no IO, no env reads
- Entire operation keyed by `clientPaymentId`: on retry, both the user credit and system tenant credit are skipped (existing `findCreditLedgerEntryByReference` idempotency check covers user; add matching check for system tenant with `reason: 'platform_revenue_share'`)
- When `SYSTEM_TENANT_REVENUE_SHARE=0`, no system tenant credit is minted
- `IS_SYSTEM_TENANT_METADATA_ONLY` upheld: `is_system_tenant` is never used as an authorization branch

## Allowed Changes

- `packages/db-schema/src/refs.ts` — add `isSystemTenant` column to `billingAccounts`
- `src/adapters/server/db/migrations/` — new migration SQL file
- `src/bootstrap/` — new `healthchecks.ts`, wire into app startup
- `src/core/billing/pricing.ts` — add `calculateRevenueShareBonus()`
- `src/features/payments/services/creditsConfirm.ts` — add system tenant bonus credit
- `src/shared/env/server.ts` — add `SYSTEM_TENANT_REVENUE_SHARE`
- `src/shared/constants/` — `SYSTEM_TENANT_ID`, `SYSTEM_TENANT_PRINCIPAL_ID` constants
- `.env.local.example` — document new env var
- `tests/` — new unit tests (pricing math), updated stack tests (purchase flow)

## Plan

### Schema & Migration

- [ ] Add `isSystemTenant` column to `billingAccounts` in `packages/db-schema/src/refs.ts`
- [ ] Create migration `0007_system_tenant.sql`:

```sql
ALTER TABLE billing_accounts
  ADD COLUMN is_system_tenant boolean NOT NULL DEFAULT false;

-- Enforce exactly one system tenant
CREATE UNIQUE INDEX billing_accounts_one_system_tenant
  ON billing_accounts ((is_system_tenant))
  WHERE is_system_tenant = true;

-- Service principal (no wallet — app-level owner, not a user)
INSERT INTO users (id, wallet_address)
VALUES ('cogni_system_principal', NULL)
ON CONFLICT (id) DO NOTHING;

-- System tenant billing account
INSERT INTO billing_accounts (id, owner_user_id, is_system_tenant, balance_credits, created_at)
VALUES ('cogni_system', 'cogni_system_principal', true, 0, now())
ON CONFLICT (id) DO NOTHING;
```

- [ ] Add string constants in `src/shared/constants/`:

```typescript
export const SYSTEM_TENANT_ID = "cogni_system" as const;
export const SYSTEM_TENANT_PRINCIPAL_ID = "cogni_system_principal" as const;
```

### Startup Healthcheck

- [ ] Create `src/bootstrap/healthchecks.ts` with `verifySystemTenant(serviceDb)`
- [ ] Query `billing_accounts` for `SYSTEM_TENANT_ID` where `is_system_tenant=true`
- [ ] Throw `Error('FATAL: cogni_system billing account missing or not flagged. Run migrations.')` if absent
- [ ] Wire into app startup (instrumentation or bootstrap entrypoint)

### Pure Billing Math

- [ ] Add to `src/core/billing/pricing.ts`:

```typescript
export function calculateRevenueShareBonus(
  purchasedCredits: bigint,
  revenueShare: number
): bigint {
  if (revenueShare <= 0) return 0n;
  return BigInt(Math.floor(Number(purchasedCredits) * revenueShare));
}
```

### Env

- [ ] Add `SYSTEM_TENANT_REVENUE_SHARE` to `src/shared/env/server.ts`:

```typescript
SYSTEM_TENANT_REVENUE_SHARE: z.coerce.number().min(0).max(1).default(0.75),
```

- [ ] Add to `.env.local.example` with comment

### Revenue Share in `confirmCreditsPayment()`

- [ ] After existing idempotency check for user credit, add idempotency check for system tenant credit (same `clientPaymentId`, reason `platform_revenue_share`)
- [ ] Compute bonus: `calculateRevenueShareBonus(purchasedCredits, serverEnv().SYSTEM_TENANT_REVENUE_SHARE)`
- [ ] If bonus > 0, credit system tenant via `serviceAccountService.creditAccount()`:

```typescript
{
  billingAccountId: SYSTEM_TENANT_ID,
  amount: Number(bonusCredits),
  reason: 'platform_revenue_share',
  reference: clientPaymentId,  // same reference as user credit for traceability
}
```

- [ ] Both credits (user + system tenant) in one DB transaction for atomicity
- [ ] User credit amount is **unchanged** — still `usdCentsToCredits(amountUsdCents)` (full purchase)

### Tests

- [ ] Unit: `calculateRevenueShareBonus` — standard 75%, zero share, 100% share, rounding behavior
- [ ] Unit: `confirmCreditsPayment` with mocked ports — verify two `creditAccount` calls (user + system), user gets full `purchasedCredits`
- [ ] Unit: idempotency — retry same `clientPaymentId` → no additional credits for either party
- [ ] Stack: E2E credit purchase → verify two `credit_ledger` entries with correct amounts and reasons linked to same `clientPaymentId`
- [ ] Stack: retry same payment → idempotent, no duplicate entries

## Validation

**Unit tests:**

```bash
pnpm test src/core/billing/pricing.test.ts
pnpm test src/features/payments/services/creditsConfirm.test.ts
```

**Stack tests:**

```bash
pnpm test:stack -- --grep "revenue share"
```

**Full check:**

```bash
pnpm check
pnpm check:docs
```

**Expected:** All tests pass. `cogni_system` exists after migration. Credit purchase creates two ledger entries: user gets `purchasedCredits`, system tenant gets `floor(purchasedCredits × 0.75)`.

## Design Decisions

**No DAO reserve account:** The DAO already holds the money (sent to DAO wallet address). No on-ledger DAO reserve needed. The 25% not minted to system tenant is implicit margin.

**User gets 100%:** The user's credit allocation is unchanged from today. The system tenant bonus is additional credits minted on top, not subtracted from the user.

**ServiceAccountService for system tenant credits:** Must use `ServiceDrizzleAccountService` (BYPASSRLS) since system tenant data is not scoped to the calling user's RLS context.

**System tenant self-markup:** Deferred. When the system tenant consumes credits, it goes through the same billing path. Whether to exempt from markup is a separate policy decision.

## Scope Guardrails

- Do not add governance UI or on-chain logic in P0
- Do not introduce new policy storage tables beyond what is needed for seed + idempotency
- Keep all policy knobs as env for P0; migrate to DB-config later only if needed

## Review Checklist

- [ ] **Work Item:** `task.0046` linked in PR body
- [ ] **Spec:** `SYSTEM_TENANT_STARTUP_CHECK`, `IS_SYSTEM_TENANT_METADATA_ONLY`, `CREDIT_UNIT_STANDARD`, `IDEMPOTENT_CHARGE_RECEIPTS` upheld
- [ ] **DB:** Partial unique index on `is_system_tenant WHERE true` prevents multiple system tenants
- [ ] **Idempotency:** retry of same `clientPaymentId` produces no duplicate credits (user or system tenant)
- [ ] **Tests:** unit (bonus math, confirm service, idempotency) + stack (E2E purchase + retry)
- [ ] **Migration:** idempotent (ON CONFLICT DO NOTHING), tested on fresh + existing DB
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0046.handoff.md)

## Attribution

-
