---
id: task.0389
type: task
title: "Poly wallet research — single-source PnL via Polymarket user-pnl-api"
status: done
revision: 1
reviewer: derekg1729
priority: 1
rank: 5
estimate: 2
branch: design/task-0387-pnl-single-source
summary: "Stop computing realized PnL / ROI / drawdown ourselves on the wallet research snapshot card. Reuse the existing PnL slice (Polymarket `user-pnl-api`) — already in the route, already coalesced, already independently fetched on the client — as the single PnL source. Drop five naive-math fields (`realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`) from the wallet-analysis snapshot contract. `computeWalletMetrics` keeps producing wins/losses/winrate/duration/topMarkets/etc; only its PnL outputs leave the display path."
outcome: "The wallet research snapshot card displays one PnL number per window: the windowed delta of Polymarket's user-pnl series (`last.p − first.p`). It reconciles with the chart by construction — same upstream call, same window, same Zod-validated array. New wallets work the moment Polymarket indexes them. No new cache layer, no new port, no new domain logic — five-field deletion + one client mapping change."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
pr: https://github.com/Cogni-DAO/node-template/pull/1079
created: 2026-04-26
updated: 2026-04-27
labels: [poly, polymarket, wallet-research, pnl, simplification, performance]
external_refs:
  - nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts
  - nodes/poly/app/src/features/wallet-analysis/server/trading-wallet-overview-service.ts
  - nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts
  - packages/market-provider/src/adapters/polymarket/polymarket.user-pnl.client.ts
  - packages/market-provider/src/analysis/wallet-metrics.ts
  - packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
---

# task.0389 — Single-source PnL via Polymarket user-pnl-api

> Filed 2026-04-26 after critical analysis of "wallet research stats for time windows are consistently wrong." Root cause is not an upstream bug — it is that we render two PnL numbers with two different definitions side-by-side and they disagree.

## Context

The wallet research surface computes PnL **twice**, with **two incompatible definitions**:

1. **Snapshot card** (`getSnapshotSlice` in [`wallet-analysis-service.ts:178`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts)) runs `computeWalletMetrics(trades, resolutions)` over up-to-500 Data-API trades plus one CLOB `getMarketResolution()` call per unique conditionId. Output: `realizedPnlUsdc` — realized only, no MTM, no FIFO, naive `Σbuy − Σsell` per asset ([`wallet-metrics.ts:95–167`](../../packages/market-provider/src/analysis/wallet-metrics.ts)). Rendered at [`use-wallet-analysis.ts:167`](../../nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts) as the headline "PnL" on the card.
2. **PnL chart slice** (`getPnlSlice` in [`wallet-analysis-service.ts:256`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts)) calls Polymarket's native `user-pnl-api` via `PolymarketUserPnlClient.getUserPnl()` — the same series that powers Polymarket's own UI.

The two cannot reconcile: realized-only vs Polymarket's curve, 500-trade cap vs full history, naive cost basis vs whatever lot-tracking Polymarket runs. Users see the disagreement and call the page "wrong."

A reconstruction approach is the wrong direction:

- Polymarket's number **is** the canonical signal. Every leaderboard, profile page, and target's self-evaluation reads from this same upstream. Reconciling against it is pointless.
- A faithful reconstruction needs FIFO + MTM + neg-risk + fees + deposits — every one of those is bespoke logic with its own bug class.
- The current snapshot fan-out (1 trades fetch + N market-resolution fetches) is already too slow for a discovery use case that must scale to "any wallet I just typed in."

## Upstream semantics (verified 2026-04-26)

`https://user-pnl-api.polymarket.com/user-pnl?user_address=…&interval=1d|1w|1m|all` returns `[{t, p}, …]`.

- **`interval` controls the start of the window, not the end.** `series[last]` is the wallet's lifetime cumulative PnL as of now, regardless of `interval`. `series[first]` shifts with the window.
- Empirically (3 active wallets sampled): `series[last].p` is identical across `interval=1d|1w|all` for the same wallet at the same moment.
- **The "windowed PnL" the user expects is therefore `series[last].p − series[first].p`** — the change in cumulative PnL over the window. For `interval=all`, `series[first].p` is the wallet's earliest indexed point (typically near zero), so `last − first ≈ last`.
- Empty array means Polymarket has no PnL points indexed for this wallet at the requested window. Surface as "—", not zero.

