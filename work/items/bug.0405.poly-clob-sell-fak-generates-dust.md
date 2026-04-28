---
id: bug.0405
type: bug
title: "Polymarket CLOB SELL via FAK strands sub-min-order-size dust on every partial fill"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "`PolymarketClobAdapter.sellPositionAtMarket` and `poly-trade-executor.exitPosition` both default to `OrderType.FAK` (Fill-And-Kill). On thin order books — i.e. most Polymarket markets outside the top ~50 — partial fills are the norm: CLOB matches what's available at the inside ask and kills the rest. The killed remainder stays on chain as a position. When that residual is below the market's `min_order_size` (typically 5 shares), the next sell preflight throws `share balance below market floor` and the position is **structurally unsellable** until the market resolves. Multi-tenant redeem (task.0412 / PR #1106) auto-recovers winning-side dust at resolution, but losing-side dust is a write-off and the system generates more on every mirror SELL tick."
outcome: 'After this PR, mirroring a target''s SELL on a thin-liquidity market does NOT leave sub-min residual on chain. Either (a) the FAK leg''s killed remainder is followed by a GTC tail-limit at our worst-acceptable price so the residual eventually exits, or (b) a depth pre-check declines to attempt a size that would partial-fill below floor. The Loki query `{env="production",service="app"} | json | reason=~".*share balance below market floor.*"` trends to zero and the user''s open-position rows do not accumulate stranded dust over multiple mirror-SELL cycles.'
spec_refs:
  - poly-copy-trade-phase1
  - poly-positions
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-clob-sell-fak-dust
created: 2026-04-28
updated: 2026-04-28
deploy_verified: false
labels: [poly, polymarket, clob, sell, fak, dust, copy-trading]
external_refs:
  - work/items/bug.0342.poly-clob-dynamic-min-order-size.md
  - work/items/bug.0329.poly-sell-neg-risk-empty-reject.md
  - work/items/task.0412.poly-redeem-multi-tenant-fanout.md
---

# bug.0405 — Polymarket CLOB SELL via FAK generates dust

> Surfaced 2026-04-28 during candidate-a validation of [task.0412](task.0412.poly-redeem-multi-tenant-fanout.md). Derek's tenant `0x9A9e…160A` had two stuck positions (4.88 shares + 2.20 shares, both `< min_order_size = 5`) on open markets — neither sellable, neither redeemable until resolution.

## Symptom

```
PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor
  (gotShares=4.88, minShares=5, tokenId=98988926036595680874524757369522175158926857952274791209257914378313521382612)

PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor
  (gotShares=2.1978, minShares=5, tokenId=108168321272125351184874253365168267070112746402325926653632248412356285567627)
```

Both surfaced via `route="poly.wallet.positions.close"` on candidate-a (Loki, 2026-04-28T07:57Z and T07:58Z). The user clicked "Close" on the dashboard for each; the route returned 500 with the share-floor error; the positions remained on chain.

## Root cause

`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`:

| Side | OrderType                                                                | Behavior                                               |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| BUY  | `OrderType.GTC` (line 309)                                               | Partial-fill OK; remainder rests on book               |
| SELL | `OrderType.FAK` (line 420 default; line 521 hardcoded in `exitPosition`) | Fill what's available, **kill the unfilled remainder** |

When a SELL FAK lands against a thin orderbook at the inside ask, the killed amount becomes a residual position on chain. Three concrete dust-generation paths:

**Path A — Copy-trade SELL via FAK on thin liquidity (most common).** Target wallet sells N shares; mirror copies the SELL via FAK; CLOB fills only the depth at the inside ask, kills the rest. If the killed residual is below `min_order_size`, the position becomes unsellable.

**Path B — `exitPosition` retry loop hits the floor mid-iteration.** `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:489-522` retries the FAK SELL up to 4×, refreshing `position.size` each iteration. When the residual drops below `min_order_size`, the next iteration's preflight throws → loop exits → dust persists.

**Path C — BUY GTC partial-fill + later cancel.** Less common (GTC remainders rest on the book until filled or explicitly cancelled), but possible if our reconciler or Polymarket cancel an unfilled bid after the orderbook moves past our price.

## Why this isn't covered by existing fixes

- [bug.0342](bug.0342.poly-clob-dynamic-min-order-size.md) (`needs_closeout`) fixed the **BUY** side: the coordinator pre-scales intents up to `min_order_size` or skips. It explicitly couldn't generalize to SELL because (1) you can't refuse to sell what you already hold and (2) you can't scale up beyond your holdings.
- [task.0412](task.0412.poly-redeem-multi-tenant-fanout.md) (multi-tenant redeem, just shipped) auto-recovers **winning-side** dust at market resolution. **Losing-side** dust is a write-off and the system continues generating more on every mirror-SELL tick.
- [bug.0329](bug.0329.poly-sell-neg-risk-empty-reject.md) is a different SELL failure mode (neg-risk empty reject), not dust generation.

## Implementation plan

### Phase A — Stop creating new dust (the high-leverage fix)

Two viable patterns; we ship pattern (1) because it's lower-API-cost and matches existing copy-trade semantics.

