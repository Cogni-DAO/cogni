---
id: poly-dashboard-balance-and-positions
type: design
title: "Poly Dashboard — Balance History + Position Visuals"
status: draft
spec_refs:
  - docs/design/wallet-analysis-components.md
  - work/items/task.0346.poly-wallet-stats-data-api-first.md
created: 2026-04-22
updated: 2026-04-22
---

# Poly Dashboard — Balance History + Position Visuals

## Current inventory

Snapshot taken from fresh `origin/main` at commit `d4cd4db09` on 2026-04-22.

- `/dashboard` top fold currently renders `OperatorWalletCard`, `OrderActivityCard`, `WalletQuickJump`, and `CopyTradedWalletsCard`.
- There is **no** existing "trade volume over the time frame" card on current `main`. The closest reusable chart molecules today are `TradesPerDayChart` in `features/wallet-analysis` and `ActivityChart` in `components/kit/data-display`.
- The reusable wallet-analysis surface already owns `BalanceBar`, `TradesPerDayChart`, `WalletDetailDrawer`, and `WalletAnalysisView`.
- The chart stack is already standardized on `recharts` plus `components/vendor/shadcn/chart.tsx`.
- Polymarket data channels are already split in the codebase:
  - Data API = leaderboard, `/trades`, `/positions`, `/activity`
  - CLOB public = market resolution only
  - Signed CLOB = operator open orders, locked balance, and execution

## Library decision

Do **not** add Tremor for this work.

- We already ship `recharts` + shadcn chart wrappers on `main`.
- The new dashboard visuals need custom lifecycle markers, dense row-level sparklines, and palette continuity with the existing app.
- Tremor would add a second charting abstraction and another opinionated styling layer without solving the hard part, which is the wallet/position data model.

Use this split instead:

- Card-scale charts: `recharts` through `components/vendor/shadcn/chart.tsx`
- Row-scale micro-visuals: inline SVG components
- Shared shells: existing `Card`, `Table`, `ToggleGroup`, `Badge`

## First-class position

A "position" must stop meaning "whatever `/positions` happens to return today."

For dashboard and wallet-analysis UI, a position is:

- keyed by `(conditionId, asset)`
- opened by the first net-positive exposure
- mutated by later adds / reductions on the same outcome token
- still `open` while net size is positive
- `closed` once net size returns to zero or the market resolves / redeems out

This gives us one honest row model for open, exiting, and closed positions.

## Immediately needed components

### 1. Balance over time

Use a new `BalanceOverTimeChart` molecule, then compose it into a future `BalanceHistoryCard`.

- Input: `WalletBalanceHistoryPoint[]`
- Render tech: `recharts` `AreaChart`
- Placement: directly above the current orders card on `/dashboard`
- Reuse target: dashboard, wallet drawer, full wallet page

Why this shape:

- `BalanceBar` is a point-in-time snapshot.
- The dashboard needs the trend card to answer "are we compounding or bleeding?"
- Keeping the chart molecule separate from the card shell lets us reuse it inside the wallet-analysis page later.

### 2. Position table upgrade

Do **not** mutate `Active Orders` into `Positions`. Orders and positions are different entities.

Instead add:

- `PositionTimelineSparkline` molecule
- `PositionsTable` organism

`PositionTimelineSparkline` responsibilities:

- normalize one row's lifecycle into a compact line
- draw entry marker as blue vertical bar
- draw current/open marker as green
- draw close marker as green or red depending on realized outcome

`PositionsTable` responsibilities:

- market / outcome / side labeling
- sparkline cell
- current value column
- `P/L` dollar column
- `P/L %` column
- `Held` column formatted as `holding (x hr) N min` or `held (x hr) N min`

## Data mapping

### Balance history

V0 can be honest and useful without pretending we already have full historical marks.

- Source of truth: Data API trades + current positions MTM
- V0 curve: deterministic wallet-equity series derived from trade cashflows and current mark-to-market
- Labeling rule: if unresolved historical marks are synthetic, say so in the UI or docs

### Positions

Build positions from a joined view, not a single endpoint.

- Data API `/trades`: lifecycle, entry/exit timestamps, per-trade marker events
- Data API `/positions`: current size, current value, `cashPnl`, `percentPnl`
- CLOB public: optional resolution help when a market has settled but the row still needs final outcome labeling

Important constraint on current `main`:

- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` explicitly treats `/positions` as **open positions only**
- so close markers and held duration for closed rows must be derived from the trade feed

## Recommended rollout

1. Finish `task.0346` so windowed stats are authoritative and named correctly as Data-API-first.
2. Add a new wallet-analysis `positions` slice that joins trades + positions into the first-class row model above.
3. Add a new wallet-analysis `balanceHistory` slice for the balance-over-time chart.
4. Wire `BalanceOverTimeChart` above the dashboard orders card.
5. Add a separate `PositionsCard` below it, rather than overloading `Active Orders`.
6. Later, reuse the same components inside the drawer and `/research/w/[addr]`.

## Reuse rules

- Keep all Polymarket reads in `packages/market-provider` clients plus feature services. No route-local `fetch`.
- Keep all wallet-analysis UI pure-prop and slice-driven. No component fetches.
- Keep row sparklines SVG-based. A full chart instance per table row is wasted work.
- Keep the dashboard on the existing chart stack. No Tremor unless we decide to replace the app-wide chart primitives, which this work does not justify.