## Goal

Make Polymarket's `user-pnl-api` the **only** PnL source for the wallet research surface. Render one labeled PnL number per window — the windowed delta of the upstream series — and remove the bespoke realized-PnL/ROI/drawdown fields that disagree with the chart.

## Non-goals

- Local PnL reconstruction (FIFO / lot tracking / MTM). The wrong direction; if Phase-4 ranking (task.0322) needs counterfactual PnL net of slippage + fees, that math lives in the ranker, not the display path.
- Replacing the snapshot's other metrics (wins, losses, winrate, duration, topMarkets, daily counts). They aren't PnL and don't collide with the chart.
- Changing the PnL chart. Already correct.
- Reconciling Polymarket's number against on-chain truth. v0/v1 trusts upstream.
- Reducing the per-market resolution fan-out feeding wins/losses. Separate concern; the PnL change here doesn't depend on it.
- Top-wallets sort key. `/api/v1/poly/top-wallets` already calls `walletCapability.listTopTraders` (Polymarket leaderboard endpoint, not our metrics) — no change needed there.

---

## Design

### Outcome

A user opening the wallet research card on any Polymarket wallet sees one PnL number for the selected window: `series[last].p − series[first].p` from Polymarket's `user-pnl-api` at that interval. The card's PnL number and the chart's series are derived from the same fetch; they cannot disagree.

### Approach

The PnL slice already exists, calls `user-pnl-api`, runs through `coalesce` at 30s TTL keyed `pnl:${addr}:${interval}`, and is fetched independently on the client via React Query (`use-wallet-analysis.ts:95–100`). We do nothing to it.

The fix is **subtraction**, four steps:

1. **Drop five fields from the snapshot contract** in [`poly.wallet-analysis.v1.contract.ts:42–73`](../../packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts): `realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`. They share one root (FIFO-less `Σbuy − Σsell` per asset in [`wallet-metrics.ts`](../../packages/market-provider/src/analysis/wallet-metrics.ts)) and one bug class (collision with the chart). Out of the contract together.

2. **Stop populating those fields in the snapshot service** at [`wallet-analysis-service.ts:178–204`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts). `computeWalletMetrics` keeps running — it still feeds `wins`, `losses`, `trueWinRatePct`, `medianDurationHours`, `tradesPerDay30d`, `daysSinceLastTrade`, `topMarkets`, `dailyCounts`, `openPositions`, `openNetCostUsdc`, `uniqueMarkets`, `resolvedPositions`. Those are not PnL, do not collide with the chart, and stay.

3. **Compose headline PnL from the PnL slice on the client** at [`use-wallet-analysis.ts:127–157`](../../nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts) (`mapToView`). Add a small helper:

   ```ts
   function pnlHeadline(p: WalletAnalysisPnl | undefined): string {
     if (!p || p.history.length === 0) return "—";
     const first = p.history[0].pnl;
     const last = p.history[p.history.length - 1].pnl;
     return formatUsd(last - first);
   }
   ```

   `mapSnapshot` no longer emits `pnl`, `roi`, `dd`. The card-level view object gets `pnl: pnlHeadline(pnl)` composed alongside `snapshot` in `mapToView`. The card already renders `n`, `wr`, `medianDur`, `avgPerDay`, `hypothesisMd` from snapshot; those stay. `roi` and `dd` columns come off the card — they were only ever derived from the same broken realized-PnL math.

4. **Drop the now-empty consumers** in `WalletCard` / `wallet-format.ts` / `buildWalletRows.ts` that read `roi` and `dd`. PnL display moves from `snapshot.realizedPnlUsdc` to the new card-level `pnl` field.

The interval driving the headline is `WalletAnalysisQuery.interval` — already in the contract, already plumbed through `getPnlSlice(addr, interval)`. The PnL React Query key already includes `interval` (line 96), so window switches re-fetch and re-render PnL while leaving snapshot/trades/balance untouched.

### Reuses

