---
id: poly-backfill-handoff-2026-05-05
type: research
title: "Handoff: poly target-wallet backfill — efficiency + data expansion"
status: draft
trust: draft
summary: "Hand-off for the next dev picking up the poly backfill thread. Covers what's deployed (PR #1252), what data is in candidate-a, the slow-snapshot bug at 836 K-row scale, the trades-slice 8 s gap, and the path to load more wallets / lifetimes."
read_when: "You're the next dev assigned poly-backfill efficiency or data-expansion. Read this before touching `wallet-analysis-service.ts` or running `walk.ts` against another wallet."
owner: derekg1729
created: 2026-05-05
implements: spike.5024
tags: [poly, backfill, handoff, performance]
---

# Handoff — poly backfill: efficiency + more data

This is the hand-off for whoever picks up after spike.5024 / PR #1252. Two threads:

1. **Efficiency** — snapshot is 33 s on 836K rows; projects to 3 min at 6 months. Several other slices are also slower than they should be.
2. **More data** — we have 1 month of RN1 fills + lifetime PnL points. We want lifetime fills, swisstony fills, and a path that scales to N curated wallets.

Neither is in scope for PR #1252 — the spike's bar was "data flowing + snapshot architecturally correct + critical OOMs fixed", and that's all green. This is the **next sprint's** punch list.

## What's already deployed (don't redo)

PR #1252 merged `2026-05-05`. Candidate-a serves:

- ✅ `getSnapshotSlice` SQL-aggregated. `O(uniqueMarkets)` instead of `O(fills)` in JS heap. Parity oracle test asserts bit-equivalence to `computeWalletMetrics` JS function.
- ✅ `getExecutionSlice` SQL filter by current-position `condition_id` set. Bound by ≈ EXECUTION_OPEN_LIMIT + EXECUTION_HISTORY_LIMIT (~48 markets) regardless of wallet fill count.
- ✅ `runPriceHistoryTick` worker-pool fix (bug.5168). Replaces `Promise.all(assets.map(asset => limit(...)))` with cursor-based pool. Heap is `O(concurrency × payload)` not `O(assets × payload)`.
- ✅ Backfill scripts: `walk.ts` + `walk-windows.sh` + `load.ts` + `pnl-backfill.ts` + `probe.sh` under `scripts/experiments/poly-backfill/`.
- ✅ Operator runbook: `docs/guides/poly-target-backfill.md`.

In candidate-a's `cogni_poly`:

- `poly_trader_fills`: **836 K RN1 rows** (798 K backfilled, span 2026-04-05 → 2026-05-05) + ~25 K swisstony rows (live tick only).
- `poly_trader_user_pnl_points`: RN1 7,103 1h-points (270 d back to 2025-07-10) + 301 1d-points; swisstony 6,366 1h-points + 270 1d-points.
- `poly_market_outcomes`: ~600 rows (CP3 tick is filling slowly).
- `poly_market_price_history`: live writer post bug.5168 fix; not OOMing anymore.

## Don't redo

- ❌ **Don't write a Gamma fetcher.** Empirical 14,460 of 14,462 markets returned 429 at fan-out 10. **PR #1265** ("persist Gamma market metadata to canonical table") supersedes — adds `poly_market_metadata` table + Data API method. Use it.
- ❌ **Don't add `LIMIT N` to read-path queries** as a band-aid. The reviewer flagged that as silent truncation; the snapshot path's SQL aggregation is the right pattern. CP9 (distributions) and any new slice should follow it.
- ❌ **Don't reintroduce `Promise.all(big_array.map(limit(...)))` in writer ticks.** Worker-pool form (bug.5168 fix) is mandatory. The pre-existing `pLimit` import is removed; don't add it back.

## Thread 1: Efficiency — snapshot 33 s, trades 8 s, benchmark 3.2 s

Measured on candidate-a (836 K-row RN1) right after flight `d64601f89`:

