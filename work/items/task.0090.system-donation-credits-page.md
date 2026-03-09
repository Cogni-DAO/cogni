---
id: task.0090
type: task
title: Keep Cogni Alive - direct system account funding on credits page
status: needs_implement
priority: 0
rank: 25
estimate: 2
summary: Split credits page into "Buy Credits" (self) and "Keep Cogni Alive" (system donation). Add `purpose` field to payment_attempts as the stable context envelope; settlement branches on purpose to route credits. Rename `widget_payment` reason to `credits_purchase`. Tighten idempotency indexes to composite (billing_account_id, reference). Migrate credit_ledger.reference to payment_attempts.id.
outcome: Users can directly fund the system account from the credits page, with clear UX distinguishing personal credits from system donations. Settlement is DB-idempotent, donor-attributable, and CHECK-constrained.
spec_refs: accounts-design-spec, system-tenant
assignees: derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/discord-agents
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-19
updated: 2026-02-19
labels: [billing, system-tenant, ui]
external_refs: []
---

# Keep Cogni Alive - Direct System Account Funding

## Context

Users can currently buy credits for their own account. There's no way to directly fund the system account that powers Cogni's governance agents, Discord bots, and infrastructure AI. The system tenant only receives a revenue-share side-effect from user purchases.

This task adds a "Keep Cogni Alive" section to the credits page, letting users donate directly to the system account. The on-chain USDC flow is identical — only the settlement target differs.

### Approach

**`payment_attempts.purpose`** is the stable context envelope. It stores `"self"` or `"system"` at creation (CHECK-constrained, write-once) and is read at settlement to route credits. Intermediate layers pass the contract input through generically — most need zero changes.

Additionally: rename `widget_payment` → `credits_purchase` for cleaner reason semantics. Early-stage project, no production data — clean migration.

Three hardening changes:

1. **`credit_ledger.reference` = `payment_attempts.id`** (not `${chainId}:${txHash}`) — unambiguous FK-like join
2. **Idempotency index tightened to `(billing_account_id, reference)`** per reason — composite, not just `reference`
3. **DB CHECK constraint** on `payment_attempts.purpose` — enforce enum at DB level

### How `purpose` flows (the envelope pattern)

```
Contract input: { amountUsdCents, purpose }
  → API client: JSON.stringify(input)          — 0 changes (generic passthrough)
  → Route handler: parses contract, calls facade — 0 changes (passes parsed input)
  → Facade: adds billingAccountId, forwards     — 1 line (add purpose to object)
  → Service createIntent: stores on attempt row  — 1 line (forward to repo create)
  ─── async gap (wallet sign → on-chain confirm → verify) ───
  → verifyAndSettle: reads attempt.purpose       — 5 lines (branch to settlement fn)
  → Settlement: credits user OR system tenant    — new fn ~15 lines
```

### Settlement logic

```
purpose === "self":
  → confirmCreditsPayment() (existing, unchanged)
  → Credits user account + mints revenue share bonus to system tenant

purpose === "system":
  → confirmSystemDonation() (new, ~15 lines)
  → Credits system tenant directly, reason "system_donation"
  → No revenue share (already 100% to system)
```

### UI layout

```
CreditsPage
├── Balance Card (unchanged — shows user's balance)
├── SectionCard: "Buy Credits"
│   ├── subtext: "Add credits to your account"
│   ├── SplitInput + UsdcPaymentFlow (purpose="self")
│   └── HintText: "Transactions may take many minutes to confirm"
└── SectionCard: "Keep Cogni Alive"
    ├── subtext: "Directly fund Cogni's AI infrastructure"
    ├── SplitInput + UsdcPaymentFlow (purpose="system")
    └── HintText: "100% goes to the system account that powers Cogni's agents"
```

### Rejected alternatives

- Separate API endpoint for donations — duplicates the entire intent/submit/status pipeline for a 1-field difference
- `context: JSONB` bag on payment_attempts — over-engineering; a typed column is simpler and queryable
- Threading `purpose` explicitly through every function — unnecessary; the attempt row carries it

## Requirements