- `PolymarketUserPnlClient` and `getTradingWalletPnlHistory` — unchanged.
- `coalesce` 30s TTL cache, `p-limit(4)` upstream concurrency cap — unchanged. No second cache tier.
- `WalletAnalysisQuery.interval` enum — unchanged. No new interval values.
- React Query parallel-slice fan-out in `useWalletAnalysis` — unchanged. PnL renders independently of snapshot.
- `computeWalletMetrics` — keeps producing realized-PnL outputs (`realizedPnlUsdc` etc) for use by the copy-trade ranker / `scripts/experiments/wallet-screen-*.ts` discovery scripts. We are not deleting the function or its outputs, only its display consumers.

### Rejected alternatives

- **Local PnL reconstruction (FIFO + MTM + neg-risk + fees).** Bespoke math we'd have to maintain forever, with our own bug class. Polymarket's number is the canonical signal — reconstructing it locally adds work without adding truth. Rejected: REUSE_OVER_REBUILD.
- **Two-tier cache (60s hot / 5min warm).** Speculative. The current 30s TTL already serves the page; the slowness users feel is the trades + per-market-resolution fan-out, not the PnL fetch. Adding a second cache tier introduces invalidation surface for no measured win. Rejected: REJECT_COMPLEXITY.
- **Renaming `realizedPnlUsdc` → `pnlUsdc` on the snapshot contract.** Suggests the snapshot still owns PnL. It doesn't — the PnL slice does. Cleaner to drop than rename.
- **Reading `series[last].p` directly as the headline.** Looked simplest, but verified empirically as wrong: `series[last].p` is lifetime cumulative regardless of `interval`. Window selection would have no effect on the headline. Use `last − first` instead.
- **Deriving drawdown / peak equity from the upstream PnL series.** Tempting (it'd be self-consistent with the chart) but net-new code on a research-only display affordance no one has asked for. Punt to a follow-up if researchers actually use those numbers.
- **Computing the headline server-side and adding `pnlUsdc` to the snapshot or pnl contract.** Couples slices on the server and re-introduces a stored "snapshot of a snapshot" that can drift. The client already has the array; a 2-line subtraction at render time is simpler and impossible to drift.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] PNL_SINGLE_SOURCE: Wallet research display path reads PnL only from `getPnlSlice` / `PolymarketUserPnlClient`. No `computeWalletMetrics`-derived PnL field reaches the rendered card. (spec: poly-copy-trade-phase1)
- [ ] PNL_RECONCILES_BY_CONSTRUCTION: Card headline PnL is `last.p − first.p` of the same Zod-validated `WalletAnalysisPnl.history` array the chart consumes. The chart's first and last endpoints visibly match the headline. (spec: contract `WalletAnalysisPnlSchema`)
- [ ] CONTRACT_CLEANUP: `WalletAnalysisSnapshotSchema` no longer contains `realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`. Type-checker enforces deletion at every consumer. (spec: contract `poly.wallet-analysis.v1`)
- [ ] PARTIAL_FAILURE_NEVER_THROWS: PnL slice failure or empty array surfaces as `pnl: "—"` on the card. The rest of the snapshot still renders. (spec: contract invariant — molecules render from `{ data, isLoading, error }`)
- [ ] METRICS_FN_PRESERVED: `computeWalletMetrics` continues to export realized-PnL outputs for ranker / experiment consumers; only display callers stop reading them. (spec: market-provider analysis package)
- [ ] CACHE_UNCHANGED: 30s `coalesce` TTL on `pnl:${addr}:${interval}` is the only PnL cache layer. No new TTL split, no Redis. (spec: architecture — process-scoped cache, single-replica boot assert)
- [ ] SIMPLE_SOLUTION: Net change is a contract subtraction + one client helper + service field-removal. Zero new files. (spec: architecture — REUSE_OVER_REBUILD)
- [ ] ARCHITECTURE_ALIGNMENT: Contract change in `packages/node-contracts` (shared); display rewiring in `nodes/poly/app` (runtime). No domain logic moves runtimes. (spec: packages-architecture)

### Files

