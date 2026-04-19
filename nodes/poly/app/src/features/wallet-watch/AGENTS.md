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

- **Exports (port):** `WalletActivitySource` — `fetchSince(since?: number) → {fills, newSince}`.
- **Exports (adapter):** `createPolymarketActivitySource({ client, wallet, logger, metrics, limit? })` — Data-API implementation.
- **Exports (metrics):** `WALLET_WATCH_METRICS` — bounded Prom label set.
- **Exports (types):** `NextFillsResult`, `PolymarketActivitySourceDeps`.

## Invariants

- **WALLET_WATCH_IS_GENERIC** — files in this slice MUST NOT import `features/copy-trade/` or `features/trading/`. Emits the neutral `Fill` shape from `@cogni/market-provider/domain/order`.
- **DA_EMPTY_HASH_REJECTED** — the underlying normalizer rejects empty-tx rows + emits `poly_mirror_data_api_skip_total{reason:"empty_transaction_hash"}`. Pinned fill_id shape is `"data-api:<tx>:<asset>:<side>:<ts>"` per task.0315 Phase 0.2.
- **CURSOR_IS_MAX_TIMESTAMP** — `newSince` = `max(trade.timestamp)` across the returned page (unix seconds). Callers persist + feed back next tick. Server-side filtering lives inside the Data-API client.

## Responsibilities

- Own the `WalletActivitySource` port and its Polymarket Data-API implementation.
- Emit bounded-label skip counters for normalizer rejections (empty-tx, non-positive size/price, missing asset/conditionId, invalid side).
- Stay observation-only — no writes, no decisions, no placements.

## Notes

- **Swap target:** P4 adds a `createPolymarketWsSource` sibling that implements the same `WalletActivitySource` port from a WebSocket user-channel stream. The mirror-coordinator doesn't notice the swap; its `source` argument is the port, not the Data-API adapter directly.
- **Not in this slice:** scheduler tick + cadence (lives in `bootstrap/jobs/copy-trade-mirror.job.ts`); the DB cursor persistence (kept on the coordinator's `runOnce` deps, since the coordinator owns the overall loop state); the decision / policy (lives in `features/copy-trade/`).
- **Data-API pagination:** v0 uses the client default limit (100) with a client-side `sinceTs` filter. Bursty targets can raise via `limit` ctor arg. When activity exceeds one page between polls, v0 loses the tail — acceptable for P1 single-target prototype; P4 WS eliminates the issue.
