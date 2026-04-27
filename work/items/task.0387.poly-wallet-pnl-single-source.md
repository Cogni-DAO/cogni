---
id: task.0387
type: task
title: "Poly wallet research — single-source PnL via Polymarket user-pnl-api"
status: needs_implement
priority: 1
rank: 5
estimate: 2
branch: design/task-0387-pnl-single-source
summary: "Stop computing realized PnL / ROI / drawdown ourselves on the wallet research snapshot card. Reuse the existing PnL slice (Polymarket `user-pnl-api`) — already in the route, already coalesced — as the single PnL source. Drop `realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc` from the wallet-analysis snapshot contract. `computeWalletMetrics` keeps producing wins/losses/winrate/duration/topMarkets/etc; only its PnL outputs leave the display path. Top-wallets already uses Polymarket's leaderboard."
outcome: "The wallet research snapshot card displays one PnL number, taken from the last point of the existing PnL slice's series at the requested interval. It reconciles with the chart by construction (same upstream call, same window). New wallets work the moment Polymarket indexes them. No new cache layer, no new port, no new domain logic — a rewire + four-field deletion."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
pr:
created: 2026-04-26
updated: 2026-04-26
design_completed: 2026-04-26
labels: [poly, polymarket, wallet-research, pnl, simplification, performance]
external_refs:
  - nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts
  - nodes/poly/app/src/features/wallet-analysis/server/trading-wallet-overview-service.ts
  - nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts
  - packages/market-provider/src/adapters/polymarket/polymarket.user-pnl.client.ts
  - packages/market-provider/src/analysis/wallet-metrics.ts
---

# task.0387 — Single-source PnL via Polymarket user-pnl-api

> Filed 2026-04-26 after critical analysis of "wallet research stats for time windows are consistently wrong." Root cause is not an upstream bug — it is that we present two PnL numbers with two different definitions side-by-side, and they disagree.

## Context

Today the wallet research surface computes PnL **twice**, with **two incompatible definitions**:

1. **Snapshot card** (`getSnapshotSlice` in
   [`wallet-analysis-service.ts:178`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts))
   runs `computeWalletMetrics(trades, resolutions)` over up-to-500 Data-API trades plus
   one CLOB `getMarketResolution()` call per unique conditionId. Output:
   `realizedPnlUsdc` — realized only, no MTM, no FIFO, naive `Σbuy − Σsell` per asset
   ([`wallet-metrics.ts:95–167`](../../packages/market-provider/src/analysis/wallet-metrics.ts)).
   Rendered at
   [`use-wallet-analysis.ts:167`](../../nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts)
   as the headline "PnL" number on the card.
2. **PnL chart slice** (`getPnlSlice` in
   [`wallet-analysis-service.ts:256`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts))
   calls Polymarket's native `user-pnl-api` via `PolymarketUserPnlClient.getUserPnl()`.
   This is the same series that powers Polymarket's own UI.

