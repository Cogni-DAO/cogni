---
id: task.0346
type: task
title: "Poly wallet stats: Data-API-first windowed stats + batched endpoint"
status: needs_design
priority: 2
rank: 5
estimate: 3
created: 2026-04-21
updated: 2026-04-21
summary: "Unify per-wallet windowed stats behind a single Polymarket Data-API-first endpoint with a batched request shape and short-TTL server cache. Replaces today's split-brain (leaderboard `volumeUsdc`/`pnlUsdc` are windowed but `numTrades` is length of an all-time `/trades?limit=500` call; `/wallets/[addr]` ignores `timePeriod` entirely; `CopyTradedWalletsCard` works around this with a two-tier leaderboard fallback that's honest but inconsistent)."
outcome: "One authoritative per-wallet, per-window stats shape used by the dashboard, the research table, and the drawer. `numTrades` matches the selected window across surfaces. Non-top-N copy-traded wallets get real windowed numbers without N+1 per-render fan-out. P&L is position-aware or clearly labeled when estimated."
spec_refs:
  - docs/spec/poly-multi-tenant-auth.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [poly, wallet-analysis, data-api, performance, contracts]
---

# task.0346 — Poly wallet stats: Data-API-first windowed stats

## Problem

PR #976 shipped the UI unification of the wallets table but left the data layer in an inconsistent, sometimes-misleading state. Three concrete issues identified in the PR review:

1. **Mis-labeled as CLOB.** Today's wallet analytics are colloquially called "CLOB queries" but they actually hit Polymarket's public **Data API** (`data-api.polymarket.com`). CLOB (`clob.polymarket.com`) is for orderbook/pricing/trading operations; positions, activity, trades, and leaderboards live on the Data API. This project should align terminology + code boundaries to that reality.

2. **Wrong trade source + wrong window semantics.**
   - `bootstrap/capabilities/wallet.ts :: listTopTraders` calls `listUserActivity(user, limit=500)` to compute a `numTrades` override. `/activity` is capped at 500, mixes `TRADE` with `SPLIT/MERGE/REDEEM/...` lifecycle events, and is not windowed on our side. The resulting `numTrades` on `/research` does not match the selected `timePeriod`.
   - `features/wallet-analysis/server/wallet-analysis-service.ts :: getSnapshotSlice` computes PnL/ROI/WR from up to 500 recent trades + hardcoded 14d/30d helpers (`computeWalletMetrics`), and never honors `timePeriod`.
   - `/trades` (the dedicated trade feed, up to 10k rows per call) is the correct source for windowed trade counts + volume.

3. **Naive windowed P&L is not authoritative.** Polymarket's positions model exposes `currentValue`, `cashPnl`, `realizedPnl`. A "filter trades by `sinceTs`, sum cashflows" approach drifts for positions that cross the window boundary. Windowed P&L needs either a position-aware cost-basis walk or a clear "app-estimated" label — not pretended-authoritative.

4. **N+1 fetch architecture in two places.**
   - `CopyTradedWalletsCard` in this PR uses two leaderboard queries (WEEK + ALL) keyed by each copy-traded wallet client-side. Works for now, but scales linearly with the target list and doesn't give us `numTrades` consistency for the drawer.
   - `listTopTraders` enrichment iterates per-wallet server-side. Polymarket's published general rate limit is high so this doesn't explode immediately, but a batched server endpoint with short-TTL per-(wallet,window) cache is the top-0.1% path.

## Scope

### In

- **Contract** — add `packages/node-contracts/src/poly.wallet-window-stats.v1.contract.ts`:

  ```ts
  export const WalletWindowStatsSchema = z.object({
    proxyWallet: PolyAddressSchema,
    timePeriod: z.enum(["DAY", "WEEK", "MONTH", "ALL"]),
    volumeUsdc: z.number(),
    pnlUsdc: z.number(),
    pnlKind: z.enum(["authoritative", "estimated"]),
    roiPct: z.number().nullable(),
    numTrades: z.number().int().nonnegative(),
    numTradesCapped: z.boolean(),
    computedAt: z.string(),
  });
  export const WalletWindowStatsBatchSchema = z.object({
    timePeriod: z.enum(["DAY", "WEEK", "MONTH", "ALL"]),
    stats: z.record(PolyAddressSchema, WalletWindowStatsSchema),
  });
  ```

  Re-export from `@cogni/node-contracts`. `pnlKind` is the honesty knob — `authoritative` when we use the Polymarket positions API (`cashPnl` / `realizedPnl`), `estimated` when we fall back to trade-cashflow summation.

- **Polymarket client** — on `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`, add `listTrades({ user, sinceTs, until?, limit? })` targeting Data-API `/trades` (not `/activity`). Cap defaults: `limit=10_000`. Clearly separate from the existing `listUserActivity` which stays for lifecycle events.

