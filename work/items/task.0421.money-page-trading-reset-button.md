---
id: task.0421
type: task
title: "Money page — Reset Trading Approvals button for degraded-state recovery"
status: needs_triage
priority: 2
rank: 30
estimate: 2
summary: "Add a 'Reset Trading Approvals' button to the Money page Trading Wallet section. Clicking it nulls the calling tenant's `poly_wallet_connections.trading_approvals_ready_at` (and clears the `allowance_state` JSONB cache) so the existing Enable Trading flow re-engages on the next click. Surfaced after the Polymarket V2 cutover (PR #1118) — every tenant on candidate-a / preview / production needed a manual SSH-driven SQL UPDATE to recover, because no app-side path existed to invalidate the readiness stamp. The next time approvals drift (V3 cutover, contract address rotation, allowance get-revoked-by-user-on-Polygonscan, partial-fail mid-ceremony that left a misleading stamp), the user should be able to recover from the UI without ops involvement."
outcome: "A user whose trading is degraded for any reason can hit one button on the Money page and have the system fall back to the un-enabled state, then click Enable Trading and run a fresh ceremony. No SSH, no DB access, no ops escalation. Tenant-scoped (only resets the calling user's row, never another tenant's). Idempotent. Audited (logs which billing_account_id was reset and the prior stamp value)."
spec_refs:
  - poly-trader-wallet-port
  - poly-multi-tenant-auth
  - poly-collateral-currency
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
deploy_verified: false
labels: [poly, ui, money-page, ops, recovery]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1118
  - work/items/bug.0419.poly-v2-approval-contract-addresses.md
---

# Money page — Reset Trading Approvals (degraded-state recovery)

## Why

PR #1118's V2 cutover broke trading on every env — V1 envelope, V1 approvals, V1 collateral all needed to flip. Code changes shipped cleanly, but **every existing user's `trading_approvals_ready_at` stamp was now certifying state that no longer matched reality** (V1 exchanges, USDC.e allowances). The existing `authorizeIntent` short-circuits with `trading_ready: true` when the stamp is set, so users couldn't re-trigger Enable Trading from the UI — the button hides itself when ready=true. Recovery required:

1. SSH into the env's VM.
2. `kubectl get secret … DATABASE_SERVICE_URL`.
3. `psql … UPDATE poly_wallet_connections SET trading_approvals_ready_at = NULL …`.
4. User re-clicks Enable Trading.

We did this 3 times (candidate-a, preview, production). For production, it required explicitly accepting that we were violating the devops contract's "Never SSH to production" rule.

The general lesson: **the readiness stamp is a hint, not a proof.** Real on-chain state can drift from it for many reasons (V3 cutover, Polymarket rotates contract addresses, user revokes allowance via Etherscan, a previous Enable Trading run partial-failed but stamped anyway, etc.). The recovery path needs to be in-app, not in-VM.

## Scope

**One button** in `nodes/poly/app/src/app/(app)/credits/TradingReadinessSection.tsx` (or wherever the Trading Wallet card lives — confirm during implementation), labeled something like "**Reset trading approvals**" with a destructive-styled tone. Located inside the Trading Wallet card, gated behind a confirmation dialog.

**One route** at `POST /api/v1/poly/wallet/reset-trading-approvals`. Session-auth. Resolves the calling user's `billing_account_id`. Calls a new port method `PolyTraderWalletPort.resetTradingApprovals(billingAccountId)` that:

- Updates `poly_wallet_connections SET trading_approvals_ready_at = NULL, allowance_state = NULL WHERE billing_account_id = $1 AND revoked_at IS NULL`.
- Returns the previous stamp value for audit logging.
- Emits `poly.wallet.reset_trading_approvals.ok` with `billing_account_id`, `connection_id`, `prior_stamp` (ISO timestamp or null).

**No on-chain effects.** This does not call `revoke()` on any contract; it does not touch USDC.e/pUSD allowances on chain; it does not unwrap pUSD. It only invalidates our app-side readiness cache so the next Enable Trading click re-runs the ceremony, which itself is idempotent and skips already-satisfied steps. So a user with healthy V2 approvals who hits Reset will: stamp gets nulled → click Enable Trading → ceremony runs all 8 checks against live on-chain state → all return "satisfied" → stamp is re-set → no transactions, no gas. Cheap to use defensively.

**Tenant-scoped.** Filter by `billing_account_id = <session user>`. Never touches another tenant's row. Component test asserts cross-tenant isolation.

## Out of scope

- Revoking on-chain approvals (separate ask; would need explicit `approve(spender, 0)` calls and gas).
- Unwrapping pUSD → USDC.e (that's a withdraw flow, separate spec).
- Wiping `poly_wallet_connections.revoked_at` (the existing `revoke` method is the path for that — different intent).
- Resetting other tenants from an admin/operator UI (out of scope; ops can still SSH if truly needed, with explicit contract acknowledgment).

## Files to touch

- `packages/poly-wallet/src/port/poly-trader-wallet.port.ts` — add `resetTradingApprovals(billingAccountId): Promise<{prior_stamp: Date | null}>` method to the port interface.
- `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — implement the port method. One UPDATE statement, RETURNING the old value.
- `packages/node-contracts/src/poly.wallet.reset-trading-approvals.v1.contract.ts` — new Zod contract.
- `nodes/poly/app/src/app/api/v1/poly/wallet/reset-trading-approvals/route.ts` — new route.
- `nodes/poly/app/src/app/(app)/credits/TradingReadinessSection.tsx` (or sibling) — add the button + confirmation dialog. Disable while in flight.
- Component test: `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts` — assert tenant scoping.

## Validation

**exercise:** sign in to candidate-a, click "Reset trading approvals" → confirm. Hit Money page again — Enable Trading button is exposed. Click it; 8-step ceremony runs and all steps return "satisfied" (no on-chain txs, gas spend ≈ 0); stamp is re-set; trading flag goes back to ready.

**observability:**

```logql
{env="candidate-a", service="app"} | json
  | event="poly.wallet.reset_trading_approvals.ok"
```

Should appear once per click, with `billing_account_id` matching the session user.

## Notes for the implementer

- Route should match the `/api/v1/poly/wallet/{connect, status, balance, enable-trading, disconnect}` family — same wrapping middleware (`wrapRouteHandlerWithLogging`), same session auth, same response envelope shape.
- The button copy should be unambiguous about what it does — "Reset trading approvals (you'll re-run Enable Trading next)" or similar. Avoid alarming users into thinking they're losing wallet access.
- Confirmation dialog should explain: "This clears our cached readiness state. You'll be prompted to Enable Trading again. No funds will move." Two-button confirm.
- Disable the button when `trading_approvals_ready_at IS NULL` already (nothing to reset).
- Consider rate-limiting (one reset per N minutes per tenant) — but probably premature for v0; trust the user.