The two numbers do not reconcile — and cannot, because (1) realized-only vs Polymarket's
definition (which includes resolution settlement and likely some unrealized treatment we
have never spec'd), (2) trade-cap of 500 vs Polymarket's full history, (3) our naive
cost basis vs whatever lot-tracking Polymarket runs internally. Users see two numbers
disagree and call the page "wrong."

A "fix" by reconstructing PnL ourselves is the wrong direction:

- Polymarket's number **is** the canonical signal. It is what every leaderboard,
  profile page, and target wallet sees when they self-evaluate. Reconciling against it
  is pointless.
- Our reconstruction needs FIFO + MTM + neg-risk + fees + deposits — every one of those
  is bespoke logic with its own bugs.
- The current snapshot fan-out (1 trades fetch + N market-resolution fetches) is already
  too slow for a discovery use case that must scale to "any wallet I just typed in."

## Goal

Make Polymarket's `user-pnl-api` the **only** PnL source for the wallet research surface.
Delete the bespoke PnL number from the display read path. Cache aggressively. Render one
labeled number per window.

### Deliverables

- **Drop `realizedPnlUsdc` from the snapshot read path.** `getSnapshotSlice` keeps the
  metrics it does well (wins/losses/winrate/drawdown/trade frequency/topMarkets) — those
  are not PnL numbers and do not collide with the chart. The PnL field on the snapshot
  contract becomes a thin pointer to `getPnlSlice`'s most-recent point at the requested
  interval, not a reconstruction.
- **Single PnL helper** in
  `nodes/poly/app/src/features/wallet-analysis/server/trading-wallet-overview-service.ts`:
  `getPnlForWindow(addr, interval) → { value: number, asOf: ISO }` returning the last
  point of the upstream series for that window. Used by every surface that wants a
  single labeled number (top-wallets table, snapshot card, profile header).
- **Cache layer.** `(addr, interval) → series` in-memory with two TTLs:
  - **60s hot** for tracked wallets and the currently-rendered profile page
  - **5min warm** for everything else (top-wallets list, discovered wallets)
    Reuse the existing `coalesce` helper at
    [`wallet-analysis-service.ts:262`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts) — its `SLICE_TTL_MS` is already in the
    path; this task lifts the TTL split into the `coalesce` key.
- **Contract update.** `PolyWalletOverview*` Zod contracts in `@cogni/node-contracts`:
  rename `realizedPnlUsdc` to `pnlUsdc` on the snapshot, document it as
  _"Polymarket-reported PnL at the requested interval. Definition is upstream's; we
  do not reconstruct."_ No new fields.
- **UI label.** `wallet-format.ts` + the snapshot card render the number with a
  small inline tooltip "PnL (Polymarket)" so the divergence-with-our-old-realized number
  doesn't surprise anyone reading the diff.
- **Remove the per-market resolution fan-out from the display path.** `computeWalletMetrics`
  consumes `resolutions: Map<conditionId, MarketResolutionInput>` for `wins/losses/trueWinRate`.
  Keep that — it is not PnL — but check whether the resolution fetches still need to be
  parallel-N for the discovery use case. If a 500-trade wallet hits 80 unique conditions,
  that's 80 CLOB fetches per pageview. Decide in `/design` whether to (a) batch via Gamma,
  (b) only fetch resolutions for `closed=true` markets (the majority should be cached),
  or (c) defer this fan-out to a separate task and ship PnL-correctness first.

## Non-goals

- **Local PnL reconstruction (FIFO/lot tracking/MTM).** Explicitly the wrong direction
  for this task. If Phase-4 ranking (task.0322) eventually needs per-fill cost-basis math
  for adversarial-robust scoring, that math lives in the ranker, not the display path.
- **Replacing the snapshot's other metrics** (wins, losses, drawdown, top markets, daily
  counts). Those are not PnL and do not collide with the chart. Their slowness is a
  separate concern — see the resolution fan-out point above.
- **Changing the PnL chart** itself. It already uses Polymarket's series. This task makes
  the rest of the page agree with it.
- **Reconciling Polymarket's number against on-chain truth.** That is a Phase-4 problem
  if it ever becomes a real problem. v0/v1 trusts upstream.
- **Discovery / search UX** for arbitrary wallets. This task makes the existing surface
  fast and correct; new surfaces ride on top.

## Design questions (resolve in `/design`)

- **PnL "current value" semantics.** A user looking at the 7d window expects "PnL
  earned in the last 7 days." Polymarket's series is a running PnL curve, not a
  windowed delta. Is the right number `series[last] - series[first_in_window]`, or
  `series[last]` of the `interval=1w` query? Based on
  [`trading-wallet-overview-service.ts:39–54`](../../nodes/poly/app/src/features/wallet-analysis/server/trading-wallet-overview-service.ts),
  Polymarket's `interval` parameter does the windowing for us — the returned series
  is already scoped. The single number is `series[last].p`. Confirm by hitting the
  endpoint with `interval=1d` on a wallet that traded yesterday vs today.
- **Cache scope.** In-memory per-pod is fine for v0. The wallet research surface is
  read-only and idempotent; cross-pod cache coherence is not required. If a tenant
  hits two pods, they may see two slightly different numbers within a 60s window.
  Acceptable. Do **not** introduce Redis for this.
- **Cache key.** `pnl:${addr}:${interval}` already exists in `getPnlSlice`. Lift the TTL
  decision into the call site so top-wallets list (5min) and profile page (60s) can
  diverge without two cache namespaces.
- **What happens when Polymarket's endpoint is down or returns `[]`?** Today the slice
  returns `kind: "warn"`. Keep that. The card renders "PnL (unavailable)" rather than
  zero. Empty array on a wallet that has traded is honest — the upstream simply hasn't
  indexed yet; surface that, don't paper over it.
- **Top-wallets sort key.** Today `top-wallets/route.ts` ranks by something. If it ranks
  by our `realizedPnlUsdc`, switch it to the Polymarket-window number. Confirm in
  `/design` whether the ranker actually uses this number or something else.

## Validation

### exercise

