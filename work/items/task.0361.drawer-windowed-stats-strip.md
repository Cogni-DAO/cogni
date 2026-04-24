---
id: task.0361
type: task
title: "WalletDetailDrawer — wire windowed stats strip using POST /wallets/stats"
status: done
priority: 2
rank: 6
estimate: 2
created: 2026-04-23
updated: 2026-04-24
summary: "The WalletDetailDrawer shows garbage stats: avg-trades/day is computed from 500 all-time activity events (TRADE_FETCH_LIMIT cap), ignores the selected timePeriod, and 'n= resolved positions' only covers those 500 rows. POST /api/v1/poly/wallets/stats (task.0346) already returns accurate windowed numTrades/volumeUsdc/pnlUsdc — the drawer just needs a hook + header strip to call it."
outcome: "The drawer shows a windowed stats strip (numTrades, volume, PnL) driven by POST /wallets/stats with a DAY/WEEK/MONTH/ALL toggle. The strip reflects the selected period accurately; the existing snapshot/trades/pnl slices below remain unchanged."
spec_refs:
  - docs/spec/poly-multi-tenant-auth.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/poly-windowed-wallet-stats
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [poly, wallet-analysis, drawer, windowed-stats]
---

# task.0361 — WalletDetailDrawer windowed stats strip

## Problem

The `WalletDetailDrawer` (via `WalletAnalysisSurface` → `WalletAnalysisView`) renders these fields from `getSnapshotSlice`:

- **"n=6 resolved positions"** — computed from `listUserActivity(limit=500)`. A high-volume wallet fills all 500 slots with recent events; `computeWalletMetrics` resolves only the positions visible in those 500 rows. For a wallet trading across hundreds of markets, the real count could be 10×.
- **"≈ 17 avg trades / day"** — `computeWalletMetrics` counts `tradesLast30` from the same capped 500-row feed and divides by 30. If the feed is saturated, this reads as `500/30 ≈ 16.7` regardless of actual activity.
- **No window awareness** — the `timePeriod` selected on the research table is never passed to `getSnapshotSlice`.

`POST /api/v1/poly/wallets/stats` (shipped in task.0346) returns accurate windowed `numTrades`, `volumeUsdc`, `pnlUsdc`, `pnlKind` using `listUserTrades(limit=10_000)` with `sinceTs` filtering. Nothing in the drawer calls it.

## Design

### Outcome

The WalletDetailDrawer shows a windowed stats strip with accurate `numTrades`, `volumeUsdc`, and `pnlUsdc`, driven by the existing `POST /wallets/stats` endpoint with a DAY/WEEK/MONTH/ALL toggle.

### Approach

**Solution**: Add a `useWalletWindowStats` React Query hook that calls `POST /api/v1/poly/wallets/stats`. Add a `timePeriod` state to `WalletAnalysisSurface`. Render a new `WindowedStatsStrip` molecule above the existing `StatGrid` in `WalletAnalysisView`. The toggle drives both the strip and the existing PnL chart (which already accepts `PolyWalletOverviewInterval`).

**Reuses**: `WalletWindowStatsBatchSchema` + `WalletWindowTimePeriodSchema` from `@cogni/node-contracts`. `useQuery` pattern from `use-wallet-analysis.ts`. `StatGrid` skeleton pattern for the strip loading state.

**Rejected**: Fixing `getSnapshotSlice`'s 500 cap — that endpoint uses `listUserActivity` (mixed lifecycle events), not `listUserTrades`. Changing it would require a separate endpoint change and is out of scope. The strip is additive; the snapshot metrics remain as complementary "all-time / resolved" context below.

### Invariants

- [ ] INVARIANT: The strip calls `POST /wallets/stats` for a single address — not per-render fan-out. One request per `(addr, timePeriod)` pair within the 60s server TTL.
- [ ] INVARIANT: `timePeriod` toggle state lives in `WalletAnalysisSurface` and drives both the `WindowedStatsStrip` and the existing PnL chart interval (rename `interval` state to `timePeriod` to unify).
- [ ] INVARIANT: The strip shows skeleton cells while loading; never shows stale data from a prior address/period.
- [ ] INVARIANT: `numTradesCapped: true` renders a `~` prefix on the trade count (e.g. `~10k+`) to be honest about the 10k cap.

### Files

- Add: `nodes/poly/app/src/features/wallet-analysis/client/use-wallet-window-stats.ts` — React Query hook; calls `POST /api/v1/poly/wallets/stats` for one address + timePeriod; returns `WalletWindowStats | undefined` + `isLoading`.
- Add: `nodes/poly/app/src/features/wallet-analysis/components/WindowedStatsStrip.tsx` — 3-cell presentational strip: numTrades, volume (USDC), PnL (USDC + pnlKind label). Skeleton when loading.
- Modify: `nodes/poly/app/src/features/wallet-analysis/components/WalletAnalysisSurface.tsx` — add `timePeriod` state (`WalletWindowTimePeriod`); pass to `useWalletWindowStats`; pass to `WalletAnalysisView` as new `windowStats`/`windowStatsLoading`/`timePeriod`/`onTimePeriodChange` props. Rename existing `interval` state to `timePeriod` (same values; avoids two separate states).
- Modify: `nodes/poly/app/src/features/wallet-analysis/components/WalletAnalysisView.tsx` — accept `windowStats`, `windowStatsLoading`, `timePeriod`, `onTimePeriodChange` props; render `WindowedStatsStrip` + a `DAY/WEEK/MONTH/ALL` toggle above `StatGrid`.

## Validation

### exercise

```bash
# Open drawer on any active wallet on candidate-a; toggle DAY → WEEK → MONTH → ALL
# Verify numTrades and volumeUsdc update per period.

# Direct API check:
curl -s -X POST https://candidate-a.cogni.sh/api/v1/poly/wallets/stats \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"timePeriod":"WEEK","addresses":["0x<wallet>"]}' \
  | jq '.stats["0x<wallet>"] | {numTrades, volumeUsdc, pnlKind}'
```

### observability

`{service="app", env="candidate-a"} | json | route="poly.wallets.stats"` — one request per `(addr, timePeriod)` pair; `durationMs < 2000` on cache-warm repeat.
