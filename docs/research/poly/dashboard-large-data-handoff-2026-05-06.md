---
id: dashboard-large-data-handoff-2026-05-06
type: research
title: "Handoff: poly research/data pages OOM on candidate-a after target-wallet backfill"
status: draft
trust: draft
summary: "After backfilling RN1 (~841K fills) and swisstony (~159K fills) into candidate-a's `poly_trader_fills`, the poly-node-app pod crashloops on the heap limit when the dashboard hits research routes. Symptom: `/poly` data + research pages don't render. Root cause: read-path slices that aggregate fills client-side OOM the 1Gi pod. Existing guide flagged this for `getDistributionsSlice` (CP9 follow-up) but other surfaces are also exposed. Targets backfill is correct and should NOT be reverted; the fix is on the read path."
read_when: "You're picking up dashboard scaling work, debugging why research/data tabs blank out on candidate-a/preview/prod after a backfill, planning the CP9-or-equivalent SQL aggregation refactor, or reviewing memory limits for the poly pod."
owner: derekg1729
created: 2026-05-06
implements: spike.5024
tags: [poly, dashboard, performance, oom, scaling, backfill]
---

# Dashboard pages OOM on candidate-a — handoff

## TL;DR

Backfill from spike.5024 dropped 1M+ rows into `poly_trader_fills` on candidate-a (RN1 841K, swisstony 159K, derek 258). Polymarket-truth verified at 99–100% coverage. **Backfill is correct.** But several read-path routes still aggregate fills in JS instead of SQL, so they OOM the pod when asked to render the research/data tabs for these wallets.

```
poly-node-app pod (candidate-a)
  request:    cpu 200m  memory 384Mi
  limit:      cpu 1     memory 1Gi
  state:      CrashLoopBackOff (Restart Count 4 in 31m)
  last error: FATAL ERROR: Reached heap limit Allocation failed
              GC: Mark-Compact 375.7 (386.6) -> 375.1 (387.1) MB
              allocation failure; scavenge might not succeed
```

This is an extension of the gotcha already noted in `docs/guides/poly-target-backfill.md:140` ("The 384 MB Tier-0 heap"). That guide flagged `getDistributionsSlice` as the open CP9 hole. Post-backfill on this env it's clear _more than just distributions_ is OOMing.

## Repro

1. SSH to candidate-a, confirm the pod is restarting:
   ```bash
   ssh -i .local/canary-vm-key root@84.32.109.160
   kubectl get pods -n cogni-candidate-a | grep poly-node-app
   kubectl describe pod -n cogni-candidate-a <pod> | grep -E 'Last State|Reason|Exit Code'
   ```
2. Hit the dashboard — `https://test.cognidao.org/poly` data + research tabs don't render. P/L chart works (DB-aggregated tick data). Markets / Trades research panels never resolve.
3. Pod log shows long-running route handlers right before crash (verbatim, May 6 02:52–02:53Z):
   ```
   route="poly.research.target-overlap" durationMs=22364
   route="poly.wallet-analysis"          durationMs=19187
   route="poly.wallet-analysis"          durationMs=14259
   route="poly.wallet-analysis"          durationMs= 7445
   <crash>
   ```
   Each of those is loading ~hundreds of MB into the JS heap.

## Suspect routes / files

These all read `poly_trader_fills` and were sized for active-position counts in the low thousands. Now seeing 800K+ rows per target wallet.

