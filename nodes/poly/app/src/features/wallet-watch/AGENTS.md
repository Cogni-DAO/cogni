# wallet-watch · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Generic Polymarket wallet observation primitive. Emits normalized `Fill[]` for a watched wallet since a prior cursor. Consumed by the mirror-coordinator (CP4.3d) today; any future feature that needs to observe a Polymarket wallet (PnL tracker, research tool, audit view) plugs in here without importing copy-trade vocabulary.

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [task.0322 — WS source replacement](../../../../../../work/items/task.0322.poly-copy-trade-phase4-design-prep.md)
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

- **Exports (port):** `WalletActivitySource` — `fetchSince(since?: number) → {fills, newSince}`, plus optional `subscribeWake(cb) → unsubscribe` for push-on-wake (sub-second coordinator dispatch on watched-asset WS frames). Sources that omit `subscribeWake` degrade cleanly to safety-net polling.
- **Exports (adapter):** `createPolymarketWsActivitySource({ client, ws, wallet, logger, metrics, limit?, refreshAssetsIntervalMs? })` — shared Polymarket Market-channel WebSocket as wake-up signal + per-wallet Data-API drain. The only wallet-watch source as of task.0322 (replaced the prior 30s page-poll).
- **Exports (metrics):** `WALLET_WATCH_METRICS` (drain counters) + `WALLET_WATCH_WS_METRICS` (WS-specific counters).
- **Exports (types):** `NextFillsResult`, `PolymarketWsActivitySourceDeps`.

## Invariants

- **WALLET_WATCH_IS_GENERIC** — files in this slice MUST NOT import `features/copy-trade/` or `features/trading/`. Emits the neutral `Fill` shape from `@cogni/market-provider/domain/order`.
- **DA_EMPTY_HASH_REJECTED** — the underlying normalizer rejects empty-tx rows + emits `poly_mirror_data_api_skip_total{reason:"empty_transaction_hash"}`. Pinned fill_id shape is `"data-api:<tx>:<asset>:<side>:<ts>"` per task.0315 Phase 0.2.
- **CURSOR_IS_MAX_TIMESTAMP** — `newSince` = `max(trade.timestamp)` across the returned page (unix seconds). Callers persist + feed back next tick.
- **WS_NO_WALLET_IDENTITY** — Polymarket's public Market channel does NOT carry maker/taker addresses. The WS only acts as a wake-up signal; canonical fill identity (`transactionHash`, `proxyWallet`) comes from the Data-API drain.
- **WAKE_FANOUT_ISOLATED** — `subscribeWake` callbacks fire inside `onTrade`. One bad subscriber MUST NOT prevent other subscribers from running, MUST NOT escape `onTrade`, and MUST NOT block the safety-net path. Implementations wrap each callback in try/catch + warn-log.

## Responsibilities

- Own the `WalletActivitySource` port and its Polymarket WS-driven implementation.
- Emit bounded-label skip counters for normalizer rejections (empty-tx, non-positive size/price, missing asset/conditionId, invalid side).
- Stay observation-only — no writes, no decisions, no placements.

## Notes

- **Why WS-only**: the prior page-poll hit a Polymarket Data-API caching quirk (limit>20 served stale pages by minutes — see PR #1170) and burned API budget on idle ticks. The WS source provides instant detection on known-asset trades and a Data-API safety-net drain at parity-with-polling cadence for new-market discovery.
- **Detection-latency parity, not improvement** (this PR): the mirror coordinator still ticks on a 30s `setInterval` (`bootstrap/jobs/copy-trade-mirror.job.ts`). WS frames flip an in-memory `pendingWakeup` flag, drained on the next coordinator tick. Worst-case latency from target-trade → mirror-decision matches the polling source (~30s). True latency reduction is Phase 4 task.0322 (Temporal-hosted WS ingester that bypasses the tick).
- **Why a safety-net drain** (`SAFETY_NET_DRAIN`): the WS Market channel only fires for `asset_id`s we've already subscribed to. Subscriptions come from `listUserPositions(wallet)` on a 60s asset-refresh interval, so a target's first BUY into a market they don't already hold has no WS subscription yet. Without the safety net, that trade waits up to 60s for asset-refresh — a regression vs polling. With the safety net at 30s (matching the coordinator tick), `fetchSince` drains regardless of WS wake whenever `now - lastDrainAt >= safetyNetDrainIntervalMs`, restoring polling-source detection latency while still benefiting from instant wakes on known assets.
- **Honest API-spam accounting**: idle wallets still hit Data-API roughly once per coordinator tick (via the safety net). Active wallets see API calls dominated by actual trade activity rather than blind cadence. The original "zero idle calls" claim is intentionally traded for new-market detection parity.
- **Shared-asset correctness** (`SHARED_ASSET_REFCOUNT`): one WS client is multiplexed across many per-wallet sources. The client refcounts asset subscriptions so two wallets owning the same outcome token can both receive frames; one wallet exiting the position only drops the remote subscription when the last holder releases. Per-source `stop()` calls `unsubscribeAsset` for each owned asset, which is safe under refcount.
- **Liveness (zombie-WS)**: each per-wallet source emits `event:"poly.wallet_watch.ws.heartbeat"` at info every `heartbeatIntervalMs` (default 5min) carrying `frames_received_window`, `ws_wakes_window`, `owned_assets_count`, `last_frame_at`, and `last_drain_at`. Loki absence-alert on the heartbeat is the zombie-WS surface — no in-app watchdog. The WS client also logs connect (info) and disconnect/error/reconnect (warn) for state transitions. Both alerting surfaces conform to `docs/spec/observability.md`.
- **Multi-wallet scaling (future)**: per-wallet `ownedAssets` reconciliation is O(N) sources × O(M) positions per asset-refresh tick. At >50 wallets a single `PolymarketWsActivitySourceManager` per pod with a global `assetId → Set<walletId>` index is cleaner — tracked in [proj.poly-copy-trading](../../../../../../work/projects/proj.poly-copy-trading.md) Phase 4. This is an efficiency follow-up, not a correctness gap (refcounting closes that).
- **Not in this slice:** scheduler tick + cadence (lives in `bootstrap/jobs/copy-trade-mirror.job.ts`); the DB cursor persistence (kept on the coordinator's `runOnce` deps, since the coordinator owns the overall loop state); the decision / policy (lives in `features/copy-trade/`).
