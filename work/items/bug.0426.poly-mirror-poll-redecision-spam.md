---
id: bug.0426
type: bug
title: "Mirror poll re-decisions every fill 11–12× per hour — no cursor on data-api `/trades` poll"
status: needs_triage
priority: 2
rank: 20
estimate: 2
summary: "Each unique target fill_id flows through `poly.mirror.decision` 11–12 times per hour on production. CLOB-level idempotency works correctly (the same `client_order_id` is never placed twice), but the data-api `/trades` poll has no cursor — every 30s tick re-fetches the same trade window, the pipeline runs `mirror.decision` on every fill, hits the DB to check `INSERT_BEFORE_PLACE`, and skips. The `placed/skipped/error` ratio in 1h on production was 92 / 998 / 2474 — i.e. for every real placement we do ~10 redundant decision-cycle round-trips. Wastes Postgres roundtrips, log volume, and pipeline CPU. Will get worse linearly with target count and the planned shared-poller fan-out (task.0332)."
outcome: "Mirror poll cursors past the most-recent processed fill_id (per target) so the same fill is decisioned at most once. `mirror.decision outcome=skipped reason=already_placed` rate drops by ~10× on production. CLOB calls and DB rows unchanged (idempotency was already working). Specifically out of scope: changing fill_id semantics, changing the at-most-once guarantee, changing FOK/limit choice."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
labels: [poly, copy-trading, polling, observability, performance]
external_refs:
  - work/items/task.0332.poly-mirror-shared-poller.md
  - work/items/task.0424.poly-bet-sizer-per-position-cap.md
  - nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts
  - nodes/poly/app/src/features/copy-trade/wallet-watch.ts
---

# bug.0426 — Mirror poll re-decisions every fill many times

## Symptom

Production (last 1h, after V2 cutover, single tenant, 2 active copy-trade targets):

| `mirror.decision` outcome      | count |
| ------------------------------ | ----: |
| `error placement_failed`       |  2474 |
| `skipped already_placed`       |   998 |
| `placed ok`                    |    92 |

Per-fill_id breakdown: each unique `fill_id` shows up in `mirror.decision` 11–12 times. First time → real placement attempt (logged once as `error` if CLOB rejects, or `placed ok` on accept). Subsequent 10–11 polls → `skipped already_placed`.

## Why this happens

`INSERT_BEFORE_PLACE` correctly prevents double-placement at the COID layer — that's the at-most-once guarantee, working as designed. The cursor pipeline (`getCursor` / `setCursor` / `WalletActivitySource.fetchSince`) is also wired correctly end-to-end. The bug is in **two specific pieces** that conspire to defeat the cursor:

1. **Client-side filter is `>=`, not `>`.** `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts:220`:
   ```ts
   if (params?.sinceTs !== undefined) {
     const since = params.sinceTs;
     return trades.filter((t) => t.timestamp >= since);
   }
   ```
   The cursor (`newSince`) is set to `max(trade.timestamp)` from the prior tick. On the next tick, the boundary fill (`t.timestamp === since`) is re-included. Off-by-one — `>=` should be `>`.

2. **`limit=1000` and no server-side cutoff.** Same client, line 213: `url.searchParams.set("limit", String(params?.limit ?? 1000))`. The Polymarket data-api endpoint does not accept a `since` query param — we always pull the most recent 1000 trades and filter client-side. For high-frequency targets producing 100+ fills/min, the 1000-trade window covers ~10 minutes; every 30s tick re-pulls all fills inside that window and only filters out the ones older than `since`. Each new fill therefore re-enters `mirror.decision` ~20× before it falls off the back of the 1000-row window.

The decision pipeline then runs steps 1–5 for every fill in the returned window every 30s:

1. `mirror-pipeline.runMirrorTick()` fires.
2. `WalletActivitySource.fetchSince(cursor)` returns the over-broad window.
3. Each fill is fed into the decision logic.
4. `clientOrderIdFor(target_id, fill_id)` derives the COID; ledger snapshot lookup hits `poly_copy_trade_fills`.
5. COID found → log `skipped already_placed` and exit.

This is wasted DB load + log cardinality, not an at-most-once bug. CLOB sees exactly one placement per fill_id.

## Why it's worth fixing now (not later)

- **Linear in target count.** Every new target multiplies the wasted work. task.0332 (shared poller) will fan-out target count significantly.
- **Pollutes observability.** 998 `skipped already_placed` lines per hour for one tenant drowns out the signal in `mirror.decision` queries. With 10 targets that's 10K/h.
- **Cheap to fix.** A per-target cursor (last processed `fill_id` or `lastFilledTimestamp`) caps re-decisions at the natural poll-overlap window (1–2 ticks).

## Scope

**v0 fix — one-line filter correction.** Change the boundary filter in `polymarket.data-api.client.ts` from `t.timestamp >= since` to `t.timestamp > since`. That alone caps the boundary fill from re-replaying. Coupled with the existing in-memory cursor (`copy-trade-mirror.job.ts` `NO_CURSOR_PERSISTENCE_V0`), each fill should be processed at most once per pod lifetime under steady-state.

**Limit-window narrowing — separate concern, separate task if needed.** The 1000-trade fetch is over-broad for high-frequency targets and can mask a stale cursor on a slow tick. Reducing to a smaller `limit` (e.g. `limit = 100`) trades safety against bursty targets for less wasted work. Defer until v0 fix lands and we can re-measure on production. Don't fold into this bug.

Cursor persistence (across pod restarts) is `NO_CURSOR_PERSISTENCE_V0`'s deferred follow-up — also out of scope here.

**Idempotency invariant unchanged.** The COID-level guard stays exactly as is. This bug is purely a "don't do redundant work upstream of an already-correct guard."

## Out of scope

- Migrating from data-api poll → CLOB websocket (task.0322 / Phase 4).
- Changing fill_id semantics (`FILL_ID_FROZEN` per the phase-1 spec).
- Reducing FOK rejection rate (separate concern; that's bug.0405's domain — design choice, not a bug here).
- Caching market metadata reads (different shape).

## Files to touch

- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts:220` — `>=` → `>` on the `sinceTs` filter.
- `packages/market-provider/test/...` — add a unit fixture: fetch with `sinceTs = T`, assert a trade with `timestamp === T` is NOT returned but `T+1` IS.

## Validation

**exercise:** with at least one active target on candidate-a, watch two successive poll cycles. The second should produce zero `skipped already_placed` log lines for fill_ids covered by the first.

**observability:**

```logql
sum(count_over_time({env="candidate-a", service="app"}
  | json
  | event="poly.mirror.decision"
  | reason="already_placed" [5m]))
```

Pre-fix baseline on production: ~85/min for single tenant + 2 targets. Post-fix expectation: <5/min (only the natural overlap ticks).