- Modify: `packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts` — drop the five fields from `WalletAnalysisSnapshotSchema` (lines 47–51); update the schema's JSDoc to call out that PnL is sourced from the `pnl` slice, not here.
- Modify: `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` — remove the five fields from `getSnapshotSlice` return value (lines 186–190). Leave the `computeWalletMetrics` call intact; only its outputs change.
- Modify: `nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts` — `mapSnapshot` drops `roi`, `pnl`, `dd` (lines 166–168). Add `pnlHeadline(pnl)` helper. `mapToView` composes `pnl: pnlHeadline(pnl)` onto the returned card object alongside `snapshot`.
- Modify: `nodes/poly/app/src/features/wallet-analysis/types/wallet-analysis.ts` — drop `roi`, `pnl`, `dd` from the `WalletSnapshot` shape (lines 98–100).
- Modify: `nodes/poly/app/src/features/wallet-analysis/components/StatGrid.tsx` — drop the three cells (`Realized ROI`, `Realized PnL`, `Max DD`); change `md:grid-cols-6` to `md:grid-cols-3`; trim skeleton from 6 cells to 3.
- Modify: `nodes/poly/app/src/features/wallet-analysis/components/WalletProfitLossCard.tsx` — fix the headline (line 80) from `history.at(-1)?.pnl ?? 0` to a windowed delta `last.pnl − first.pnl`; render `"—"` when history is empty/missing instead of `$0.00`. Same root bug as the snapshot side, same upstream, one-line fix.
- No changes to `app/(app)/_components/wallets-table/*` or `app/(app)/dashboard/_components/wallet-format.ts` — that surface uses Polymarket's leaderboard endpoint (`listTopTraders`) directly and does not depend on the removed contract fields.
- Test: `packages/node-contracts/tests/` — assert the new `WalletAnalysisSnapshotSchema.shape` keys do not include the five removed fields (use `Object.keys(WalletAnalysisSnapshotSchema.shape)`, not parse-rejection — the schema is non-strict by default and would silently strip extras).
- Test: `nodes/poly/app/tests/unit/features/wallet-analysis/wallet-analysis-service.test.ts` — adjust snapshot fixture expectations.
- Test: `nodes/poly/app/tests/unit/features/wallet-analysis/use-wallet-analysis.test.ts` (or equivalent) — assert `pnlHeadline` returns `last − first`, returns `"—"` on empty/undefined, and reconciles with the same `WalletAnalysisPnl.history` the chart consumes.
- No new files. No migration. No package changes.

## Validation

### exercise

- `GET /api/v1/poly/wallets/<addr>?include=pnl&interval=1W` on a wallet with a non-empty 1W series returns `pnl.history`. The card renders headline PnL = `last.p − first.p` of that same array. The chart's first and last endpoints match.
- The same wallet at `?include=snapshot&interval=1W` returns a snapshot **without** the five removed fields (key set on the response equals the new contract shape). Compile/runtime succeeds.
- A wallet Polymarket has no PnL points for renders headline `"—"`; the rest of the snapshot still loads.
- A second hit to the same `(addr, interval)` within 30s does not issue an upstream fetch. Verify via Loki.

### observability

- Pino log line on `polymarket.user-pnl.fetch` with `{ addr, interval, points, latency_ms }` for every upstream call. Loki query at the deployed SHA confirms one fetch per cache miss, not one per pageview.
- Pino log line on `poly.wallet.snapshot` already exists; remove `realizedPnlUsdc` from its payload. PnL is no longer logged at the snapshot layer.

### Risks

- **Snapshot card looks "less rich."** Today: precise-looking `realizedPnlUsdc` like `$13.47` plus `roi` and `dd` columns. After: one PnL number sourced from upstream, no `roi`/`dd`. The number changing on rollout is expected, not a regression — communicate it in the PR body.
- **Polymarket endpoint is undocumented.** `polymarket.user-pnl.client.ts` already validates with Zod and throws on shape change. If the upstream shape shifts, every wallet research surface breaks at once — but that surfaces as `kind: "warn"` and the UI renders "—". We trade local complexity for upstream coupling — that is the deliberate trade.
- **Empty `history` arrays for wallets we have never seen Polymarket index.** Confirmed empirically (e.g. operator wallet returns `[]`). The headline helper returns `"—"` in this case; do not show `$0`.
- **Snapshot still does the trades + per-market-resolution fan-out** for wins/losses. PnL display is no longer blocked by it (PnL is a separately-fetched React Query slice), but the snapshot card itself remains as slow as today. Out of scope for this task.

