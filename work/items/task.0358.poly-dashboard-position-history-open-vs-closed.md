---
id: task.0358
type: task
title: "Poly dashboard — open vs closed positions, position history replaces order history"
status: needs_design
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
branch:
pr:
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
