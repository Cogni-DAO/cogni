---
id: task.5007
type: task
title: "Poly dashboard — tenant current-position reconciler as DB source of truth"
status: needs_closeout
priority: 0
rank: 1
estimate: 3
created: 2026-05-04
updated: 2026-05-04
summary: "Production showed the wallet summary had about $960 of active Polymarket positions while the dashboard Open tab showed only ledger-derived rows totaling far less. Page-load reads now come from poly_trader_current_positions, and both the background observer and explicit wallet refresh reconcile that table from paginated Polymarket /positions."
outcome: "The dashboard's position MTM, Open positions table, and Markets aggregation all reconcile to the same DB-backed current-position inventory for the signed-in tenant wallet. Page load does not broaden live Polymarket /positions reads; the background observation job and explicit /wallet/refresh path own bounded upstream pagination and freshness."
spec_refs:
  - docs/design/poly-dashboard-market-aggregation.md
  - docs/design/poly-dashboard-balance-and-positions.md
  - docs/design/poly-copy-target-performance-benchmark.md
assignees: []
credit:
project: proj.poly-copy-trading
branch: derekg1729/market-aggregation
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [poly, dashboard, positions, read-model, data-api, p0]
external_refs:
  - .context/poly-dashboard-positions-reconciler-handoff.md
  - work/items/bug.0405.poly-clob-sell-fak-generates-dust.md
---

# task.5007 — Tenant current-position reconciler read model

## Problem

Production on 2026-05-04 showed the tenant trading wallet
`0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` had `387` Polymarket Data API
position rows, `141` positive-value rows, and about `$960.95` total current
position value. Some additional nonzero-share rows may have near-zero current
value. The dashboard execution route logged only `26-28`
`live_positions` because `/api/v1/poly/wallet/execution` was deriving Open rows
from `poly_copy_trade_fills`.

`poly_copy_trade_fills` is provenance and intent history. It is not a canonical
wallet inventory. The current inventory is the paged Polymarket `/positions`
snapshot saved into `poly_trader_current_positions`.

## Current Fact

The background observer does the routine upstream work:

- `runTraderObservationTick` syncs active `poly_wallet_connections` rows into
  `poly_trader_wallets` as `kind='cogni_wallet'`.
- It pages Data API `/positions?sizeThreshold=0&limit=500&offset=N`.
- It upserts `poly_trader_current_positions`.
- It only deactivates missing rows after a complete position poll.

The explicit refresh route now uses the same writer so an agent/user can force
DB-vs-Polymarket reconciliation before reading the dashboard.

## Scope

In:

- Add a reusable reader for the signed-in tenant wallet's active
  `poly_trader_current_positions` rows.
- Rewire `/api/v1/poly/wallet/overview`:
  - `usdc_positions_mtm` comes from current positions.
  - `open_orders` and locked USDC still come from `poly_copy_trade_fills`.
  - freshness metadata reflects the current-position observation timestamp.
- Rewire `/api/v1/poly/wallet/execution`:
  - `live_positions` comes from active, nonzero-share current positions.
  - Current-position rows override stale terminal ledger lifecycle labels; if
    Polymarket still reports shares, the dashboard must show an Open/current
    holding.
  - `closed_positions` and daily trade counts continue to use the ledger.
  - no broad live `/positions` fetch on page load.
- Ensure `market_groups` receives those same `live_positions`, so Open and
  Markets reconcile by construction.
- Surface warnings when the current-position read model is unavailable or stale.
- Reuse the same paginated current-position writer from `/api/v1/poly/wallet/refresh`.
  A complete poll can deactivate missing rows; a partial/page-capped poll must
  not deactivate or close omitted rows.

Out:

- New schema table. Reuse `poly_trader_current_positions`; do not create a
  duplicate tenant inventory table unless the existing observed-wallet model
  proves insufficient.
- Broader Polymarket page-load fetches.
- Hedge/autonomous risk policy changes. Those belong with `bug.0405` and the
  bet-sizer/follow-up policy tasks.

## Validation

- **exercise:** On candidate-a/prod-like data for a tenant wallet with known
  Polymarket positions missing from DB, call `/api/v1/poly/wallet/refresh`,
  then call `/api/v1/poly/wallet/overview` and
  `/api/v1/poly/wallet/execution`. Confirm `overview.usdc_positions_mtm` equals
  the sum of returned `live_positions[].currentValue` within rounding, and the
  Open tab returns all active nonzero-share current-position rows subject only
  to UI pagination. Closed history is allowed to differ from Polymarket current
  inventory; it is ledger history, not the current inventory authority.
- **observability:** Loki for the deployed SHA shows
  `poly.wallet.refresh phase=complete current_positions_complete=true` for the
  tenant wallet request, or
  `poly.trader.observe phase=wallet_ok kind=cogni_wallet positions_complete=true`
  from the background observer before the dashboard request, then
  `feature.poly_wallet_execution.complete` with `live_positions` matching the DB
  current-position count. No route-local broad `/positions` fetch is required.

## Critical Companion

Do not treat this task as a fix for tiny/sub-min positions. That analysis lives
in `bug.0405`. The latest evidence says the read model must be fixed first, but
the execution policy still needs a separate dust/partial-fill guardrail review.
