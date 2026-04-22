# wallet-analysis · AGENTS.md

> Scope: this directory only. Keep ≤150 lines.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Reusable wallet-analysis surface — one organism (`WalletAnalysisView`) and reusable molecules for any Polymarket wallet's analysis (identity, snapshot metrics, balance bar, balance-over-time chart, trades-per-day chart, recent trades, positions table, top markets, edge hypothesis).

Shared shape `WalletAnalysisData` mirrors the v1 wallet-analysis HTTP contract that ships in Checkpoint B.

## Pointers

- [App AGENTS.md](../../app/AGENTS.md)
- [Design](../../../../../docs/design/wallet-analysis-components.md)
- [Work item](../../../../../work/items/task.0329.wallet-analysis-component-extraction.md)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["shared", "components", "contracts"],
  "must_not_import": ["app", "adapters", "core", "ports"]
}
```

## Public Surface

- **Exports:** `WalletAnalysisView`, `WalletIdentityHeader`, `StatGrid`, `BalanceBar`, `BalanceOverTimeChart`, `TradesPerDayChart`, `RecentTradesTable`, `PositionsTable`, `PositionTimelineSparkline`, `TopMarketsList`, `EdgeHypothesis`, `derivePositionsFromCopyTradeOrders`, `deriveBalanceHistoryFromCopyTradeOrders`, type `WalletAnalysisData` and supporting types.
- **Routes:** none directly; consumed by `/research`, `/research/w/[addr]` (Checkpoint B), and the dashboard drawer (Checkpoint C).
- **Files considered API:** `index.ts`, `types/wallet-analysis.ts`.

## Responsibilities

- This directory **does**: render wallet-analysis UI from pure props; expose loading skeletons per molecule.
- This directory **does not**: fetch data, talk to APIs, hold state beyond pure prop derivation.

## Standards

- Each molecule accepts `{ data, isLoading }` and renders its own skeleton.
- No molecule fetches on its own. The owning page or `useWalletAnalysis` hook (Checkpoint B) is the single fetch source.
- All Polymarket Data-API calls flow through `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`. Adding a second client is a review-blocking violation.
- Follow the no-arbitrary-Tailwind-values lint rule: stick to standard utilities or wrap custom values in `var(--token)`.

## Dependencies

- **Internal:** `@/components` (Card, Badge, Separator), `@/shared/util/cn`.
- **External:** react, lucide-react.

## Notes

- `useWalletAnalysis` hook + the data plane (snapshot table, API route, dynamic page) ship in Checkpoint B. Today some components are still fed via hardcoded or derived data on `/research`.
- Drawer + compact variants ship in Checkpoint C.
- Position lifecycle visuals and balance-history charts are reusable UI primitives first; their real data slices can land in follow-up dashboard work without redesigning the view layer.
