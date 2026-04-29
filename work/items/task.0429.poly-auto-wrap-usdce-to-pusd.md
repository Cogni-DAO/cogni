---
id: task.0429
type: task
title: "Poly trading wallet — auto-wrap USDC.e → pUSD (kill the human-click-on-cycle requirement)"
status: needs_design
priority: 1
rank: 5
estimate: 5
summary: "After the V2 cutover the wallet's lifecycle has a fatal seam for unattended operation: V2 exchanges spend pUSD, but external deposits and V1 legacy CTF redeems arrive as USDC.e. The only path that wraps USDC.e → pUSD today is Step 2 of the 8-step Enable Trading ceremony, which fires once at button-click time and never again. Real-world consequence observed on production 2026-04-29 ~07:30Z: funder 0x95e407… had $46.66 USDC.e + $0.42 pUSD, and 154/154 mirror placements in the prior 30 min returned `errorCode: insufficient_balance` because pUSD ran dry. The current product cannot operate continuously without a human in the loop. Fix: server-side auto-wrap loop driven by an explicit one-time consent the user grants via the Money page (the on-chain `USDC.e.approve(CollateralOnramp, max)` already exists from Enable Trading, so the app technically can wrap any time — the missing pieces are user-visible permission, a wrap-when-USDC.e>floor loop, and observability)."
outcome: "A user with `auto_wrap_consent: true` on their `poly_wallet_connections` row never has their wallet stall on `insufficient_balance` from USDC.e drift. Steady-state observed behavior on candidate-a: USDC.e balance polled every N minutes; whenever it crosses a floor (e.g. ≥ $1), `CollateralOnramp.wrap(USDC.e, funder, balance)` fires automatically and the funder's pUSD balance increases by the same amount. Mirror placements that would have failed `insufficient_balance` succeed instead. Audit trail (`poly.wallet.auto_wrap.{detected, submitted, confirmed, error}`) lets ops grep for any wrap that happened without explicit user trigger. Per-tenant. Idempotent. Off by default — the user grants consent via a clear Money page toggle and can revoke."
spec_refs:
  - poly-collateral-currency
  - poly-trader-wallet-port
  - poly-multi-tenant-auth
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
deploy_verified: false
labels: [poly, money-page, wallet, ops, recovery, auto-wrap]
external_refs:
  - work/items/task.0421.money-page-trading-reset-button.md
  - work/items/bug.0428.poly-redeem-worker-hardcodes-usdce.md
  - docs/spec/poly-collateral-currency.md
  - nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts
  - https://github.com/Cogni-DAO/node-template/pull/1131
---

# task.0429 — Auto-wrap USDC.e → pUSD

## Why this exists (production incident driving it)

Production funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`, 2026-04-29 ~07:30Z:

| token  |    balance | role                              |
| ------ | ---------: | --------------------------------- |
| USDC.e | **$46.66** | sitting; exchanges can't spend it |
| pUSD   |      $0.42 | dust; trades use this             |

In the 30 min prior, **154/154 mirror placement attempts returned `errorCode: "insufficient_balance"`**. The wallet had real money — just in the wrong token. There was no app-side path to recover; the only fix is to manually click Enable Trading on the Money page, which itself is hidden because `trading_approvals_ready_at IS NOT NULL` (so we'd also need task.0421's reset button as a precondition, OR an SSH UPDATE on the prod DB to null the stamp).

This is the structural seam that breaks unattended copy-trading. **Money cycles in to the wallet (deposits, V1 redeems, future V2 vanilla redeems before bug.0428 lands), the cycle inevitably routes through USDC.e, and the wallet stalls without a human click.** The product cannot be left to run.

## Why this isn't already a thing

After V2 cutover, Polymarket's collateral lifecycle (see `docs/spec/poly-collateral-currency.md`) intentionally separates:

- **USDC.e** = how money enters / exits a wallet (the public Polygon stablecoin).
- **pUSD** = how money trades inside Polymarket V2 (protocol-internal stablecoin).
- **CollateralOnramp** = the 1:1 airlock between them.

The V2 design doesn't include a "trade-mode pUSD top-up" primitive — Polymarket leaves that to the wallet operator. We chose at V2 cutover (PR #1118) to do the wrap one time per Enable Trading click, with the explicit caveat (in the spec) that "subsequent USDC.e deposits sit until the next Enable Trading click." That caveat is fine for a single-operator demo. It is not fine for unattended multi-tenant copy trading.

## Three structural cycles that all hit this seam

```
  external deposit (Coinbase, bridge)
      ─→ USDC.e in wallet ─→ STALL until human click
                                │
                                ▼
                            wrap()? not happening

  V1 CTF redeem (legacy, pre-V2 positions)
      ─→ redeem pays out USDC.e (collateralToken hardcode in worker)
      ─→ STALL

  V2 CTF redeem (post-V2, pUSD-backed)
      ─→ should pay out pUSD directly (CTF + collateralToken=pUSD)
      ─→ but bug.0428: redeem-worker still hardcodes USDC.e
      ─→ silently bleeds OR yields wrong token