| slice         |     latency | shape                                     |
| ------------- | ----------: | ----------------------------------------- |
| **snapshot**  | **🔴 33 s** | SQL aggregator with full `raw` jsonb scan |
| trades        |      🟡 8 s | simple `LIMIT 500` — should be sub-second |
| benchmark     |    🟡 3.2 s | unprofiled                                |
| distributions |   🟢 0.86 s | bounded at 25 K most-recent fills         |
| execution     |   🟢 0.55 s | filtered by current-position cids         |
| pnl           |   🟢 0.68 s | reads `poly_trader_user_pnl_points`       |

### Root cause: snapshot's `MAX(raw->'attributes'->>'title')`

`readPositionAggregatesFromDb` in `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts`:

```sql
SELECT … MAX(raw->'attributes'->>'title') AS title …
FROM poly_trader_fills f INNER JOIN poly_trader_wallets w ON …
WHERE w.wallet_address = $1
GROUP BY condition_id, token_id
```

The WHERE clause uses the `(trader_wallet_id, observed_at)` index. Then PG **reads 836 K × ~600 byte `raw` jsonb columns** to compute the per-position MAX of title. That's ~500 MB of TOAST-decompressed payload per request. At 6 months / 5 M rows, this projects to ~3 GB read = ~3 min.

The aggregate itself (~14 K output rows) is fine. **The bottleneck is the jsonb scan to recover one string field**.

### Fix shape (small follow-up PR)

1. Drop the title from `readPositionAggregatesFromDb`. The aggregator now returns just numeric per-position fields — fast, no jsonb read.
2. Add `readTopMarketTitlesFromDb(db, walletAddrLower, conditionIds: string[], limit: 4)` — a separate small query that fetches the `raw->>'title'` for ONLY the top-N condition_ids (the 4 we surface in `topMarkets`). Sub-millisecond at any scale because it scans at most a few rows per cid.
3. `composeSnapshotFromAggregates` keeps the topMarkets dedup logic; the title comes from the small query result.

Same `WalletMetrics` output, no jsonb scan in the hot path.

### Other slices

- **trades 8 s**: `getTradesSlice` does plain `WHERE wallet=$ ORDER BY observed_at DESC LIMIT 500`. Should be sub-second with the existing index. Almost certainly an index mismatch or a planner regression — `EXPLAIN ANALYZE` it on candidate-a's actual data, look for a Sort node with rows=836K. Likely fix: ensure the planner picks `poly_trader_fills_trader_observed_idx` over a sequential scan (could be the join order causing it to scan wallets first).
- **benchmark 3.2 s**: `copy-target-benchmark-service.ts`, unprofiled. Same diagnostic — EXPLAIN ANALYZE first, then decide.

### Validation

After the fix, on the same RN1 dataset:

- `curl /api/v1/poly/wallets/<RN1>?include=snapshot` → **<2 s p95** (currently 33 s)
- Repeat at 5 M rows (use synthetic fixture in test) → **<5 s p95**

## Thread 2: More data

Derek wants more wallets, more lifetimes, the corpus growing.

### What's already in the DB

| wallet    |                         fills |     pnl_points (1h) |     pnl_points (1d) |                      metadata coverage |
| --------- | ----------------------------: | ------------------: | ------------------: | -------------------------------------: |
| RN1       |  836 K (1 mo backfill + live) | 7 K (full lifetime) | 301 (full lifetime) | ~600 markets resolved (~3% of touched) |
| swisstony | 25 K (live tick only, ~1.5 d) | 6 K (full lifetime) | 270 (full lifetime) |                             barely any |

### Concrete next loads

Each step is a ~10–60 min wall-clock job per the operator guide (`docs/guides/poly-target-backfill.md`). All require the SSH tunnel to candidate-a's `cogni_poly`.

**Step 1: swisstony 30-day backfill (mirror RN1)**. ~10 min walk + ~8 min load via tunnel. Comparable volume to RN1. Will trigger CP7's price-history tick to fan out to swisstony's 5 K-ish unique assets in the 7-day window — should be fine post bug.5168.