- **Capability method** — `walletCapability.getWalletWindowStats({ address, timePeriod })` on `nodes/poly/app/src/bootstrap/capabilities/wallet.ts`:
  - Computes `volumeUsdc`, `numTrades`, `numTradesCapped` from `listTrades({ sinceTs: tsForPeriod })`.
  - For `pnlUsdc`: prefer `listUserPositions(address)` + market resolution for a cost-basis-aware number (`pnlKind: "authoritative"`). Fallback to trade-cashflow sum (`pnlKind: "estimated"`) when positions data is unavailable.
  - Shared math with `computeWalletMetrics` where the same inputs apply.

- **Batched route** — `POST /api/v1/poly/wallets/stats` with body `{ timePeriod, addresses: string[] }` returning `WalletWindowStatsBatchSchema`. Server uses `p-limit` fan-out + an in-memory short-TTL cache keyed by `(wallet, timePeriod)` (TTL ~60s; survives within a single worker, re-populates on miss). Zod-validate req + res.

- **Consumers (swap in)**:
  - `CopyTradedWalletsCard` — drop the two-tier leaderboard fallback, fetch once: `POST /wallets/stats { timePeriod: "WEEK", addresses: copyTargets }`. Keep the `statsSource` pill semantics but drive them from `pnlKind` + cache-hit metadata.
  - `listTopTraders` enrichment — replace the per-wallet `listUserActivity(limit=500)` loop with a single `getWalletWindowStats` call per wallet, piped through the same cache. Result: `numTrades` column on `/research` matches the selected `timePeriod`.
  - `WalletDetailDrawer` — add a period toggle (`DAY | WEEK | MONTH | ALL`) in the header. On change, call `POST /wallets/stats` for that single address and render the window-scoped `volumeUsdc` / `pnlUsdc` / `numTrades` in a header strip above the existing snapshot/trades/balance slices.

- **Unit tests** — coverage for `getWalletWindowStats`: `DAY` / `WEEK` / `MONTH` / `ALL` filtering, 10k-cap flag, `authoritative` vs `estimated` `pnlKind` branches, cache hit/miss accounting.

### Out

- Category classification — tracked separately; deliberately unspecified here.
- Any UI structural changes beyond the drawer header strip and consumer wiring — the table + column layout shipped in PR #976 is the final shape.
- Historical backfill / denormalization into Dolt — a later task if we ever need pre-computed leaderboards at our own time windows.
- CLOB queries — this task is explicitly Data-API-first. CLOB endpoints only used where already in the codebase (operator balance, market resolution).

## Validation

### Contract

- **exercise:** `POST /api/v1/poly/wallets/stats` with 10 addresses × each of `DAY`/`WEEK`/`MONTH`/`ALL` returns a populated `stats` map with every requested address, with `numTrades` and `volumeUsdc` matching the window.
- **observability:** Loki at deployed SHA — `{service="poly-node-app"} |~ "/api/v1/poly/wallets/stats"` — one request per page render (not per-wallet), plus inner `listTrades` fan-out tagged with `(wallet, timePeriod)` for cache-hit inspection.

### Consistency

- **exercise:** On `/research` at `timePeriod=DAY`, the `# Trades` column equals `POST /wallets/stats` response `numTrades` for at least three spot-checked wallets. On the dashboard card, copy-traded wallets that are NOT in this week's top-50 still show non-zero `numTrades` when they traded at all this week (the current PR falls back to all-time — this task fixes it to be actual-week).
- **observability:** Grafana panel comparing per-wallet `numTrades` surfaced across the three consumers (dashboard, research, drawer) for a fixed `(wallet, timePeriod)` — they must match.

### Drawer

- **exercise:** Open the drawer on any wallet; flip the period toggle `DAY → WEEK → MONTH → ALL`; header strip `numTrades` and `volumeUsdc` update within ~100ms on repeat toggles (cache hit).
- **observability:** `{service="poly-node-app"} |~ "/api/v1/poly/wallets/stats"` shows exactly one request per unique `(wallet, timePeriod)` pair within the 60s cache window.

## Out of Scope

See "Out" above. Not owned by this task: category UX, historical backfill, CLOB routing decisions.

## Notes

- Blocks work that wants a reliable `numTrades` per window on `/research` and any future "leaderboard at our own time window" UI.
- Blocked by: nothing — can start immediately after PR #976 merges. The two-tier leaderboard fallback in `CopyTradedWalletsCard` is the temporary bridge until this ships.
- Naming: stay precise. "CLOB" = `clob.polymarket.com` (pricing/orderbook/execution). "Data API" = `data-api.polymarket.com` (positions/trades/activity/leaderboards). Wallet research is Data API-first.