| route                                      | file                                                                              | what it does                                                                                                               | scaling smell                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/poly/research/target-overlap` | `nodes/poly/app/src/features/wallet-analysis/server/target-overlap-service.ts`    | RN1 ⨯ swisstony market-bucket overlap                                                                                      | SQL is mostly aggregated, but joins `poly_trader_fills` for both targets in one query. 22s wall-clock on candidate-a — likely large hash-join + transient JSON serialization. |
| `GET /api/v1/poly/wallets/[addr]?slices=…` | `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts`   | research slices: `getTradesSlice` / `getDistributionsSlice` / `getSnapshotSlice` / `getBalanceSlice` / `getExecutionSlice` | `getDistributionsSlice` documented as CP9 (still has 25K most-recent cap, JS-side aggregation). Other slices may be similarly exposed; needs heap-budget audit.               |
| `runPriceHistoryTick` (sibling)            | `nodes/poly/app/src/features/wallet-analysis/server/price-history-service.ts:233` | `selectDistinct(tokenId)` from fills then fan-out per asset                                                                | bug.5168 fixed the `Promise.all` form, but the fan-out source is now ~10K assets/wallet vs the original ~hundreds. Confirm worker-pool cap still bounds heap.                 |

`target-overlap` is the most likely OOM trigger — it's the only research route in the code that joins both target wallets' fills in a single query. With ~1M total target fills and a one-row-per-fill projection before aggregation, it's plausible to peak ~300–500MB.

## What's NOT broken

- Backfill itself: spot-checked at 100/100 (RN1 mid-window) and 98/100 (swisstony, boundary dedupe artifact). polymarket truth = DB. Don't revert.
- Live ticks: `runMarketOutcomeTick`, `runPriceHistoryTick`, `runTraderObservationTick` are all running; outbound calls visible in logs right up until crash.
- P/L chart, current_positions read model, `poly_market_metadata` / `poly_market_outcomes` writers — all stable.

## Recommended approach

1. **First: confirm the OOM caller**. Add `userId` + `route` + `durationMs` heap-watermark logging at request-end to pin which route is over budget. The 22s `target-overlap` is the obvious first suspect; verify before refactoring.
2. **CP9-style SQL aggregation**:
   - Move `getDistributionsSlice` histograms to `width_bucket` + `PERCENTILE_DISC` server-side (pattern: `getSnapshotSlice` is the reference per the existing guide).
   - `target-overlap-service.ts` is already mostly SQL-aggregated but the bucket-sum CTE may need to be split or pre-filtered. Profile with `EXPLAIN (ANALYZE, BUFFERS)` against candidate-a to confirm where the heap goes.
3. **Heap budget**: bumping the pod limit is a band-aid, not a fix. Current 1Gi limit is generous enough; the read-path is the bug. Don't raise it before #1 / #2.
4. **`/data-research` skill is authoritative** — `data-research` is the Cogni skill specifically for "no naively scanning fills" review. Load it before writing any new SQL on these tables.

## Useful commands

Connect to the DB (RLS-bypass, ground truth):

```bash
ssh -i .local/canary-vm-key root@84.32.109.160 \
  "docker exec -i cogni-runtime-postgres-1 psql -U app_service -d cogni_poly"
```

Per-wallet fill counts (this is the size of the heap pressure):

```sql
SELECT w.label, count(*) AS fills, count(DISTINCT condition_id) AS markets
FROM poly_trader_wallets w JOIN poly_trader_fills f ON f.trader_wallet_id = w.id
WHERE lower(w.wallet_address) IN (
  '0x2005d16a84ceefa912d4e380cd32e7ff827875ea',  -- RN1
  '0x204f72f35326db932158cba6adff0b9a1da95e14',  -- swisstony
  lower('0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A')  -- derek (candidate-a)
)
GROUP BY w.label;
```

Reproduce the slow route:

```bash
# need session cookie or API key; the route is session-auth
curl -i -b "<session>" "https://test.cognidao.org/api/v1/poly/research/target-overlap"
curl -i -b "<session>" "https://test.cognidao.org/api/v1/poly/wallets/0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A?slices=trades,distributions,snapshot,balance,execution"
```

## Open follow-ups (was already on the list; promoting to active)

- **CP9** — SQL-aggregate `getDistributionsSlice` (already noted in `poly-target-backfill.md:157`).
- **Heap audit on target-overlap** — new (this incident).
- **Heap audit on the other four wallet-analysis slices** — confirm none of `getTradesSlice` / `getSnapshotSlice` / `getBalanceSlice` / `getExecutionSlice` regress against an 800K-row wallet. Snapshot was claimed fixed post-spike.5024; verify.
- **Backfill provenance tag** — current loader tags `raw.backfill_source='spike.5024'`; revert if needed via `DELETE FROM poly_trader_fills WHERE raw->>'backfill_source' = 'spike.5024'`. Listed here so the next dev can rollback the read-path crash if the trade-off shifts.

## Cross-refs

- `docs/guides/poly-target-backfill.md` — the operational guide; the new "How to verify a backfill" + "Gotcha: error-row spam" sections were appended in the same session as this handoff.
- `docs/research/poly/backfill-spike-2026-05-05.md` — spike.5024 design + as-built.
- bug.5168 — prior `runPriceHistoryTick` OOM, fixed via worker-pool with persistent cursor.
- bug.5012 — prior naïve `db.select().from(polyTraderFills).where(...)` OOM (motivated the `data-research` skill).
