---
id: poly-dashboard-market-aggregation
type: design
title: "Poly Dashboard — Market Aggregation View"
status: draft
created: 2026-05-04
updated: 2026-05-04
---

# Poly Dashboard — Market Aggregation View

## Intent

The dashboard execution card needs two lenses over the same exposure:

- `Open`: raw positions we currently hold.
- `Markets`: event/market aggregation that compares our positions with the
  active copy targets we follow.

The aggregation is a read model, not copy-trade policy. It does not place
orders and does not infer that a copied order came from a specific target fill.

## Data Wiring

Our side is anchored by `poly_copy_trade_fills` through the existing execution
route. Rows are coalesced into `live_positions` by `(conditionId, tokenId)`.

Target overlays come from the observed-trader tables:

- `poly_trader_wallets`: observed wallets, including `copy_target` and
  `cogni_wallet` rows.
- `poly_trader_current_positions`: latest active open positions from
  Polymarket Data API `/positions?sizeThreshold=0`; current target VWAP is
  derived from `cost_basis_usdc / shares` on these rows.
- `poly_trader_fills`: observed trade fills retained for historical trade
  analysis, not the current exposure VWAP.

The observation job polls active research wallets, upserts current positions,
stores changed snapshots, and deactivates stale current-position rows only
after a complete position poll.

## Grouping

`Markets` returns only groups where our wallet has a live position. Positions
are grouped by `eventSlug` when available. If Polymarket does not provide an
event slug, the group falls back to the individual `conditionId`.

Inside a group, each line is a Polymarket condition. That is the current
correlation boundary we can defend from saved facts. Broader semantic
correlation across related lines without shared `eventSlug` is future work and
should use Gamma event metadata, not title matching.

## Hedge Classification

No table stores `is_hedge`.

For a single wallet and condition:

- one active token → that leg becomes the participant's `primary`; `hedge` is
  null.
- two active tokens → the larger cost-basis leg becomes `primary`; the smaller
  becomes `hedge`.

This matches the hedge policy read model: a hedge is a relative second leg in
the same binary condition. The classifier is intentionally current-state only;
it says what the wallet holds now, not why the wallet got there.

## Read-Model Pivot

The read model emits **one row per (wallet, conditionId)** carrying both legs
inline so the dashboard can render value/VWAP/P/L for primary, hedge, and a
combined `net` summary on the same row:

```ts
type WalletExecutionMarketParticipantRow = {
  side: "our_wallet" | "copy_target";
  source: "ledger" | "trader_current_positions";
  label: string;
  walletAddress: string;
  conditionId: string;
  primary: WalletExecutionMarketLeg | null;
  hedge: WalletExecutionMarketLeg | null;
  net: { currentValueUsdc: number; costBasisUsdc: number; pnlUsdc: number };
  lastObservedAt: string | null;
};

type WalletExecutionMarketLeg = {
  tokenId: string;
  outcome: string;
  shares: number;
  currentValueUsdc: number;
  costBasisUsdc: number;
  vwap: number | null;
  pnlUsdc: number;
  lifecycle:
    | "active"
    | "inactive"
    | "resolved"
    | "winner"
    | "loser"
    | "unknown";
};
```

The pivot is intentionally **server-side**: the same shape is what Research
will eventually consume once `poly_market_outcomes` is populated and joined in
to promote `lifecycle: "unknown"` to resolved values. The client never groups
token legs itself.
