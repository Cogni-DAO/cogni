---
id: poly-position-exit
type: spec
title: "Poly Position Exit — authoritative close/redeem semantics + position state model"
status: active
spec_state: active
trust: draft
summary: "User close/redeem flows for Polymarket are grounded in provider and chain authority. This PR ships the Phase 1 correctness path: market close, live approval repair, provider balance/allowance refresh, bounded reconciliation, and dashboard cache eviction. It also defines the position-state split needed for a future readonly MCP tool."
read_when: Designing or reviewing `POST /api/v1/poly/wallet/positions/close`, `.../redeem`, dashboard execution-state refresh, market exit retries, approval readiness, or the future readonly Polymarket position MCP surface.
implements: proj.poly-copy-trading
owner: derekg1729
created: 2026-04-23
verified: 2026-04-23
tags: [poly, exit, wallet, polymarket, clob, integration]
---

# Poly Position Exit

> User-owned position exits are not made synchronous. The contract is: trust the write path for acceptance, treat read models as lagging, and expose position state in a shape that can later map cleanly to a readonly MCP tool.

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
- [MCP Control Plane](./mcp-control-plane.md)
- [Tool Use](./tool-use.md)
- [task.0355](../../work/items/task.0355.poly-trading-wallet-enable-trading.md)
- [task.0357](../../work/items/task.0357.poly-position-exit-authoritative-close-redeem.md)
- [task.0354](../../work/items/task.0354.poly-trading-hardening-followups.md)
- [task.0356](../../work/items/task.0356.poly-wallet-onboarding-trading-e2e-test-suite.md)
- [proj.agentic-interop](../../work/projects/proj.agentic-interop.md)
- [proj.tool-use-evolution](../../work/projects/proj.tool-use-evolution.md)

## Design

### Authority Boundaries

There are four different truth sources, and they are not equal:

1. **Chain / CLOB write path** — authoritative for whether we successfully submitted or filled a close/redeem action.
2. **Polymarket balance/allowance cache (`/balance-allowance`)** — authoritative for what the CLOB currently believes is spendable/approved for the session. This can lag the chain and must sometimes be actively refreshed.
3. **Public Data API** — a lagging read model; useful for discovery and UI refresh, but not for negating a just-accepted write.
4. **Local DB readiness stamp** — a cache/UI signal only; never sufficient as sole proof that live approvals still exist.

### Position State Model

The UI and any future readonly tool must stop treating "position" as one overloaded status flag. There are three different state families:

1. **`live_positions`**
   - Question answered: "What does the wallet currently hold?"
   - Authority: current positions snapshot from Polymarket reads
   - Consumer: dashboard Open positions, close/redeem eligibility checks, wallet totals

2. **`closed_positions`**
   - Question answered: "What positions were opened and later exited?"
   - Authority: trade-derived history, not the current positions endpoint
   - Consumer: future history/analytics views, realized lifecycle reporting

3. **`pending_actions`**
   - Question answered: "What write did our app just submit, and has the lagging read model caught up yet?"
   - Authority: app-owned action state plus provider receipt
   - Consumer: button spinners, reconcile-pending UI, eventual readonly tool status

`live_positions` is the only valid source for an "Open" row. A successful close may leave a short-lived `pending_actions` row, but it must not keep rendering the old holding as open.

### Current As-Built Behavior

The close/redeem correctness path (task.0357):

1. close is a market `FAK` sell of the wallet's current share balance
2. exits ignore grant caps
3. exits re-run `ensureTradingApprovals(...)` and repair the missing neg-risk adapter approval when needed
4. exits refresh Polymarket's `/balance-allowance` cache before sell
5. provider-accepted exits no longer fail just because one immediate `/positions` reread is stale
6. successful close/redeem evicts wallet-scoped execution/read-model cache keys so the next dashboard refetch sees fresh state

The dashboard position-state split (task.0358):