**Step 2: extend RN1 to lifetime (~9 months)**. user-pnl-api shows RN1 first traded 2025-07-10. Walking 9 months at RN1's empirical rate: 27 K/day × 270 d ≈ 7.3 M fills. At ~1.6 K rows/s loader throughput, that's ~75 min DB load. Walking is faster (the `walk-windows.sh` orchestrator can fan out 12 monthly windows in parallel).

**Step 3: swisstony lifetime (~9 months)**. Same shape, same scale.

**Critical sequencing**: do swisstony 30 d FIRST so the snapshot read path (post-fix from Thread 1) gets a second-wallet stress test before lifetime fills land. If snapshot is still slow on swisstony's 800 K-fill 30 d corpus, fix the read path before adding more.

### Beyond the curated two

- Add to bootstrap config (`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`) so the live tick seeds the wallet record. Run live tick once, THEN backfill.
- Same script flow per the operator guide.
- Consider whether to keep `raw.backfill_source = 'spike.5024'` tag, or use a per-batch tag like `raw.backfill_source = 'handoff.<date>'` so each batch is independently revertable.

### What unblocks the dashboard tabs

After Thread 1 + Thread 2 land:

- **Snapshot, Fills, Hour of day, Bets/market, Trade size, Entry price, USDC** — all render correctly for both wallets.
- **Size P/L, Time in position, Entries/outcome** — dependent on `poly_market_outcomes` populating. Two paths:
  - CP3's `runMarketOutcomeTick` will catch up over time (slow, but free).
  - **PR #1265** lands a `poly_market_metadata` writer + Data API method — much faster than the Gamma rate-limit dance. Once 1265 merges, those three tabs light up.
- **Target overlap, Trader comparison, WIN RATE** — depend on both wallets' fills + outcomes. Will populate fully after Thread 2 + #1265.

## Pointers

- **Operator runbook**: `docs/guides/poly-target-backfill.md` — step-by-step for any backfill batch
- **As-built design**: `docs/research/poly/backfill-spike-2026-05-05.md` — the spike's full design + rejected alternatives + post-flight scoreboard
- **PR #1252** (this work, merged): SQL aggregator, CP7 fix, race-fix, scripts
- **PR #1265** (in flight): Gamma metadata persistence — wait for this before touching `poly_market_outcomes`
- **bug.5168**: CP7 worker-pool root cause + fix (closed by this PR)
- **CP9 (not yet filed)**: SQL-aggregate distributions histograms (`width_bucket` + `PERCENTILE_DISC`). Pattern reference is the snapshot SQL aggregator.

## Validation contract for whoever picks this up

1. **Pick the snapshot perf bug first** — without it, no further backfill is safe (more data → slower → users notice).
2. After the snapshot fix lands + flighted, **measure on candidate-a's existing 836 K-row RN1**: snapshot < 2 s p95, trades < 1 s p95, benchmark < 1 s p95.
3. Run swisstony 30 d backfill per the operator guide. Re-measure. **No new perf regression** before continuing.
4. Lifetime backfills only after (1)–(3) are clean. Consider scheduling them outside peak demo hours since each load takes ~75 min and adds DB load.
5. **Do not backfill production** until candidate-a has rendered cleanly for ≥24 h with no OOMs and snapshot < 2 s p95.

## What I would do first if I had another hour

1. `EXPLAIN (ANALYZE, BUFFERS)` snapshot's `readPositionAggregatesFromDb` query on candidate-a via SSH tunnel. Confirm the jsonb scan is the bottleneck (not the index).
2. Patch — drop the `MAX(raw->>'title')`, return numeric-only per-position aggregates, add the small per-cid title fetch.
3. Re-measure. Expect 33 s → ~1 s.
4. Repeat for the trades slice (the 8 s number is suspicious — probably a planner pick).

That's the highest-leverage starting move; everything else (more data, more wallets) cascades from there.