- `payment_attempts` table has `purpose TEXT NOT NULL DEFAULT 'self'` with `CHECK (purpose IN ('self', 'system'))`
- `purpose` is write-once: set at creation, no update path exposed on port
- `verifyAndSettle` branches on `attempt.purpose`: `"self"` → existing `confirmCreditsPayment()`, `"system"` → new `confirmSystemDonation()`
- `confirmSystemDonation()` credits `COGNI_SYSTEM_BILLING_ACCOUNT_ID` with reason `"system_donation"`, no revenue share
- `credit_ledger.reference` for all payment-sourced entries = `payment_attempts.id` (not `${chainId}:${txHash}`)
- Idempotency enforced by composite unique index `ON (billing_account_id, reference) WHERE reason = '...'` per reason type
- Rename `widget_payment` → `credits_purchase` in constant, credit_ledger data, and partial unique indexes
- Credits page renders two independent sections: "Buy Credits" (purpose=self) and "Keep Cogni Alive" (purpose=system)
- `UsdcPaymentFlow`, `PaymentFlowDialog`, `PaymentButton`, `PaymentStatusChip` — zero changes
- `paymentsClient`, submit/status route handlers, on-chain verification pipeline — zero changes

## Allowed Changes

### Migration + Schema

- `src/adapters/server/db/migrations/` — new migration SQL file
- `packages/db-schema/src/billing.ts` — add `purpose` column, update/add partial unique indexes

### Core + Port + Adapter

- `src/core/payments/model.ts` — add `purpose` to `PaymentAttempt`
- `src/ports/payment-attempt.port.ts` — add `purpose` to `CreatePaymentAttemptParams`
- `src/adapters/server/payments/drizzle-payment-attempt.adapter.ts` — add to insert + mapRow

### Constants

- `src/shared/constants/payments.ts` — rename `WIDGET_PAYMENT_REASON` → `CREDITS_PURCHASE_REASON`
- `src/shared/constants/system-tenant.ts` — add `SYSTEM_DONATION_REASON`

### Settlement

- `src/features/payments/services/paymentService.ts` — reference format change + purpose branch in `verifyAndSettle`, forward purpose in `createIntent`
- `src/features/payments/services/creditsConfirm.ts` — rename reason, add `confirmSystemDonation()`

### Contract + Facade

- `src/contracts/payments.intent.v1.contract.ts` — add `purpose` to input
- `src/app/_facades/payments/attempts.server.ts` — forward `purpose` (1 line)

### Client

- `src/features/payments/hooks/usePaymentFlow.ts` — accept + forward `purpose`
- `src/app/(app)/credits/CreditsPage.client.tsx` — add "Keep Cogni Alive" SectionCard

### Tests

- `tests/unit/features/payments/services/creditsConfirm.spec.ts` — reason rename + donation tests
- `tests/unit/features/payments/api/creditsSummaryClient.spec.ts` — fixture update
- `tests/unit/features/payments/hooks/useCreditsSummary.spec.tsx` — fixture update
- `tests/stack/payments/credits-confirm.stack.test.ts` — reason + reference assertions
- `tests/stack/payments/mvp-scenarios.stack.test.ts` — reason + reference assertions

### Docs

- `docs/spec/dao-enforcement.md` — update `widget_payment` → `credits_purchase`, add `system_donation` to gate
- `docs/spec/payments-design.md` — update reason references
- `docs/spec/accounts-api-endpoints.md` — update reason references

### Zero changes (do NOT touch)

- `src/components/kit/payments/UsdcPaymentFlow.tsx`
- `src/components/kit/payments/PaymentFlowDialog.tsx`
- `src/components/kit/payments/PaymentButton.tsx`
- `src/features/payments/api/paymentsClient.ts`
- `src/app/api/v1/payments/intents/route.ts`
- `src/app/api/v1/payments/attempts/[id]/submit/route.ts`
- `src/app/api/v1/payments/attempts/[id]/route.ts`
- On-chain verification pipeline

## Plan

### Step 1: Migration + Schema

- [ ] Create migration `src/adapters/server/db/migrations/00XX_add_payment_purpose_rename_reason.sql`:

```sql
-- 1. Add purpose to payment_attempts with CHECK constraint (write-once enforced at port level)
ALTER TABLE payment_attempts
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'self'
  CHECK (purpose IN ('self', 'system'));

-- 2. Rename widget_payment → credits_purchase in credit_ledger
UPDATE credit_ledger SET reason = 'credits_purchase' WHERE reason = 'widget_payment';

-- 3. Migrate reference format: chainId:txHash → payment_attempts.id
--    Join through payment_attempts to get the attempt ID for each ledger entry
UPDATE credit_ledger cl
SET reference = pa.id
FROM payment_attempts pa
WHERE cl.reason IN ('credits_purchase', 'platform_revenue_share')
  AND cl.reference IS NOT NULL
  AND cl.reference = CONCAT(pa.chain_id, ':', pa.tx_hash);

-- 4. Drop old partial unique indexes, create composite (billing_account_id, reference) indexes
DROP INDEX IF EXISTS credit_ledger_payment_ref_unique;
DROP INDEX IF EXISTS credit_ledger_revenue_share_ref_unique;

CREATE UNIQUE INDEX credit_ledger_credits_purchase_ref_unique
  ON credit_ledger (billing_account_id, reference) WHERE reason = 'credits_purchase';

CREATE UNIQUE INDEX credit_ledger_revenue_share_ref_unique
  ON credit_ledger (billing_account_id, reference) WHERE reason = 'platform_revenue_share';

CREATE UNIQUE INDEX credit_ledger_system_donation_ref_unique
  ON credit_ledger (billing_account_id, reference) WHERE reason = 'system_donation';
```