- `GET /api/v1/poly/wallets/<addr>?include=snapshot&interval=1W` on a wallet with known
  trades returns a `pnlUsdc` field whose value matches the last point of
  `GET /api/v1/poly/wallets/<addr>?include=pnl&interval=1W` (within rounding). They
  must reconcile **by construction** — same upstream call, same window.
- `GET /api/v1/poly/top-wallets` on candidate-a returns the same PnL numbers per row
  that the per-wallet `?include=snapshot` returns for those same wallets. No drift.
- A second hit to the same `(addr, interval)` within 60s does **not** issue an
  upstream fetch (verify via Loki — `polymarket.user-pnl.fetch` log line should
  appear once per (addr, interval, 60s)).
- Snapshot card on a brand-new wallet (one we have never seen) renders a non-null
  PnL number within one Polymarket round-trip — no per-market resolution fan-out
  required to compute PnL. (Resolution fetches may still happen for wins/losses;
  PnL must not block on them.)

### observability

- Pino log line `polymarket.user-pnl.fetch` with `{ addr, interval, points, latency_ms }`
  on every upstream call. Loki query at the deployed SHA confirms one fetch per cache
  miss, not one per pageview.
- Pino log line `poly.wallet.snapshot` already exists; remove `realizedPnlUsdc` from
  its payload, add `pnlUsdc` and `pnlSource: "polymarket-user-pnl"`.
- Page load timing on the wallet research surface: post-merge, the snapshot card's
  TTFB on a cold cache should be one round-trip to user-pnl-api, not one trades
  fetch + N resolution fetches + a metrics computation. Capture before/after p50
  on candidate-a.

## Risks

- **Snapshot card looks "less rich."** Today users see a precise-looking
  `realizedPnlUsdc` like `$13.47`. Tomorrow they see `$11.92` because that is what
  Polymarket says. The number changing on rollout is expected, not a regression.
  Communicate it in the PR body and add the "PnL (Polymarket)" tooltip so the
  source is explicit.
- **Polymarket endpoint is undocumented.** `polymarket.user-pnl.client.ts` has no
  upstream contract guarantee. If the shape changes, every wallet research surface
  breaks at once. Mitigation: the existing Zod schema is already the only validation
  layer; tighten it to fail closed and fall back to `kind: "warn"` if the shape
  shifts. We trade local complexity for upstream coupling — that is the deliberate
  trade.
- **Removing `realizedPnlUsdc` from the contract is a breaking change.** Search
  cogni-template + cogni-mobile for consumers. If any external surface (graph tool,
  agent prompt, MCP fixture) references it, update them in this PR or rename in two
  steps (additive `pnlUsdc` first, drop `realizedPnlUsdc` in a follow-up).
- **`computeWalletMetrics` is still imported.** It feeds wins/losses/drawdown and
  the copy-trade decision path may use it. Do **not** delete the function; only
  remove its `realizedPnlUsdc` consumption from the display read path.

## Why this is a simplification

