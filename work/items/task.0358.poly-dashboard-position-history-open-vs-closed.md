---
id: task.0358
type: task
title: "Poly dashboard — open vs closed positions, position history replaces order history"
status: done
priority: 1
rank: 3
estimate: 3
created: 2026-04-23
updated: 2026-04-23
summary: "Replace the dashboard execution card's user-facing 'order history' mental model with the actual thing users care about: current open positions plus a real closed-position history. Build the UI and read model around the position-state split established during task.0357: `live_positions`, `closed_positions`, and `pending_actions`."
outcome: "On the Money/dashboard surface, users see a clean separation between what they currently hold and what they already exited or redeemed. A successful close removes the row from Open promptly, and the history tab shows the closed lifecycle record instead of a generic order log."
spec_refs:
  - docs/spec/poly-position-exit.md
  - docs/design/poly-dashboard-balance-and-positions.md
  - docs/design/wallet-analysis-components.md
assignees: []
credit:
project: proj.poly-copy-trading
branch: design/task-0358-position-history-ui
pr: https://github.com/Cogni-DAO/node-template/pull/1009
reviewer:
revision: 0
blocked_by:
labels: [poly, ui, dashboard, positions, history, wallet-analysis]
external_refs:
---

# task.0358 — Poly dashboard position history

## Problem

The current dashboard execution surface still carries the wrong user concept in two ways:

1. it treats "order history" as a primary user-facing artifact, even though users think in positions
2. it still lacks a first-class split between what is **currently open** and what is **already closed/redeemed**

This was acceptable while task.0357 was fixing correctness and close/redeem behavior, but it is no longer the right UI once a real close path exists. A user who clicks Close expects one thing:

- the row disappears from **Open**
- the lifecycle appears in **History**

That is a position model, not an order-log model.

The design direction is already established:

- [poly-position-exit.md](../../docs/spec/poly-position-exit.md) defines the authority split and readonly-first state shape:
  - `live_positions`
  - `closed_positions`
  - `pending_actions`
- [poly-dashboard-balance-and-positions.md](../../docs/design/poly-dashboard-balance-and-positions.md) explicitly says not to mutate Active Orders into Positions, and says history should be a sibling tab
- [dashboard-position-visuals-recovery-2026-04-22.md](../handoffs/dashboard-position-visuals-recovery-2026-04-22.md) preserves the earlier chart/model work and fixture choices

This task turns that direction into the actual dashboard UX.

## Scope

In:

**Position-state UX**

- Replace the execution card's user-facing tab model with:
  - `Open Positions`
  - `Position History`
- Remove or demote the current user-facing `Order History` tab from this surface. If raw orders still matter for debugging, they belong behind a narrower diagnostics affordance, not as the main end-user history view.
- Keep the close/redeem button logic attached only to `Open Positions`.
- Show a short-lived `closing` / `redeeming` pending state from app-owned action state when appropriate; do not leave stale "open" rows visible once the close succeeded.

**Read-model split**

- Extend the dashboard execution/read model so it can serve:
  - `live_positions`: current holdings only
  - `closed_positions`: lifecycle history reconstructed from trades (and redeem events where available)
  - `pending_actions`: recent app-owned write/reconcile state for UI continuity
- Do not overload one merged `status` field to represent all three concerns.
- Keep `live_positions` authoritative for the Open tab. Closed rows must come from trade-derived lifecycle history, not from `/positions`.

**UI details**

- The Open tab should show only currently held positions.
- The Position History tab should show closed/redeemed positions with:
  - market / outcome
  - opened at / closed at
  - held duration
  - realized P/L
  - lifecycle sparkline or timeline only if honest data exists
- If the current table shell can support both tabs cleanly, reuse it. If not, split into two table views rather than cramming both into one leaky abstraction.

**Boundaries**

- Keep Polymarket reads in the existing market-provider clients and wallet-analysis/dashboard services. No route-local `fetch`.
- Keep reusable wallet-analysis UI components pure-prop.
- If a new contract is needed for execution/history output, update the contract first and flow types from there.

Out:

- A general-purpose audit/debug orders screen
- Rewriting the full wallet-analysis drawer/page history model
- Adding a brand-new MCP tool in this PR
- Perfect realized P/L semantics for every historical edge case if that requires a larger accounting design; surface honest partials rather than guessing