- `GET /api/v1/poly/wallet/execution` now returns `live_positions` (open/redeemable, capped at 18) and `closed_positions` (trade-derived history, capped at 30) as separate contract fields.
- The dashboard execution card renders an "Open" tab from `live_positions` and a "Position History" tab from `closed_positions`.
- CLOB `prices-history` is fetched only for open/redeemable assets; closed positions rely on trade-derived timelines.
- Client-side `recentlyClosedIds` suppresses a just-closed row from "Open" until the next `live_positions` refetch confirms its absence.

The close/redeem HTTP routes still return the receipt-shaped contract on the wire. They do not yet expose typed `exited/submitted/partial` states.

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

### Current HTTP Shape

`POST /api/v1/poly/wallet/positions/close` currently returns the existing receipt shape:

```ts
interface CloseReceipt {
  order_id: string;
  status: string;
  client_order_id: string;
  filled_size_usdc: number;
}
```

`POST /api/v1/poly/wallet/positions/redeem` currently returns:

```ts
interface RedeemReceipt {
  tx_hash: string;
}
```

The important Phase 1 contract is behavioral:

- close/redeem do not self-deny on our own caps
- close does not self-fail on stale Data API rereads
- dashboard refetch after a successful action sees fresh holdings instead of a warm 30 s cache entry

### Follow-On HTTP Shape

The future user route contract should distinguish result states rather than flatten everything into a single receipt:

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

### Future Readonly MCP Surface

The position-state split above is intentionally readonly-first so it can map directly onto a future MCP tool once the MCP control plane work lands.

Proposed eventual tool id:

```txt
mcp:cogni:poly-wallet-position-state
```

Proposed output shape:

```ts
interface PolyWalletPositionStateToolOutput {
  capturedAt: string;
  sourceAuthority: {
    livePositions: "data-api";
    closedPositions: "trade-history";
    pendingActions: "app-write-model";
  };
  live_positions: ReadonlyArray<{
    token_id: string;
    condition_id: string;
    outcome: string;
    shares: number;
    current_value_usdc: number;
    close_allowed: boolean;
    redeem_allowed: boolean;
  }>;
  closed_positions: ReadonlyArray<{
    position_id: string;
    condition_id: string;
    opened_at: string;
    closed_at: string;
    realized_pnl_usdc: number;
  }>;
  pending_actions: ReadonlyArray<{
    kind: "close" | "redeem";
    state: "submitted" | "reconciling";
    token_id?: string;
    condition_id?: string;
    provider_ref: string;
  }>;
  warnings: ReadonlyArray<{ code: string; message: string }>;
}
```

This tool shape depends on the general MCP infrastructure from [MCP Control Plane](./mcp-control-plane.md) and [Tool Use](./tool-use.md), but the domain split belongs here so the future tool does not have to rediscover the semantics.

## Implementation Notes

- Prefer reusing `ensureTradingApprovals(...)` for user exits because it already performs live reads and is idempotent.
- After approvals are good on-chain, refresh Polymarket's `/balance-allowance` cache on the exit path before market SELL. Candidate-a proved the provider can still reject with `allowance: 0` even when our live chain reads show the spender approved.
- Keep Data API for position discovery and follow-up UI refresh, but do not let it serve as the single write acknowledgement.
- If the common case can be collapsed to `state=exited` with a short bounded reconciliation window, do that. Otherwise return `state=submitted`.
- For redeem, the eventual target is an on-chain preflight/read instead of a pure Data API `redeemable` gate.
- The readonly/MCP-facing position model should be implemented as a projection over `live_positions`, `closed_positions`, and `pending_actions`, not as one merged `status` field.

## Test Matrix

- allowance drift after a previously stamped `tradingApprovalsReadyAt`
- provider cache drift where on-chain allowances are maxed but Polymarket still reports `allowance: 0` until `/balance-allowance/update`
- neg-risk exit requiring adapter spender approval
- market exit accepted/filled while `/positions` still shows the old size
- partial fill with real progress
- partial/no-progress due no bid liquidity or market minimum
- redeem success with POL gas present and no cap interference
- dashboard refetch after successful close/redeem showing the updated `live_positions` set instead of a stale execution cache row
