---
id: poly-position-exit
type: spec
title: "Poly Position Exit — authoritative close/redeem semantics"
status: draft
spec_state: proposed
trust: draft
summary: User close/redeem flows for Polymarket must be grounded in authoritative provider and chain state. Close uses market SELL plus provider balance/allowance cache refresh plus bounded reconciliation; redeem is on-chain; internal caps never block either path.
read_when: Designing or reviewing `POST /api/v1/poly/wallet/positions/close`, `.../redeem`, market exit retries, approval readiness, or the Polymarket read/write boundary.
implements: proj.poly-copy-trading
owner: derekg1729
created: 2026-04-23
verified: 2026-04-23
tags: [poly, exit, wallet, polymarket, clob, integration]
---

# Poly Position Exit

> Proposed spec for user-owned position exits. The goal is not to make Polymarket synchronous; the goal is to stop our code from inventing failures when the provider has already accepted or filled the exit.

## Goal

Define clean semantics for user-driven position exits:

- **Close** = market SELL of the user's current share balance while the market is still live
- **Redeem** = on-chain `redeemPositions` after market resolution

The system must use authoritative external state for writes, treat read models as lagging, and never apply our own grant caps to user exits.

## Non-Goals

- Solving market liquidity. If there are no bids or the remaining balance falls below the market minimum, the system must surface that explicitly rather than pretending success.
- Adding a background workflow or queue just for exit reconciliation. Reuse the existing HTTP + adapter + executor path.
- Changing mirror-pipeline SELL semantics in this task. This spec is about the user exit surface first.

## References

- [Poly Trader Wallet Port](./poly-trader-wallet-port.md)
- [Architecture](./architecture.md)
- [task.0355](../../work/items/task.0355.poly-trading-wallet-enable-trading.md)
- [task.0357](../../work/items/task.0357.poly-position-exit-authoritative-close-redeem.md)

## Design

### Authority Boundaries

There are four different truth sources, and they are not equal:

1. **Chain / CLOB write path** — authoritative for whether we successfully submitted or filled a close/redeem action.
2. **Polymarket balance/allowance cache (`/balance-allowance`)** — authoritative for what the CLOB currently believes is spendable/approved for the session. This can lag the chain and must sometimes be actively refreshed.
3. **Public Data API** — a lagging read model; useful for discovery and UI refresh, but not for negating a just-accepted write.
4. **Local DB readiness stamp** — a cache/UI signal only; never sufficient as sole proof that live approvals still exist.

### Close Flow

1. Discover the candidate position by `token_id`.
2. Revalidate trading approvals against the full pinned target set before placing the exit.
3. Refresh Polymarket's own balance/allowance cache for both:
   - `COLLATERAL`
   - `CONDITIONAL` on the token being exited
4. Submit market `FAK` SELL for the current share balance.
5. Normalize the provider response into a typed exit result.
6. Run bounded reconciliation:
   - short polling/backoff is allowed
   - stale read-model data may keep the result at `submitted`
   - stale read-model data must not cause `502 close_failed`

### Redeem Flow

Redeem is a separate path:

- no grant caps
- on-chain transaction is the write-path authority
- Data API `redeemable` is advisory, not the final correctness boundary

## Invariants

- `USER_EXITS_IGNORE_GRANT_CAPS`
  User close/redeem paths do not apply `perOrderUsdcCap`, daily caps, or hourly fill caps.

- `EXIT_READINESS_IS_LIVE`
  Exit readiness is validated from the pinned approval target set on live chain reads. `trading_approvals_ready_at` may cache success for UI/status, but it is not authoritative for user exits.

- `PROVIDER_BALANCE_ALLOWANCE_CACHE_IS_REAL`
  On-chain approval truth is necessary but not sufficient for close. If Polymarket's own balance/allowance cache is stale, the exit path must refresh that provider cache before treating an allowance rejection as final.

- `PROVIDER_WRITE_ACK_BEATS_LAGGING_READ_MODEL`
  A successful or accepted CLOB response cannot be invalidated solely by one immediate Data API `/positions` reread.

- `EXIT_TYPES_MATCH_EXECUTION_UNITS`
  Share-based market exits use explicit share-grounded domain types. The system does not overload USDC-notional order types in ways that hide execution semantics.

- `RETRY_ONLY_SAFE_PROVIDER_ERRORS`
  Only transient provider/network failures are retryable. Auth/approval/validation failures are surfaced as typed errors without blind retries.

- `PARTIAL_EXITS_ARE_EXPLICIT`
  If a bounded retry/reconciliation window ends with remaining shares, the API returns a typed partial/incomplete state. It does not emit a generic `close_failed`.

- `REDEEM_AUTHORITY_IS_CHAIN`
  Redeem correctness is grounded in chain state and transaction receipt, not only in Data API booleans.

## API Shape

The user route contract should distinguish result states rather than flatten everything into a single receipt:

```ts
type CloseState = "exited" | "submitted" | "partial";

interface ClosePositionResult {
  state: CloseState;
  order_id: string;
  client_order_id: string;
  shares_requested: number;
  shares_filled: number;
  proceeds_usdc: number;
  remaining_shares?: number;
}
```

Provider-grounded failures should map to a small typed taxonomy, e.g.:

- `approval_missing`
- `below_market_min`
- `no_position_to_close`
- `no_bid_liquidity`
- `provider_error`
- `network_error`

## Implementation Notes

- Prefer reusing `ensureTradingApprovals(...)` for user exits because it already performs live reads and is idempotent.
- After approvals are good on-chain, refresh Polymarket's `/balance-allowance` cache on the exit path before market SELL. Candidate-a proved the provider can still reject with `allowance: 0` even when our live chain reads show the spender approved.
- Keep Data API for position discovery and follow-up UI refresh, but do not let it serve as the single write acknowledgement.
- If the common case can be collapsed to `state=exited` with a short bounded reconciliation window, do that. Otherwise return `state=submitted`.
- For redeem, the eventual target is an on-chain preflight/read instead of a pure Data API `redeemable` gate.

## Test Matrix

- allowance drift after a previously stamped `tradingApprovalsReadyAt`
- provider cache drift where on-chain allowances are maxed but Polymarket still reports `allowance: 0` until `/balance-allowance/update`
- neg-risk exit requiring adapter spender approval
- market exit accepted/filled while `/positions` still shows the old size
- partial fill with real progress
- partial/no-progress due no bid liquidity or market minimum
- redeem success with POL gas present and no cap interference