## Validation

- **exercise:** on `candidate-a`, with a wallet that has at least one live position and one recently closed/redeemed position:
  1. load the dashboard / money execution surface
  2. verify the `Open Positions` tab contains only currently held rows
  3. verify the `Position History` tab contains previously closed/redeemed rows rather than raw order events
  4. close one live position and confirm it leaves Open promptly and appears in Position History after reconcile
- **observability:** Loki at the deployed SHA shows the close/redeem request and the succeeding dashboard refresh; there is no stale Open row caused by reusing a warmed execution cache after the successful write.

## Notes For The Next Agent

- Start from the merged `task.0357` behavior, not from pre-fix assumptions.
- Do not bring back the old "orders-first" mental model.
- The clean domain contract is already spelled out in [poly-position-exit.md](../../docs/spec/poly-position-exit.md). Use it.
- Read these first:
  - [poly-position-exit.md](../../docs/spec/poly-position-exit.md)
  - [poly-dashboard-balance-and-positions.md](../../docs/design/poly-dashboard-balance-and-positions.md)
  - [dashboard-position-visuals-recovery-2026-04-22.md](../handoffs/dashboard-position-visuals-recovery-2026-04-22.md)
  - [task.0357](./task.0357.poly-position-exit-authoritative-close-redeem.md)
  - [task.0329](./task.0329.wallet-analysis-component-extraction.md)
  - [task.0346](./task.0346.poly-wallet-stats-data-api-first.md)

Suggested branch name:

- `design/task-0358-position-history-ui`

Suggested first command:

- `/design task.0358`

---

## Design

### Outcome

Users see a clean "Open Positions" / "Position History" split on the dashboard execution card: live holdings with close/redeem actions on the first tab, closed/exited positions with realized P/L on the second tab, replacing the current raw copy-trade order log.

### Approach

**Solution**: Split the contract's single `positions` array into `live_positions` + `closed_positions` at the service layer, then wire the UI tabs directly to each array.

The domain split is already fully computed by `mapExecutionPositions` — every position already carries `status: "open" | "closed" | "redeemable"`. The only missing pieces are:

1. A contract-level split so separate per-tab limits can be applied (avoiding the 18-row total cap cutting off closed history when many open positions exist).
2. A UI rename from "Positions / History (orders)" to "Open / History (closed positions)".
3. Client-side pending suppression: after a successful close, exclude the just-closed row from the Open tab until the refetched `live_positions` no longer contains it (per-item eviction, not clear-whole-set).
4. CLOB price history fetched only for `live_positions` — closed positions have a complete timeline from trades; CLOB history adds no P/L correctness for closed rows.

**Reuses**:

- `mapExecutionPositions` in `packages/market-provider` — already computes status correctly; no change needed
- `PositionsTable` — reused for both tabs; history tab passes `variant="history"` to swap "Current/Action" columns for "Closed At"
- `invalidateWalletAnalysisCaches` — already called on close/redeem success; evicts server-side process cache
- `positionAction` mutation + query invalidation pattern — already in `ExecutionActivityCard`; extend with per-item `recentlyClosedIds` eviction

**Rejected**:

- Keep raw order log as "History" — orders are copy-trade pipeline artifacts, not user-facing position history
- Single `positions` array + UI filter — 18-row total cap starves closed history when many open positions exist
- Add server-side `pending_actions` to contract — client-side `recentlyClosedIds` set handles UI continuity without a backend change
- Fetch CLOB history for closed positions — closed timelines are fully determined by trade events; no additional accuracy from market price history

**`recentlyClosedIds` correctness**: The set uses per-item eviction. On mutation success, add `positionId` to the set. On each successful `live_positions` refetch, remove any id that is no longer present in the returned `live_positions`. Do not clear the whole set on a successful query — that reintroduces the stale row during Data API lag windows.