```

bug.0428 fixes the third cycle (V2 redeems pay out pUSD directly). This task addresses the first two.

## Scope

### a. User consent surface (UI)

A **single toggle** on the Money page Trading Wallet card: **"Auto-convert deposits to trading currency"**. Default off; explicit opt-in.

- On enable: writes `auto_wrap_consent_at = now()` to the user's `poly_wallet_connections` row. Optionally also writes `auto_wrap_floor_usdc_e` (default `1.0` — don't wrap dust amounts).
- Help text: "When enabled, USDC.e deposits to your trading wallet are automatically converted to pUSD (the trading currency) so trades can use them. You can revoke at any time. No funds leave your wallet."
- On revoke: `auto_wrap_consent_at = NULL`. Loop stops.

### b. Server-side wrap loop

A new bootstrap job (mirrors the redeem-pipeline shape from task.0388):

- Tick every N seconds (start with 60s; tunable via env).
- For each `poly_wallet_connections` row where `auto_wrap_consent_at IS NOT NULL AND revoked_at IS NULL`:
  - Read funder's USDC.e balance via the Privy adapter's `readPolygonBalances`.
  - If `usdcE >= auto_wrap_floor_usdc_e`, dispatch `submitCollateralWrap(usdcE)` (already implemented as Step 2 of `ensureTradingApprovals`).
  - Single-flight per `(billing_account_id)` — never two wraps in flight for the same tenant.
  - Idempotency: if the most recent wrap submission for this tenant is younger than ~30s and pending, skip (avoid double-spending gas on a slow chain).

### c. Permission state already exists

`USDC.e.approve(CollateralOnramp, MaxUint256)` is Step 1 of the existing 8-step ceremony, which every active wallet has run at least once. So the app already has on-chain permission to call `CollateralOnramp.wrap(USDC.e, funder, amount)` on the user's behalf. **No new on-chain transaction is needed for the consent step itself** — the consent toggle is purely a server-side gate (the user telling us "yes, you may use the approval you already have to do this for me").

### d. Observability

New event names emitted at INFO/ERROR level on every wrap attempt:

| event                             | level | when                                            |
| --------------------------------- | ----- | ----------------------------------------------- |
| `poly.wallet.auto_wrap.detected`  | info  | poll tick sees `usdcE ≥ floor`, queues a wrap   |
| `poly.wallet.auto_wrap.submitted` | info  | tx submitted, hash logged                       |
| `poly.wallet.auto_wrap.confirmed` | info  | receipt status=success, amount wrapped logged   |
| `poly.wallet.auto_wrap.error`     | error | tx revert / Privy throw / classifier error      |
| `poly.wallet.auto_wrap.skipped`   | info  | balance below floor, or single-flight collision |

Carries `billing_account_id`, `connection_id`, `usdc_e_amount`, `tx_hash` where applicable. Per the bug.0420 envelope convention.

### e. Failure mode boundaries

- **Privy down / signing fails**: error log + transient-failure backoff, do not loop tight.
- **Onramp revert** (e.g. allowance got revoked on Polygonscan): error log surfaces `allowance_revoked` errorCode → operator action; loop continues attempting on the next tick rather than disabling itself.
- **Tenant runs out of POL gas**: error log surfaces `insufficient_gas` → user-actionable. (Tomorrow's gas-funding loop is a separate concern.)
- **Wrap leaves dust** (e.g. user balance changed mid-tx): log `dust_remaining_usdc_e` and continue.

## Out of scope

- Auto-wrapping the **other direction** (pUSD → USDC.e for withdrawal). That's a withdraw flow, separate spec.
- Auto-funding the wallet with POL gas. Different concern; file as task.0xxx-gas-top-up if it bites.
- Cross-tenant batched wraps. Per-tenant only — the consent is per-user, the gas is per-user, the audit trail is per-user.
- task.0421's "Reset Trading Approvals" button. Adjacent but orthogonal: that's for the case where the on-chain approval state has drifted from the DB stamp; this task assumes approvals are healthy and just continually routes USDC.e through.
- bug.0428's redeem-worker pUSD-collateralToken fix. Adjacent but orthogonal: that closes the V2 redeem cycle; this task closes the deposit + V1-redeem cycle.

## Files to touch (rough)

- `nodes/poly/packages/db-schema/src/wallet.ts` (or wherever `poly_wallet_connections` lives) — add `auto_wrap_consent_at TIMESTAMPTZ NULL` + `auto_wrap_floor_usdc_e NUMERIC(18,6) NOT NULL DEFAULT 1.0`. Migration.
- `packages/poly-wallet/src/port/poly-trader-wallet.port.ts` — port already has `submitCollateralWrap`; expose a new `getAutoWrapConsent / setAutoWrapConsent` pair.
- `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — implement consent get/set (DB write) + balance-read accessor (already there as `readPolygonBalances`).
- `nodes/poly/app/src/bootstrap/jobs/auto-wrap.job.ts` — new job, mirrors `copy-trade-mirror.job.ts` structure (setInterval-driven, single-flight per tenant).
- `nodes/poly/app/src/bootstrap/container.ts` — wire the new job at boot, gated like other jobs.
- `nodes/poly/app/src/app/api/v1/poly/wallet/auto-wrap-consent/route.ts` — `POST` (set) / `DELETE` (revoke) tenant-scoped route.
- `packages/node-contracts/src/poly.wallet.auto-wrap-consent.v1.contract.ts` — new Zod contract.
- `nodes/poly/app/src/app/(app)/credits/TradingReadinessSection.tsx` (or sibling) — add the toggle + confirmation copy.
- Tests: component test asserts cross-tenant isolation; unit test on the loop's single-flight + floor logic.