- **Less code shipped.** One PnL helper replaces two (snapshot's `computeWalletMetrics`
  PnL output + chart's user-pnl call).
- **One definition.** Users, agents, and the ranker all read the same number.
- **Faster.** PnL display no longer waits on N market-resolution fetches.
- **Scales to discovery.** Any wallet on Polymarket gets correct PnL the moment it is
  indexed upstream. No per-wallet onboarding, no cost-basis seeding.
- **Easier to evolve.** When task.0322 needs counterfactual PnL net of slippage + fees,
  the ranker builds it once on top of the same upstream call — not on top of our half-
  correct local reconstruction.

## Dependencies

- [x] `PolymarketUserPnlClient` exists and is wired through
      `getTradingWalletPnlHistory` (no upstream change required)
- [x] `coalesce` cache helper in `wallet-analysis-service.ts` (already keys
      `pnl:${addr}:${interval}` at 30s TTL — no new cache layer needed)
- [x] `/api/v1/poly/wallets/:addr` route already supports `?include=snapshot,pnl&interval=1W` —
      both slices are coalesced + p-limit-bounded; the client just needs to ask for both

---

## Design

### Outcome

A user opening the wallet research card on any Polymarket wallet sees one PnL number for the selected window. That number is the last point of the same series the chart renders — they cannot disagree by construction. No bespoke cost-basis math runs in the display path. Page first paint of the PnL number is one HTTP fetch (the public `user-pnl-api`), independent of the trades + per-market resolution fan-out used for wins/losses.

### Approach

**Solution.** The PnL slice already exists, already calls Polymarket's `user-pnl-api`, already runs through `coalesce` at 30s TTL keyed by `pnl:${addr}:${interval}` (see [`wallet-analysis-service.ts:256–288`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts) and [`trading-wallet-overview-service.ts:39–54`](../../nodes/poly/app/src/features/wallet-analysis/server/trading-wallet-overview-service.ts)). We do nothing to it.

The fix is **subtraction**, three steps:

1. **Drop the four naive-math fields from the snapshot contract** in [`poly.wallet-analysis.v1.contract.ts:42–73`](../../packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts): `realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`. They share one root (FIFO-less `Σbuy − Σsell` per asset in [`wallet-metrics.ts`](../../packages/market-provider/src/analysis/wallet-metrics.ts)) and one bug class (collision with the chart). Out of the contract together.
2. **Stop populating those fields in the snapshot service** at [`wallet-analysis-service.ts:178–204`](../../nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts). `computeWalletMetrics` keeps running — it still feeds `wins`, `losses`, `trueWinRatePct`, `medianDurationHours`, `tradesPerDay30d`, `daysSinceLastTrade`, `topMarkets`, `dailyCounts`, `openPositions`, `openNetCostUsdc`, `uniqueMarkets`, `resolvedPositions`. Those are not PnL, do not collide with the chart, and stay.
3. **Rewire the snapshot card client** at [`use-wallet-analysis.ts:159–176`](../../nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts):
   - Headline `pnl` becomes `pnl.history.at(-1)?.pnl` — the same series the chart consumes.
   - `roi` and `dd` come off the card. They were only ever derived from the same broken realized-PnL math; deleting them removes a divergent surface, not a working one. The card already renders `n`, `wr`, `medianDur`, `avgPerDay`, `hypothesisMd` — those stay.

The interval that drives the headline number is `WalletAnalysisQuery.interval` (default `"ALL"`) — already in the contract, already plumbed through `getPnlSlice(addr, interval)`. The card's existing window selector dispatches the same `interval` for both `snapshot` and `pnl` slices in one route call: `?include=snapshot&include=pnl&interval=1W`. Both slices coalesce per-`(addr,interval)` so a window switch hits each upstream once per 30s.

**Reuses.**

- `PolymarketUserPnlClient` and `getTradingWalletPnlHistory` — unchanged.
- `coalesce` 30s TTL cache, `p-limit(4)` upstream concurrency cap — unchanged. No second cache tier.
- `WalletAnalysisQuery.interval` — unchanged. No new interval enum.
- `computeWalletMetrics` — keeps producing realized-PnL outputs for use by the copy-trade ranker / `scripts/experiments/wallet-screen-*.ts` discovery scripts. We are not deleting the function, only its display consumers.

**Rejected alternatives.**

- **Local PnL reconstruction (FIFO + MTM + neg-risk + fees).** Bespoke math we'd have to maintain forever, with our own bug class. Polymarket's number is the canonical signal every leaderboard cites — reconstructing it locally adds work without adding truth. Rejected: REUSE_OVER_REBUILD.
- **Two-tier cache (60s hot / 5min warm) per the original work item.** Speculative. The current 30s TTL already serves the page; the slowness users feel is the trades + per-market-resolution fan-out, not the PnL fetch. Adding a second cache tier introduces invalidation surface for no measured win. Rejected: REJECT_COMPLEXITY.
- **Renaming `realizedPnlUsdc` → `pnlUsdc` on the snapshot contract.** Suggests the snapshot still owns PnL. It doesn't. The PnL slice owns PnL; the snapshot owns the trade-derived metrics that don't disagree with anything. Rejected: clearer to drop than to rename.
- **Deriving drawdown / peak equity from the upstream PnL series in the snapshot.** Tempting (it'd be self-consistent with the chart), but it's net-new code on a research-only display affordance no one has asked for. Punt to a follow-up if researchers actually use those numbers; today they don't reconcile with anything so removing them strictly improves correctness.
- **Fetching the PnL slice automatically inside the snapshot route handler.** Would couple the slices on the server. The route already accepts `?include=snapshot&include=pnl` — let the client compose. Same number of HTTP calls, looser coupling. Rejected: smaller surface to break.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] PNL_SINGLE_SOURCE: Wallet research display path reads PnL only from `getPnlSlice` / `PolymarketUserPnlClient`. No call to `computeWalletMetrics`-derived PnL fields lands in the rendered card. (spec: poly-copy-trade-phase1)
- [ ] PNL_RECONCILES_BY_CONSTRUCTION: Snapshot card headline PnL == last point of the chart's series for the same `(addr, interval)`. They are the same Zod-validated array; mismatch is impossible without an upstream-shape regression. (spec: contract `WalletAnalysisPnlSchema`)
- [ ] CONTRACT_CLEANUP: `WalletAnalysisSnapshotSchema` no longer contains `realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`. (spec: contract `poly.wallet-analysis.v1`)
- [ ] PARTIAL_FAILURE_NEVER_THROWS: PnL slice failure surfaces as `warnings[]` with `slice: "pnl"`; the card renders `pnl: "—"` and the rest of the snapshot still renders. (spec: contract invariant `Molecules render from { data, isLoading, error }`)
- [ ] METRICS_FN_PRESERVED: `computeWalletMetrics` continues to export realized-PnL outputs for ranker / experiment consumers; only display callers stop reading them. (spec: market-provider analysis package)
- [ ] CACHE_UNCHANGED: 30s `coalesce` TTL on `pnl:${addr}:${interval}` is the only PnL cache layer. No new TTL split, no Redis. (spec: architecture — process-scoped cache, single-replica boot assert)
- [ ] SIMPLE_SOLUTION: Net change is a contract subtraction + one client mapping change + service field-removal. Zero new files. (spec: architecture — REUSE_OVER_REBUILD)
- [ ] ARCHITECTURE_ALIGNMENT: Contract change in `packages/node-contracts` (shared); display rewiring in `nodes/poly/app` (runtime). No domain logic moves runtimes. (spec: packages-architecture)

### Files

<!-- High-level scope -->

- Modify: `packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts` — drop five fields from `WalletAnalysisSnapshotSchema` (`realizedPnlUsdc`, `realizedRoiPct`, `maxDrawdownUsdc`, `maxDrawdownPctOfPeak`, `peakEquityUsdc`); update the schema's JSDoc to call out that PnL is sourced from the `pnl` slice, not here.
- Modify: `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` — remove the five fields from the `getSnapshotSlice` return value (lines 186–190). Leave `computeWalletMetrics` call intact; only its outputs change.
- Modify: `nodes/poly/app/src/features/wallet-analysis/client/use-wallet-analysis.ts` — `mapSnapshot` drops `roi`, `pnl`, `dd`. New `pnl` mapping derives from the `pnl` slice (`mapPnlHeadline(pnl)` → `formatUsd(history.at(-1)?.pnl)` else `"—"`). Composed into the returned card object alongside `snapshot`.
- Modify: any wallet research card React component (`WalletCard` / `wallet-format.ts`) that currently renders `roi` / `dd` — drop those columns. (Identify exact file in the implementation pass; the surface is `nodes/poly/app/src/app/(app)/_components/wallets-table/buildWalletRows.ts` and the dashboard wallet-format.)
- Test: `packages/node-contracts/tests/poly.wallet-analysis.v1.contract.test.ts` (or wherever the contract's existing tests live) — assert removed fields no longer parse and snapshot is parseable without them.
- Test: `nodes/poly/app/tests/unit/features/wallet-analysis/wallet-analysis-service.test.ts` — adjust snapshot fixture expectations.
- Test: `nodes/poly/app/tests/contract/` — add an integration assertion: with `?include=snapshot,pnl&interval=1W`, the card-derived headline PnL equals `response.pnl.history.at(-1).pnl`.
- No new files. No migration.

### Validation

The validation block from the original task body covers the candidate-a exercise + observability. The implement pass adds one assertion to it: snapshot's headline PnL on the rendered card equals the chart's last point at the same window — verified by replay of the same Loki request line via the deployed-SHA query.

### Boundary placement (Phase 3a)

| Decision                      | Where                                                | Why                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract field drop           | `packages/node-contracts`                            | Already shared across runtimes (app, agent graphs). Field is removed in one place; both runtimes get the change atomically.                    |
| Display rewiring              | `nodes/poly/app/src/features/wallet-analysis/client` | React hook + Next.js page composition is runtime wiring. No domain logic.                                                                      |
| Service-side removal          | `nodes/poly/app/src/features/wallet-analysis/server` | Slice composition is app-runtime concern; the underlying `computeWalletMetrics` lives in `packages/market-provider/analysis` and is unchanged. |
| `computeWalletMetrics` itself | `packages/market-provider/analysis` (unchanged)      | Still domain logic for the copy-trade ranker / discovery scripts. Ports stay where they are.                                                   |

No new ports, no new types, no new domain modules. The work item adds zero files and removes five contract fields plus their service producers and client consumers.
