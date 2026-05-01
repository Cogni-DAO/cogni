# wallet-watch · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Generic Polymarket wallet observation primitive. Emits normalized `Fill[]` for a watched wallet since a prior cursor. Consumed by the mirror-coordinator (CP4.3d) today; any future feature that needs to observe a Polymarket wallet (PnL tracker, research tool, audit view) plugs in here without importing copy-trade vocabulary.

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [Phase 1 spec](../../../../../../docs/spec/poly-copy-trade-phase1.md)
- [Root poly node AGENTS.md](../AGENTS.md)
- Sibling layers: [../copy-trade/AGENTS.md](../copy-trade/AGENTS.md), [../trading/AGENTS.md](../trading/AGENTS.md)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["features", "ports", "core", "shared", "types"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "contracts"
  ]
}
```

`wallet-watch/` is intentionally siloed from `copy-trade/` and `trading/`. It produces `Fill[]` (from `@cogni/market-provider`) and has no opinion on what happens next. The cross-slice no-import rule is enforced by review + the `WALLET_WATCH_IS_GENERIC` invariant below; the AGENTS.md validator only models coarse layers.

## Public Surface

- **Exports (port):** `WalletActivitySource` — `fetchSince(since?: number) → {fills, newSince}` from `@cogni/poly-market-provider`.
- **Exports (adapter):** `createPolymarketActivitySource({ client, wallet, logger, metrics, limit? })` — package-owned Data-API implementation re-exported for compatibility.
- **Exports (metrics):** `WALLET_WATCH_METRICS` — bounded Prom label set alias for the package-owned metric constants.
- **Exports (types):** `NextFillsResult`, `PolymarketActivitySourceDeps`.
- **Exports (adapter — websocket, task.0322):** `createPolymarketWsActivitySource({ client, ws, wallet, logger, metrics, limit?, refreshAssetsIntervalMs? })` — shared Market-channel WS as wake-up signal + per-wallet Data-API drain. Selected by `POLY_WALLET_WATCH_SOURCE=websocket`.
- **Exports (metrics):** `WALLET_WATCH_METRICS` (polling) + `WALLET_WATCH_WS_METRICS` (ws-only counters).
 - **Exports (types):** `NextFillsResult`, `PolymarketActivitySourceDeps`, `PolymarketWsActivitySourceDeps`.

## Invariants

- **WALLET_WATCH_IS_GENERIC** — files in this slice MUST NOT import `features/copy-trade/` or `features/trading/`. Emits the neutral `Fill` shape from `@cogni/market-provider/domain/order`.
- **DA_EMPTY_HASH_REJECTED** — the underlying normalizer rejects empty-tx rows + emits `poly_mirror_data_api_skip_total{reason:"empty_transaction_hash"}`. Pinned fill_id shape is `"data-api:<tx>:<asset>:<side>:<ts>"` per task.0315 Phase 0.2.
- **CURSOR_IS_MAX_TIMESTAMP** — `newSince` = `max(trade.timestamp)` across the returned page (unix seconds). Callers persist + feed back next tick. Server-side filtering lives inside the Data-API client.

## Responsibilities

- Re-export the `WalletActivitySource` port and Polymarket Data-API implementation used by the mirror path.
- Emit bounded-label skip counters for normalizer rejections (empty-tx, non-positive size/price, missing asset/conditionId, invalid side).
- Stay observation-only — no writes, no decisions, no placements.

## Notes

- **WS source (task.0322):** `createPolymarketWsActivitySource` is the WS-driven sibling. The mirror-coordinator doesn't notice the swap — `source` argument is the port. **WS_NO_WALLET_IDENTITY:** Polymarket's public Market channel does NOT carry maker/taker addresses, so the WS only acts as a wake-up; canonical fills still come from the Data-API. This eliminates the polling-source `limit>20` stale-cache symptom because we only fetch when a watched market actually trades.
- **Not in this slice:** scheduler tick + cadence (lives in `bootstrap/jobs/copy-trade-mirror.job.ts`); the DB cursor persistence (kept on the coordinator's `runOnce` deps, since the coordinator owns the overall loop state); the decision / policy (lives in `features/copy-trade/`).
- **Data-API pagination:** v0 uses the client default limit (100) with a client-side `sinceTs` filter. Bursty targets can raise via `limit` ctor arg. When activity exceeds one page between polls, v0 loses the tail — acceptable for P1 single-target prototype; P4 WS eliminates the issue.