## Validation

**exercise:** on candidate-a, deposit $5 USDC.e to a tenant's funder. Toggle "Auto-convert deposits to trading currency" on the Money page. Within ~60s observe `poly.wallet.auto_wrap.confirmed` in Loki and the funder's pUSD balance increasing by $5.

**observability:**

```logql
{env="candidate-a", service="app"} | json
  | event=~"poly.wallet.auto_wrap.*"
  | billing_account_id="<self>"
```

Should fire `detected → submitted → confirmed` once per drift event. No more `insufficient_balance` mirror failures while USDC.e is sitting in the wallet.

## How to start (next-dev orientation)

Worktree is bootstrapped at `/Users/derek/dev/cogni-template-worktrees/feat-poly-auto-wrap-usdce-to-pusd` (branch `feat/poly-auto-wrap-usdce-to-pusd`). `pnpm install --frozen-lockfile` already ran. `pnpm packages:build` already produced `.d.ts` for downstream typecheck. **Don't re-bootstrap.**

Suggested first three commits in order:

1. **Schema migration** — copy `nodes/poly/app/src/adapters/server/db/migrations/0032_poly_wallet_trading_approvals.sql` as a template; create `0034_poly_wallet_auto_wrap_consent.sql` adding `auto_wrap_consent_at TIMESTAMPTZ NULL` + `auto_wrap_floor_usdc_e NUMERIC(18,6) NOT NULL DEFAULT 1.0` to `poly_wallet_connections`. Update `nodes/poly/packages/db-schema/src/wallet-connections.ts` to match.

2. **Port + adapter** — add `getAutoWrapConsent` / `setAutoWrapConsent` to `packages/poly-wallet/src/port/poly-trader-wallet.port.ts`. Implement on `PrivyPolyTraderWalletAdapter`.

3. **Bootstrap job** — copy `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` shape into `auto-wrap.job.ts`. setInterval-driven, single-flight per `(billing_account_id)`, uses existing `submitCollateralWrap` adapter method.

After those three: contract + route + UI toggle.

## Notes for the implementer

- Don't reinvent the wrap call — `submitCollateralWrap` already exists on the adapter and is what Step 2 of Enable Trading runs.
- Single-flight by `(billing_account_id)` matters because two near-simultaneous wraps would both pull the same USDC.e amount into pUSD and one would revert. Use the existing redeem-pipeline single-flight pattern (DB advisory lock or in-memory `Map<billingAccountId, Promise>` per pod).
- Don't auto-enable. Surprising a user with on-chain transactions they didn't explicitly authorize is a trust-violation, even when the underlying allowance is already granted.
- Log at INFO level on the happy path. This is not noise — operators will want to grep for "did auto-wrap fire today" without reaching for traces.
- Consider rate-limiting at the adapter level (e.g. min 30s between wraps per tenant) to absorb flapping balances and avoid burning gas on dust drift; primary protection is the floor + single-flight.

## PR / Links

- Handoff: [handoff](../handoffs/task.0429.handoff.md)