### Boundary placement (Phase 3a)

| Decision                      | Where                                                | Why                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract field drop           | `packages/node-contracts`                            | Already shared across runtimes (app, agent graphs). Field is removed in one place; both runtimes get the change atomically.                    |
| Display rewiring              | `nodes/poly/app/src/features/wallet-analysis/client` | React hook + Next.js page composition is runtime wiring. No domain logic.                                                                      |
| Service-side removal          | `nodes/poly/app/src/features/wallet-analysis/server` | Slice composition is app-runtime concern; the underlying `computeWalletMetrics` lives in `packages/market-provider/analysis` and is unchanged. |
| `computeWalletMetrics` itself | `packages/market-provider/analysis` (unchanged)      | Still domain logic for the copy-trade ranker / discovery scripts. Ports stay where they are.                                                   |

No new ports, no new types, no new domain modules. Five contract fields plus their service producers and client consumers come out; one tiny client helper goes in.

### Consumer audit (verified 2026-04-26)

`grep -rn "realizedPnlUsdc\|realizedRoiPct\|maxDrawdownUsdc\|maxDrawdownPctOfPeak\|peakEquityUsdc" nodes packages` returns hits in only:

- `packages/market-provider/src/analysis/wallet-metrics.ts` (producer — unchanged)
- `packages/market-provider/tests/wallet-metrics.test.ts` (producer tests — unchanged)
- `packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts` (this task removes)
- `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` (this task removes)
- `nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts` (this task rewires)

No references in `nodes/poly/graphs/`, no references in agent prompts, no references in MCP fixtures. The contract subtraction is internal to the wallet-analysis feature; no cross-repo coordination required.

## Dependencies

- [x] `PolymarketUserPnlClient` exists and is wired through `getTradingWalletPnlHistory`
- [x] `coalesce` cache helper in `wallet-analysis-service.ts` keys `pnl:${addr}:${interval}` at 30s TTL — no new cache layer needed
- [x] `/api/v1/poly/wallets/:addr` route accepts `?include=pnl&interval=…` and the client already fires a parallel React Query fetch per slice
- [x] No external consumers of removed fields (verified by repo-wide grep)

## Review Feedback

### Revision 1 — `/review-implementation` 2026-04-27

**Blocking**

- **`computeWindowedPnl` single-point semantics inconsistent across docstring, code, and test** — `WalletProfitLossCard.tsx:202–213`. Docstring claims it returns `null` for "fewer than two points"; code returns `0` for single-point; test asserts `.toBe(0)`. A wallet with one indexed point at `p = $50,000` will render "$0" headline (misleading "no change in window") instead of "—" (honest "delta not expressible"). The docstring is correct.
  - Fix: replace `WalletProfitLossCard.tsx:209–213` body with `if (!history || history.length < 2) return null;` then `const first = history[0]?.pnl ?? 0;` / `const last = history[history.length - 1]?.pnl ?? 0;` / `return last - first;`.
  - Update `wallet-profit-loss-card.test.tsx:67–71`: `.toBe(0)` → `.toBeNull()`; rename test to "returns null for a single point — delta not expressible".

**Non-blocking suggestions**

- `WalletProfitLossCard.tsx:11–13` — clarify `ZERO_BASELINE_WHEN_EMPTY` to read "flat zero-state **chart** panel" so it reads cleanly alongside `HEADLINE_IS_WINDOWED_DELTA` (chart vs headline are different invariants).
- `WalletProfitLossCard.tsx:194` + `wallet-profit-loss-card.test.tsx:33` — empty-state copy `"No realized P/L yet."` is stale; this task removed the "realized" framing. Suggest `"No P/L history yet."`.
- `wallet-profit-loss-card.test.tsx:42` — test comment uses "lifetime cumulative at start"; technically `series[first].p` is "cumulative as of the first indexed point in the window," not "lifetime at recorded-history start." Reword for accuracy.
