---
id: bug.0050
type: bug
title: "Negative credit balance breaks /credits/summary — Zod rejects balanceCredits < 0"
status: done
priority: 2
estimate: 1
summary: "When charge_receipts drive balance_credits negative (allowed by recordChargeReceipt per BILLING_NEVER_THROWS), the /api/v1/payments/credits/summary endpoint returns 400 because the output Zod schema enforces balanceCredits >= 0."
outcome: "Credits summary endpoint returns valid responses for all balance states including negative. UI displays negative balance with appropriate warning."
spec_refs: billing-ingest-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [billing, payments, p2]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 1
---

# bug.0050 — Negative credit balance breaks /credits/summary

## Requirements

### Observed

`GET /api/v1/payments/credits/summary` returns **400** with a Zod validation error:

```
"balanceCredits": "Too small: expected number to be >=0"
```

This happens when `billing_accounts.balance_credits` goes negative. The DB allows negative balances by design — `recordChargeReceipt()` intentionally permits this per BILLING_NEVER_THROWS (post-call billing must never block or throw). But the response contract rejects it.

**Trigger**: Callback-driven billing (task.0029) wrote real-cost receipts for `test-free-model` calls before the LiteLLM zero-pricing fix was applied. Each "free" call drained ~$0.003–$0.01, eventually pushing balance to -340,960 credits.

### Code Pointers

| File                                                    | Line | Issue                                                                                  |
| ------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `src/contracts/payments.credits.summary.v1.contract.ts` | 37   | `balanceCredits: z.number().nonnegative()` — rejects negative                          |
| `src/adapters/server/accounts/drizzle.adapter.ts`       | ~447 | `recordChargeReceipt()` allows negative balance, logs `inv_post_call_negative_balance` |
| `src/app/api/v1/payments/credits/summary/route.ts`      | ~75  | `creditsSummaryOperation.output.parse(summary)` — throws on negative                   |
| `packages/db-schema/src/refs.ts`                        | ~42  | `balance_credits BIGINT` — no DB-level constraint                                      |

### Expected

The credits summary endpoint should return a valid response even when balance is negative. Negative balances are a legitimate (if undesirable) state — the user should see their negative balance and the UI can warn them, rather than getting a 400 error that breaks the entire payments widget.

### Reproduction

1. Start `dev:stack:test`
2. Ensure a billing account has `balance_credits < 0` (e.g. via repeated `recordChargeReceipt()` calls exceeding available credits)
3. `GET /api/v1/payments/credits/summary` → 400 Zod error

### Impact

- **Severity**: P2 — UI fully broken for affected accounts (no credits widget, no activity view)
- **Scope**: Any account that goes negative via post-call billing (the designed BILLING_NEVER_THROWS path)
- **Current trigger**: Fixed (LiteLLM zero-pricing for free test models). But any future billing bug that over-charges will re-trigger this.

## Allowed Changes

- `src/contracts/payments.credits.summary.v1.contract.ts` — relax `balanceCredits` to allow negative
- `src/app/api/v1/payments/credits/summary/route.ts` — if any route-level clamping is preferred
- Tests covering negative balance scenario

## Plan

- [ ] Change `z.number().nonnegative()` to `z.number()` (or `z.number().int()`) in `creditsSummaryOperation.output`
- [ ] Add a unit/contract test: negative balance returns valid response
- [ ] Consider: should the UI clamp display to 0 with a warning? (UI concern, separate from API fix)

## Validation

**Command:**

```bash
pnpm typecheck && pnpm test:contract
```

**Expected:** All tests pass. Negative balance accounts get valid 200 responses.

## Review Checklist

- [ ] **Work Item:** `bug.0050` linked in PR body
- [ ] **Spec:** BILLING_NEVER_THROWS invariant upheld (negative balance is valid DB state)
- [ ] **Tests:** negative balance scenario covered
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0029 (callback billing — triggered the negative balance)
- Related: billing-ingest-spec (BILLING_NEVER_THROWS invariant)

## Attribution

-