**`PositionsTable` history variant**: The existing `PositionsTable` columns (Current $, Action) don't make sense for closed rows. Pass `variant="history"` to replace those two columns with "Closed" (timestamp). This is a prop addition to `PositionsTable`, no new component needed.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] `LIVE_POSITIONS_ONLY_IN_OPEN_TAB`: The "Open" tab renders only from `live_positions` (status `open` or `redeemable`). Closed rows must never appear there, even transiently.
- [ ] `CLOSE_BUTTON_ONLY_ON_OPEN_TAB`: Close/Redeem action buttons are attached to the Open tab only. The History tab renders `variant="history"` — read-only, no action column.
- [ ] `NO_STALE_OPEN_ROW_AFTER_CLOSE`: After a successful close mutation, `positionId` is added to `recentlyClosedIds`. It is removed from the set only when the refetched `live_positions` no longer contains that id. The set is never cleared wholesale.
- [ ] `SEPARATE_LIMITS`: Service applies `EXECUTION_OPEN_LIMIT` (18) for `live_positions` and `EXECUTION_HISTORY_LIMIT` (30) for `closed_positions` independently.
- [ ] `CLOB_HISTORY_OPEN_ONLY`: CLOB `getPriceHistory` is fetched only for open/redeemable positions. Closed positions use trade-derived timelines only.
- [ ] `CONTRACT_FIRST`: Contract is updated before route and UI. The `positions` field is removed; callers use `live_positions` and `closed_positions`.
- [ ] `NO_ROUTE_LOCAL_FETCH`: All Polymarket reads stay in `packages/market-provider` clients via the service layer.
- [ ] `NO_DEAD_CODE`: `fetchOrders` and `HistoryPanel` are deleted, not commented out or kept as dead imports.
- [ ] `ARCHITECTURE_ALIGNMENT`: Contract in `packages/node-contracts`, mapping in `packages/market-provider`, service in `features/wallet-analysis/server`, UI in dashboard `_components`.

### Files

**Contract** (`packages/node-contracts`)

- Modify: `src/poly.wallet.execution.v1.contract.ts` — remove `positions`, add `live_positions: z.array(WalletExecutionPositionSchema)` and `closed_positions: z.array(WalletExecutionPositionSchema)`

**Service** (`nodes/poly/app/src/features/wallet-analysis/server`)

- Modify: `wallet-analysis-service.ts` — in `getExecutionSlice`, split `mapped` by status: open/redeemable → `livePositions` (capped at `EXECUTION_OPEN_LIMIT = 18`), closed → `closedPositions` (capped at `EXECUTION_HISTORY_LIMIT = 30`). Fetch CLOB price history for `livePositions` only. Return `live_positions` + `closed_positions`.

**Route** (`nodes/poly/app/src/app/api/v1/poly/wallet/execution`)

- Modify: `route.ts` — update `emptyPayload` to use `live_positions: []` + `closed_positions: []`

**Wallet-analysis components** (`nodes/poly/app/src/features/wallet-analysis/components`)

- Modify: `PositionsTable.tsx` — add optional `variant?: "default" | "history"` prop. In history variant: replace "Current" column with "Closed" (formatted `closedAt` timestamp), omit the Action column entirely.

**Dashboard UI** (`nodes/poly/app/src/app/(app)/dashboard/_components`)

- Modify: `ExecutionActivityCard.tsx` — rename tabs to "Open" / "History"; map `executionData.live_positions` → `openPositions`; map `executionData.closed_positions` → `closedPositions`; implement per-item `recentlyClosedIds` eviction (add on mutation success, remove per-id on successful refetch); replace `HistoryPanel` with `ClosedPositionsPanel` using `PositionsTable variant="history"` with no `onPositionAction`.
- Delete: `fetchOrders` import and query, `HistoryPanel` component, `HISTORY_FILTERS`, `HISTORY_STATUS_BUCKETS`, `OrdersStatusFilter` import, `historyFilter` state.

**Dashboard API** (`nodes/poly/app/src/app/(app)/dashboard/_api`)

- Delete: `fetchOrders.ts` — no longer wired anywhere; delete the file per CLAUDE.md "delete unused code" rule.

**Tests**

- Create: `nodes/poly/app/tests/unit/features/wallet-analysis/wallet-analysis-service.test.ts` — unit test `getExecutionSlice` split: `live_positions` ≤ 18 open/redeemable, `closed_positions` ≤ 30 closed; CLOB history only fetched for open assets.