- [ ] Update drizzle schema `packages/db-schema/src/billing.ts`:
  - Add `purpose: text("purpose").notNull().default("self")` to `paymentAttempts`
  - Update `paymentRefUnique`: composite `(billingAccountId, reference)` WHERE `reason = 'credits_purchase'`
  - Update `revenueShareRefUnique`: composite `(billingAccountId, reference)` WHERE `reason = 'platform_revenue_share'`
  - Add `systemDonationRefUnique`: composite `(billingAccountId, reference)` WHERE `reason = 'system_donation'`

### Step 2: Core Model + Port + Adapter

- [ ] `src/core/payments/model.ts` — add `purpose: "self" | "system"` to `PaymentAttempt`
- [ ] `src/ports/payment-attempt.port.ts` — add `purpose: "self" | "system"` to `CreatePaymentAttemptParams`
- [ ] `src/adapters/server/payments/drizzle-payment-attempt.adapter.ts`:
  - Add `purpose: params.purpose` to `.values({...})` in `create()`
  - Add `purpose: row.purpose as "self" | "system"` to `mapRow()`

### Step 3: Constants

- [ ] `src/shared/constants/payments.ts`:
  - Rename: `CREDITS_PURCHASE_REASON = "credits_purchase"` (was `WIDGET_PAYMENT_REASON`)
  - Keep deprecated alias: `export const WIDGET_PAYMENT_REASON = CREDITS_PURCHASE_REASON;`
- [ ] `src/shared/constants/system-tenant.ts`:
  - Add: `SYSTEM_DONATION_REASON = "system_donation"`

### Step 4: Reference format change

- [ ] `src/features/payments/services/paymentService.ts` `verifyAndSettle()`:
  - Change `clientPaymentId` from `` `${attempt.chainId}:${attempt.txHash}` `` → `attempt.id`
  - This makes `credit_ledger.reference` an unambiguous FK to `payment_attempts.id`

### Step 5: Settlement — the branch point

- [ ] `src/features/payments/services/creditsConfirm.ts`:
  - Update all `WIDGET_PAYMENT_REASON` → `CREDITS_PURCHASE_REASON`
  - Add `confirmSystemDonation()`:

```ts
export async function confirmSystemDonation(
  serviceAccountService: ServiceAccountService,
  input: {
    amountUsdCents: number;
    clientPaymentId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ creditsApplied: number }> {
  const existing = await serviceAccountService.findCreditLedgerEntryByReference(
    {
      billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
      reason: SYSTEM_DONATION_REASON,
      reference: input.clientPaymentId,
    }
  );
  if (existing) return { creditsApplied: 0 };

  const credits = Number(usdCentsToCredits(input.amountUsdCents));
  await serviceAccountService.creditAccount({
    billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
    amount: credits,
    reason: SYSTEM_DONATION_REASON,
    reference: input.clientPaymentId,
    metadata: { ...input.metadata, provider: "direct_donation" },
  });
  return { creditsApplied: credits };
}
```

- [ ] `src/features/payments/services/paymentService.ts`:
  - `createIntent()`: add `purpose` to `CreateIntentInput`, forward to `userRepo.create()`
  - `verifyAndSettle()`: branch on `attempt.purpose`:

```ts
const clientPaymentId = attempt.id; // was chainId:txHash

if (attempt.purpose === "system") {
  await confirmSystemDonation(serviceAccountService, {
    amountUsdCents: attempt.amountUsdCents,
    clientPaymentId,
    metadata: {
      txHash: attempt.txHash,
      chainId: attempt.chainId,
      fromAddress: attempt.fromAddress,
    },
  });
} else {
  await confirmCreditsPayment(accountService, serviceAccountService, {
    billingAccountId: attempt.billingAccountId,
    defaultVirtualKeyId,
    amountUsdCents: attempt.amountUsdCents,
    clientPaymentId,
    metadata: {
      paymentAttemptId: attempt.id,
      txHash: attempt.txHash,
      chainId: attempt.chainId,
      fromAddress: attempt.fromAddress,
    },
  });
}
```