**Pattern 1 — FAK + GTC tail-limit residual disposal.**

After every FAK SELL, if `position.size > 0` AND `position.size < min_order_size`:

1. Place a GTC limit-SELL at our worst-acceptable price (configurable; v0 default = `current_best_bid - 1¢` or `0.01` floor, whichever is higher) for the residual amount.
2. Track the resting order in `poly_copy_trade_fills` with status=`open` so the existing reconciler manages it.
3. If the limit fills, residual exits cleanly. If it doesn't, the residual sits as a resting order on chain (not a stranded position) — at resolution it auto-cancels and the underlying shares redeem via task.0412.

**Pattern 2 (deferred) — depth pre-check.** Query `getOrderBook(tokenId)` before SELL; only attempt the portion of the position that has matching ask-side depth at acceptable price; defer the rest to a tail-limit identical to Pattern 1's cleanup. Cleaner correctness, more API calls. Deferred unless Pattern 1 proves insufficient.

### Phase B — Surface remaining dust in the dashboard

Out of scope for this PR — file follow-up. The UI gap (close buttons offered on dust rows that will fail) is a real issue but blocking on solving the source first means we don't churn UI logic against a moving target.

### Files to touch

**Adapter — owns the tail-limit primitive:**

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`
  - Extract a `placeTailLimitSell(tokenId, residualShares, ...) → OrderReceipt` private helper that wraps the existing limit-place flow (`createAndPostOrder` with `OrderType.GTC`).
  - Add a new method `sellPositionAtMarketWithTailLimit(params)` that:
    1. Calls existing FAK SELL (preserving today's preflight).
    2. Re-queries position post-fill.
    3. If residual `> 0` and `< min_order_size`, places `placeTailLimitSell` at `tail_limit_price` (param, defaulted in caller).
    4. Returns combined receipt with both order ids surfaced.
  - Keep the existing `sellPositionAtMarket` as-is — callers that don't want the tail behavior (operator scripts, agent tools) keep direct access.

**Executor — orchestrates the loop:**

- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  - Replace the current 4-iteration `exitPosition` loop with a single FAK + tail-limit call. The loop existed to chase partial fills via repeated FAKs; the tail-limit captures the long-tail residual in one resting order, removing the need for retry.
  - Or, if the loop adds value (multiple full-FAK-min iterations on big positions), keep it but call the tail-limit-aware variant on the final iteration.

**Mirror coordinator — emits the SELL with tail policy:**

- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` (and/or `mirror-coordinator.ts`)
  - When emitting a copy-trade SELL intent, populate `attributes.tail_limit_policy` so the executor knows to apply the tail-limit. Default `tail_limit_policy = "tail_limit_at_floor"` (configurable; off-by-default for non-mirror callers).

**Tests:**

- Unit: `tests/unit/adapters/polymarket-clob-tail-limit.test.ts` — given a fake CLOB client where FAK fills 4.88 of 5, assert `placeTailLimitSell` is called with 0.12 residual and a GTC SELL request lands at the configured tail price.
- Component: extend `tests/component/...` with a fake-CLOB scenario that captures both the FAK and the tail-limit, asserts ledger has both order rows.
- Integration: stack test that mirrors a SELL on a thin-orderbook fake, asserts no `share balance below market floor` errors after one cycle.

### Out of scope

- **Phase B dashboard UI for displaying dust** — file as `task.NNNN.poly-dashboard-stranded-dust-affordance` after this lands.
- **Limit prices below `min_order_size` for opening new positions** — separate question, separate task.
- **bug.0329 neg-risk SELL empty reject** — different failure mode, different bug.
- **Cleanup of existing stranded dust** — once Phase A lands, new dust generation stops; existing dust requires either market resolution (free, automatic via task.0412) or a one-shot operator script. Not blocking this PR.

## Validation

**exercise:**

On candidate-a, against a tenant holding a position large enough to need a partial fill:

1. Trigger a mirror SELL (or call `POST /api/v1/poly/wallet/positions/close`) for a token where the orderbook lacks full depth at the inside ask.
2. Confirm Loki shows two ordered events: `poly.clob.place side=SELL order_mode=market` (FAK) followed by `poly.clob.place side=SELL order_mode=limit` (GTC tail) for the same `client_order_id` family.
3. Confirm `GET /api/v1/poly/wallet/positions` no longer lists the asset (or lists it with `size = 0`) once the tail-limit fills, OR the position shows the tail order as `open` while no longer reporting raw shares < min.
4. Loki at deployed SHA: `event="poly.exit.tail_limit_placed"` (new log emitted by the adapter) shows for the partial-fill cycle.

**observability:**

```logql
# Should trend to zero post-fix
{env="candidate-a",service="app"} | json
  | reason=~".*share balance below market floor.*"

# New event from this PR — should appear on partial fills
{env="candidate-a",service="app"} | json
  | event="poly.exit.tail_limit_placed"

# Existing event for forensics — should still emit but no longer be terminal
{env="candidate-a",service="app"} | json
  | event="poly.clob.place" | side="SELL" | order_mode="market" | phase="ok"
```
