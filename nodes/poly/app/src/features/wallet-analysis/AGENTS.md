# wallet-analysis · AGENTS.md

> Scope: this directory only. Keep ≤150 lines.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Reusable wallet-analysis surface for any Polymarket wallet. Exposes the pure `WalletAnalysisView` organism + molecules, and the shared `WalletAnalysisSurface` client container that owns the standardized page / drawer fetch path, including Polymarket-native P/L.

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

- **Exports:** `WalletAnalysisView`, `WalletAnalysisSurface`, `WalletIdentityHeader`, `StatGrid`, `BalanceBar`, `BalanceOverTimeChart`, `TimeWindowHeader`, `WalletProfitLossCard`, `TradesPerDayChart`, `RecentTradesTable`, `PositionTimelineChart`, `TopMarketsList`, `EdgeHypothesis`, `DistributionsBlock`, type `WalletAnalysisData` and supporting types (`WalletDistributionsViewMode`, `WalletDistributionsRangeMode`). The `PositionsTable` organism lives at `app/(app)/_components/positions-table/` (next to the sibling `wallets-table/`); consumers import from there directly.
- **Routes:** none directly; consumed by `/research`, `/research/w/[addr]` (Checkpoint B), and the dashboard drawer (Checkpoint C).
- **Files considered API:** `index.ts`, `types/wallet-analysis.ts`.

## Responsibilities

- This directory **does**: render wallet-analysis UI from pure props; expose loading skeletons per molecule; provide the shared client container that fetches wallet-analysis slices for page + drawer consumers.
- This directory **does not**: define HTTP routes, talk to adapters directly, or hold state outside the shared client fetch boundary.

## Standards

- Each molecule accepts `{ data, isLoading }` and renders its own skeleton.
- No molecule fetches on its own. `WalletAnalysisSurface` + `useWalletAnalysis` are the single fetch source for the reusable surface.
- All Polymarket Data-API calls flow through `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`. Adding a second client is a review-blocking violation.
- Follow the no-arbitrary-Tailwind-values lint rule: stick to standard utilities or wrap custom values in `var(--token)`.

## Dependencies

- **Internal:** `@/components` (Card, Badge, Separator), `@/shared/util/cn`.
- **External:** react, lucide-react.

## Notes

- `useWalletAnalysis` fans out to `snapshot`, `trades`, `balance`, `pnl`, and (opt-in via `includeDistributions`) `distributions` slices; `WalletAnalysisSurface` threads the selected interval through the page and drawer and only requests `distributions` for the page variant.
- `DistributionsBlock` renders the `distributions` slice as six histograms (DCA depth, trade size, entry price, DCA window, hour-of-day; plus flat event clustering) with a count↔USDC toolbar; per-fill bars are stacked won/lost/pending. The component never recomputes buckets — it renders what the server returned.
- **PnL is owned by the `pnl` slice only** (Polymarket `user-pnl-api`). `WalletProfitLossCard` renders the windowed delta `last.pnl − first.pnl`; `StatGrid` carries trade-derived metrics (winrate, duration, activity) and has no PnL/ROI/drawdown cell. Reintroducing bespoke realized-PnL math on this surface is a review-blocking violation (task.0389).
- Position lifecycle visuals are reusable UI primitives first. Dashboard-specific execution fetching belongs in app routes/services, not on the wallet-analysis public barrel.
- `PositionsTable` accepts `variant?: "default" | "history"`. Default shows Current value + Action columns. History variant shows a Closed timestamp column and omits action buttons — used by the dashboard Position History tab.