### Step 6: Contract + Facade

- [ ] `src/contracts/payments.intent.v1.contract.ts` — add to input:

```ts
purpose: z.enum(["self", "system"]).default("self"),
```

- [ ] `src/app/_facades/payments/attempts.server.ts` — `createPaymentIntentFacade()`:
  - Add `purpose: input.purpose` to the object passed to `createIntent()`
- [ ] Route handler (`src/app/api/v1/payments/intents/route.ts`): **zero changes** — already parses contract input and passes to facade

### Step 7: Client Hook

- [ ] `src/features/payments/hooks/usePaymentFlow.ts`:
  - Add `purpose?: "self" | "system"` to `UsePaymentFlowOptions`
  - In `startPayment()`, change: `paymentsClient.createIntent({ amountUsdCents, purpose })`
- [ ] `src/features/payments/api/paymentsClient.ts`: **zero changes** — sends full `PaymentIntentInput` which now includes `purpose`

### Step 8: UI

- [ ] `src/app/(app)/credits/CreditsPage.client.tsx`:
  - Two sections, each with independent `useState` + `usePaymentFlow`
  - "Buy Credits" section: `purpose="self"`, subtext "Add credits to your account"
  - "Keep Cogni Alive" section: `purpose="system"`, subtext "Directly fund Cogni's AI infrastructure"
  - HintText: "100% goes to the system account that powers Cogni's agents"

### Step 9: Tests

- [ ] `creditsConfirm.spec.ts` — update `WIDGET_PAYMENT_REASON` → `CREDITS_PURCHASE_REASON`, add tests for `confirmSystemDonation` (credits system, idempotent, no revshare)
- [ ] `creditsSummaryClient.spec.ts`, `useCreditsSummary.spec.tsx` — update fixture `"widget_payment"` → `"credits_purchase"`
- [ ] `credits-confirm.stack.test.ts`, `mvp-scenarios.stack.test.ts` — update reason assertions, update reference format assertions (now `attempt.id` not `chainId:txHash`)
- [ ] New: test `verifyAndSettle` with `purpose="system"` calls donation path

### Step 10: Docs

- [ ] `docs/spec/dao-enforcement.md`: Update `widget_payment` → `credits_purchase`, update gate allowlist to include `system_donation`
- [ ] `docs/spec/payments-design.md`, `docs/spec/accounts-api-endpoints.md`: Update reason references

## Validation

**Unit tests:**

```bash
pnpm test src/core/billing/pricing.test.ts
pnpm test tests/unit/features/payments/services/creditsConfirm.spec.ts
pnpm test tests/unit/features/payments/api/creditsSummaryClient.spec.ts
pnpm test tests/unit/features/payments/hooks/useCreditsSummary.spec.tsx
```

**Stack tests:**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/payments/credits-confirm.stack.test.ts
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/payments/mvp-scenarios.stack.test.ts
```

**Full check:**

```bash
pnpm check
pnpm check:docs
```

**Expected:** All tests pass. Credits page renders two sections. System donation creates single `credit_ledger` entry with reason `system_donation`, reference = `attempt.id`, on system account, no revenue share entry.

## Review Checklist

- [ ] **Work Item:** `task.0090` linked in PR body
- [ ] **DONATION_ATTRIBUTION:** `credit_ledger.reference` = `payment_attempts.id` for all payment-sourced entries (unambiguous FK-like join)
- [ ] **DB_ENFORCED_IDEMPOTENCY:** Composite unique index `ON (billing_account_id, reference) WHERE reason = '...'` per reason type — prevents double-mint under races
- [ ] **PURPOSE_CHECK_CONSTRAINT:** `CHECK (purpose IN ('self', 'system'))` on `payment_attempts` — DB-enforced enum
- [ ] **PURPOSE_WRITE_ONCE:** `purpose` set at creation, no update path exposed on port
- [ ] **PURPOSE_DEFAULT_SELF:** Defaults to `"self"` — all existing flows unchanged
- [ ] **NO_REVENUE_SHARE_ON_DONATION:** System donations skip revenue share (circular)
- [ ] **CUSTOMER_DATA_UNDER_CUSTOMER_ACCOUNT:** `payment_attempts.billingAccountId` remains user's account (RLS owner); `purpose` determines settlement target
- [ ] **REASON_SEMANTICS:** New writes use `credits_purchase` (not `widget_payment`); `system_donation` for donations
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
