---
id: poly-backfill-spike-2026-05-05
type: research
title: "Research: Polymarket target-wallet historical backfill — RN1 + swisstony"
status: draft
trust: draft
summary: "Empirical sizing + endpoint walk strategy for a one-shot backfill of every TRADE for RN1 and swisstony from wallet birth into poly_trader_fills + poly_market_outcomes, including Gamma resolution metadata and position-evolution analytics (first-entry / layering / hedging)."
read_when: "Standing up the historical corpus that backs the CP1–CP7 dashboard reader swap; sizing any future cross-target backfill; deciding whether to write a deployed catch-up job vs a local one-shot CLI."
owner: derekg1729
created: 2026-05-05
implements: spike.5024
tags: [poly, backfill, data-corpus, gamma, research]
---

# Polymarket target-wallet backfill spike — 2026-05-05

## Question

CP1–CP7 (task.5012 and friends) is moving every wallet-analysis reader off live Polymarket HTTP onto DB-backed tables (`poly_trader_user_pnl_points`, `poly_trader_fills`, `poly_market_outcomes`, `poly_trader_current_positions`, the upcoming `polyMarketPriceHistory`). The live tick (`runTraderObservationTick`, 30 s cadence) only writes new fills; it leaves the past empty. To make the new dashboard reads useful from day one — and to give the trader-comparison / pre-position trace research surfaces real data — we need to seed those tables with everything the two curated targets (RN1, swisstony) have ever done, plus the Gamma resolution metadata for the markets they touched.

The question this spike answers:

1. Which Polymarket endpoints can practically deliver an enriched, year-deep corpus for two whales without breaking the live mirror's rate budget?
2. What's the realistic wall-clock for one full pass per wallet?
3. Does this belong in a deployed catch-up job, or is a local one-shot CLI fine?
4. What derived analytics ("pre-position": first-entry, layering, hedging) can be projected off the resulting fill ledger without new tables?

## TL;DR

- **Endpoint to use:** `GET https://data-api.polymarket.com/activity?user=<addr>&type=TRADE&end=<unix_s>&limit=500`. Walk backwards by passing the last row's `timestamp` as the next `end`. Offset pagination dies at ~3500 rows; the `end=` walk has no observed ceiling.
- **No rate limits hit** at 30 sequential or 30 concurrent requests. Each `/activity?limit=500` returns in **~1.1 s** with the trade already enriched (title, slug, conditionId, outcome, side, size, price, usdcSize, transactionHash, asset). No second hop needed for trade-level data.
- **Both targets are <1 year old.** RN1 had no trades 360 days ago; swisstony likewise. Wallet birth is ~6–8 months back. Backfill scope is bounded.
- **Activity rate is high and growing.** Sampled rate per day:
  | wallet | now | 30d ago | 90d ago | 180d ago | 360d |
  |--------|---:|---:|---:|---:|---:|
  | RN1 | 14.9 K | 21.3 K | 10.1 K | 6.8 K | 0 (no wallet) |
  | swisstony | 15.7 K | 17.5 K | 19.7 K | 7.0 K | 0 (no wallet) |
  Time-weighted estimate: **≈3 M trades per wallet over its lifetime, 6 M total**.
- **Sequential walk @ 1.1 s/page:** ~**110 min per wallet**, ~110 min wall-clock for both in parallel. With 12 monthly windows fanned out per wallet (24 walkers, still well under observed concurrency limits), **~10–15 min wall-clock total**.
- **Gamma resolution batch is broken.** `GET /markets?condition_ids=A&condition_ids=B…` accepts the array form but silently caps the result page at ~24 even with `limit=500`. Use one `condition_ids=` per request and parallelize at 10. Unique markets: ~1–2 % of trades = **45 K–60 K markets per wallet → 30–60 min Gamma sequential, ~3–6 min @ 10 parallel**, deduped across both wallets.
- **v0 should be a local CLI** (`scripts/experiments/poly-backfill/`) writing NDJSON to disk first, then a thin loader that calls the existing `appendFills()` + a new `appendMarketOutcomes()` writer once CP2 (#1245) and CP3 (`task.5018`) land. **Do not deploy as a job.** This is a one-shot growing-corpus operation, not an ongoing service.
- **Pre-position analytics (first-entry, layering, hedging) need no new tables.** They are SQL projections over `poly_trader_fills` grouped by `(trader_wallet_id, condition_id)` ordered by `timestamp` — same state machine `plan-mirror.ts` already runs live. `## Pre-position analytics` below sketches the queries.

## Empirical findings (raw)

All probes ran 2026-05-05 against `data-api.polymarket.com` and `gamma-api.polymarket.com` from a single laptop. Reproducible from `scripts/experiments/poly-backfill/probe.sh` (in this PR).

### 1. `/activity` is the right endpoint

| endpoint                         | latency p50 | rows/req | enrichment                                                                               | windowable                                              |
| -------------------------------- | ----------: | -------: | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/trades?limit=20`               |      700 ms |       20 | thin (asset, price, size, side, timestamp)                                               | offset only (and stale at limit > 20 per ts cache note) |
| `/activity?type=TRADE&limit=500` |       1.1 s |      500 | **rich** (+ conditionId, title, slug, outcome, usdcSize, transactionHash, profileImage…) | **start + end (unix s)**                                |

`/activity` strictly dominates for backfill. The same payload is what `wallet-watch` already uses, so writers can be reused unchanged.

### 2. Pagination — `end=` walk is the only viable strategy

- `offset=0,500,…` is consistent and timestamp-monotonic up to **offset ≈ 3000–3500**. Beyond that the API returns 1 stub row (likely an internal cap).
- `end=<last_ts>` walk has no observed ceiling. Page-edge duplicates appear within the same UTC second; dedupe on `transactionHash + asset + side`.
- `start=` works the same way for forward walks (delta backfill / catch-up).

### 3. Concurrency + rate

- 30 sequential `/activity` requests: **all 200, avg 521 ms/req** (smaller payloads — limit=10).
- 30 concurrent `/activity?limit=10`: **all 200 in 486 ms wall-clock**.
- No 429s, no `Retry-After` headers seen. Conservative budget: **≤ 8 concurrent requests, no token-bucket needed**.

### 4. Live wallet rate ⇒ corpus depth

Sampling 500 fills around each historical anchor:

| wallet              | rate at sample | implies span / 500 fills |
| ------------------- | -------------: | ------------------------ |
| RN1 now             |     14.9 K/day | 48 min                   |
| RN1 90 d ago        |     10.1 K/day | 71 min                   |
| RN1 180 d ago       |      6.8 K/day | 1.8 hr                   |
| swisstony now       |     15.7 K/day | 46 min                   |
| swisstony 90 d ago  |     19.7 K/day | 37 min                   |
| swisstony 180 d ago |      7.0 K/day | 1.7 hr                   |

Time-weighted lifetime trade count per wallet ≈ **3 M**. Both wallets ≈ **6 M total fills** ≈ **12 K pages**.

### 5. Gamma resolution

- Single market: `GET /markets?condition_ids=<one>` returns 86-key payload in **~560 ms**. Includes `closed`, `endDate`, `resolutionSource`, `outcomePrices`, `outcomes`, `clobTokenIds`, `umaResolution`, `volume`, `liquidity`. Sufficient for CP3 (resolution writer) and price-history seeding.
- Batch via `condition_ids=A&condition_ids=B&…` accepts up to N params but **silently caps response at ~24 markets** even with `limit=500`. Reproduced at N=10 / 50 / 100.
- Workaround: parallel single-id GETs at fan-out=10. Empirically all-200; no rate-limiting observed.

### 6. Other useful read-only endpoints

- `/value?user=<addr>` — single-int wallet USDC valuation. Now: RN1 = $372 K, swisstony = $190 K. Cheap monitoring probe; not historical.
- `/positions?user=<addr>&sizeThreshold=0` — current positions at full granularity. Already used by the bootstrap config snapshot (pXX percentile capture).

## Recommended backfill architecture

### Topology

```
  ┌─────────────────────────┐        ┌───────────────────────────┐
  │ scripts/experiments/    │        │  Polymarket Data API      │
  │   poly-backfill/        │ ──HTTP→│  /activity?type=TRADE     │
  │   walk.ts               │        │  /positions               │
  │                         │←──────│  (no auth, public)         │
  │   (per wallet, per      │        └───────────────────────────┘
  │    monthly window in    │
  │    parallel)            │        ┌───────────────────────────┐
  │                         │ ──HTTP→│  Gamma API                │
  │                         │←──────│  /markets?condition_ids=X │
  └────────┬────────────────┘        └───────────────────────────┘
           │
           ▼
  /tmp/poly-backfill/
    rn1-fills-<window>.ndjson
    swisstony-fills-<window>.ndjson
    gamma-markets.ndjson
           │
           ▼
  scripts/experiments/poly-backfill/load.ts
    – dedupe by (transactionHash, asset, side)
    – call appendFills()                    [existing — CP2 #1245]
    – call appendMarketOutcomes()           [new — CP3 / task.5018]
           │
           ▼
  poly_trader_fills          ← already exists
  poly_market_outcomes       ← already exists, no writer wired
```

### Walk strategy

Per wallet:

1. Probe wallet birth: walk one full pass from `now` backwards, stop when 0-row page hits. Persist `firstTradeAt` to a small json sidecar.
2. Bucket the wallet lifetime into **N monthly windows** (`start, end` pairs).
3. Spawn N concurrent walkers (one per window). Each walker pages `end=` backwards from its window end until it crosses its window start. Dedupe at write.
4. Write NDJSON per window (resumable: skip windows whose final page is older than window start).
5. After all walkers finish per wallet, collapse window NDJSONs into a single sorted-by-`timestamp` NDJSON.
6. Extract unique `conditionId`s across both wallets, dedupe, parallel Gamma fetch, write `gamma-markets.ndjson`.

### Loader strategy

- v0: print row counts and a 10-row sample. Manually inspect.
- v1: call `appendFills()` (already idempotent on `(trader_wallet_id, source, native_id)` per `trader-activity.ts:135`). For Gamma rows, write through a new `appendMarketOutcomes()` (one-row INSERT … ON CONFLICT (condition_id, token_id) DO UPDATE) — this is CP3's writer, currently unimplemented.

### Why local, not deployed

- One-shot operation. Adding a deploy job for a 15-min backfill that runs once per wallet-onboarding is wrong scope.
- Live mirror tick must not be perturbed. Backfill burns 8 concurrent reqs/wallet for 15 min; sharing the production node's outbound budget needlessly risks the live mirror's 30 s `/trades` poll cadence.
- The DB writes are tiny by Doltgres standards (6 M rows × ~250 bytes ≈ 1.5 GB total) and idempotent. Running from a laptop pointed at prod Doltgres via `DATABASE_URL_POLY` (already in `.env.local`) is the simplest correct path.
- When we onboard the **next** target wallet (vNext), the same script handles it. By then the position-research surface (CP4 / CP6) will tell us if a deployed catch-up job is even needed.

## Pre-position analytics (no new tables)

The user-facing ask — _"aggregates of target wallets behavior over time pre-position: first entry + layering + hedging"_ — is a SQL projection over `poly_trader_fills`. Same state-machine `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` runs live for the mirror; we re-apply it offline over the historical fills.

For each `(trader_wallet_id, condition_id)`, ordered by `timestamp ASC`:

| event         | predicate                                                                            |
| ------------- | ------------------------------------------------------------------------------------ |
| `first_entry` | row index = 0 (first fill on this market)                                            |
| `layering`    | side = BUY, outcomeIndex = same as first_entry                                       |
| `hedging`     | side = BUY, outcomeIndex = opposite of first_entry, OR side = SELL after first_entry |
| `sell_close`  | side = SELL bringing cumulative position to 0                                        |

Useful aggregates for the research surface:

- `time_to_first_entry` — minutes from market creation (Gamma `createdAt`) to first_entry timestamp
- `layer_count`, `layer_velocity` — count of layering fills, and median seconds between them
- `hedge_count`, `hedge_delay` — count of hedge fills, median seconds from first_entry to first hedge
- `mean_entry_price`, `mean_hedge_price` — VWAP per branch
- `outcome_realized_pnl` — when joined with `poly_market_outcomes`, the realized PnL net of fees per market
- `share_of_volume` — target's `usdcSize` / Gamma `volume` per market (signal of how dominant they were)

These ride on a single denormalized view, not a new table. Materialize in Doltgres only after CP4 demand is empirical.

## Capacity + cost summary

| pass                   | wall clock (sequential) | wall clock (parallel) | cost             |
| ---------------------- | ----------------------: | --------------------: | ---------------- |
| Trade walk, RN1        |                ~110 min |  ~10 min (12 windows) | $0 (public API)  |
| Trade walk, swisstony  |                ~110 min |  ~10 min (12 windows) | $0               |
| Gamma resolution dedup |                 ~30 min | ~3–5 min (fan-out 10) | $0               |
| **Total wall-clock**   |               **~4 hr** |        **~15–25 min** | **$0**           |
| DB write (loader)      |                  ~5 min |                     — | Doltgres ~1.5 GB |

Live-app risk: zero, if running locally against prod Doltgres. The Polymarket API budget is independent of the deployed node's allocation. Mirror tick uses 4 req / 30 s ≈ 0.13 req/s; backfill at 8 concurrent for 15 min uses ~5 req/s burst, on a separate IP, on different endpoints.

## How this fits the in-flight CP1–CP7 work

- **CP1 (#1242 merged)** — `poly_trader_user_pnl_points`: a separate `user-pnl-api.polymarket.com` source. Backfill that table is its own future task; not blocking.
- **CP2 (#1245 in queue)** — `poly_trader_fills` writer (`appendFills`) ships in this PR. Backfill loader **calls this directly**. Don't duplicate the writer. **Block on this PR landing.**
- **CP3 (`task.5018` filed)** — `poly_market_outcomes` writer not yet built. Backfill needs the writer. **Co-design the writer with CP3 author** so the loader can call it once. Suggested signature: `appendMarketOutcomes(rows: { conditionId, tokenId, outcome, resolvedAt, … }[])`.
- **CP5 (#1246)** — balance + execution. Orthogonal to backfill. Continues to write current positions live; backfill doesn't try to reconstruct historical balance state.
- **CP4 / CP6 (blocked on CP3)** — directly enabled by this corpus. Trader-comparison (CP6) becomes a SQL window over `poly_trader_fills` ⨝ `poly_market_outcomes` once both are populated.
- **CP7 (price-history mirror)** — `polyMarketPriceHistory` is a _different_ source (CLOB price-history endpoint), not Gamma. This spike does not touch CP7's data path; CP7 will still need its own backfill once the writer lands.

## Open questions / what to file next (prose, not pre-decomposed tasks)

In rough order of how soon someone needs to make a call:

- **CP3 writer signature + idempotency key.** `poly_market_outcomes` PK is `(condition_id, token_id)`. Gamma returns one row per market with `clobTokenIds[2]` (YES + NO). Need a clean upsert that splits Gamma → 2 rows per market. Co-design with whoever picks up `task.5018`.
- **Where does the loader live?** Two options: (a) extend `runTraderObservationTick` to optionally accept a backfill window, (b) standalone `scripts/experiments/poly-backfill/load.ts`. Memory says one-shot ops shouldn't grow live job complexity → (b) wins until proven otherwise.
- **Cursor reset semantics.** `poly_trader_ingestion_cursors` (PK trader_wallet_id, source) is the live tick's high-water mark. After backfill completes, cursor must be set to the most recent `observed_at` to avoid the next live tick re-ingesting the entire backfill window. Add this as a `--reset-cursor` flag on the loader.
- **Gamma resolution lag.** Some markets in the backfill will still be `closed=false`. Need a periodic Gamma re-fetch for unresolved markets. Probably a small cron once CP3 is wired; not in this spike's scope.
- **Should `bio` / `profileImage` Gamma profile fields be persisted?** They live on `/activity` rows redundantly. Probably no — store wallet identity once in `poly_trader_wallets`, not 6 M times in `poly_trader_fills`.
- **Pre-position analytics view.** Once `poly_market_outcomes` populated, write the layering/hedging projection as a Drizzle SQL view in `@cogni/poly-db-schema`. Lazy materialization OK at v0.

## Demo: 1-week RN1 backfill into candidate-a (2026-05-05 evening)

End-to-end run that proved the pipeline against the real candidate-a `cogni_poly` Postgres (host `candidate-a.vm.cognidao.org:5432`, reachable on the wider Cogni network). Wallet UUIDs from `poly_trader_wallets` were already seeded by the live mirror's bootstrap; loader looks them up by address.

**Step 1 — parallel walk** (`walk-windows.sh`, 4 monthly-style windows, 1500-page cap each):

```
[walk-windows] wallet=RN1 windows=4 span 2026-04-26..2026-05-03
  [0] window 1777176000..1777327200  → ~42K rows / ~1727 r/s
  [1] window 1777327200..1777478400  → ~42K rows / ~1741 r/s
  [2] window 1777478400..1777629600  → ~42K rows / ~1755 r/s
  [3] window 1777629600..1777780800  → ~42K rows / ~1770 r/s
[collapse] 166,444 input rows -> 165,587 unique rows (0.5% boundary-dup)
```

153 MB NDJSON; **wall-clock ~24 s** (max of the 4 parallel walkers).

**Step 2 — dry-run** (no `--apply`): mapped all 165,587 rows successfully, 0 dropped. Sample row carried `condition_id`, `token_id`, `side`, `price`, `shares`, `size_usdc`, `tx_hash`, `observed_at`, and the full enrichment in `raw` (matches the live tick's row shape exactly).

**Step 3 — apply** (`load.ts --apply` against candidate-a `cogni_poly`):

```
[load] target wallet: RN1 (3dd04627-6be3-4b2a-ade5-d05ecfb58ff2)
[load] parsed: total=165587 kept=165587 dropped=0
  [load] 5000/165587   (inserted=4990 skipped=10)   920/s
  [load] 50000/165587  (inserted=49990 skipped=10)  1599/s
  [load] 100000/165587 (inserted=99990 skipped=10)  1639/s
  [load] 165587/165587 (inserted=165577 skipped=10) 1665/s
[load] done in 99.5s — inserted 165577, skipped 10 (already-present)
```

**Wall-clock 99 s** at sustained ~1665 rows/s through ON CONFLICT DO NOTHING.

**Step 4 — verify in DB:**

| day        | total fills | from this backfill | unique markets |
| ---------- | ----------: | -----------------: | -------------: |
| 2026-04-26 |      29,813 |             29,813 |            772 |
| 2026-04-27 |      20,451 |             20,451 |            288 |
| 2026-04-28 |      24,198 |             24,198 |            265 |
| 2026-04-29 |      23,803 |             23,803 |            345 |
| 2026-04-30 |      23,256 |             23,256 |            311 |
| 2026-05-01 |      14,093 |             14,093 |            390 |
| 2026-05-02 |      27,746 |             27,746 |            957 |
| 2026-05-03 |       5,619 |              2,227 |            216 |
| 2026-05-04 |      17,983 |      0 (live tick) |            327 |
| 2026-05-05 |       4,984 |      0 (live tick) |             75 |
| **TOTAL**  | **191,946** |        **165,577** |      **3,681** |

**Step 5 — what the dashboard sees today:**

| reader slice                                         | source on `main`                    | renders backfilled data?                                                                                                                                                                                         |
| ---------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?include=pnl`                                       | `poly_trader_user_pnl_points` (CP1) | yes for the points the live tick wrote — but no historical `pnl_points` exist (separate backfill, future work)                                                                                                   |
| `?include=snapshot`                                  | live Data API, capped at 500 trades | **no — shows `tradesPerDay30d: 16.67`, `uniqueMarkets: 21`** instead of 21K-trades / 3.6K-markets in DB                                                                                                          |
| `?include=distributions` (default `live`)            | live Data API, capped at 500        | no — same cap                                                                                                                                                                                                    |
| `?include=distributions&distributionMode=historical` | `poly_trader_fills` (DB-backed!)    | wired but **502s on big wallets** because it then fetches per-cid resolution from CLOB serially → overruns Caddy timeout. Fix: populate `poly_market_outcomes` (CP3 / `task.5018`) so resolution lookup hits DB. |
| `?include=trades` (CP2 #1245)                        | `poly_trader_fills` after CP2 lands | **will render backfill once CP2 merges** — no further work needed on the writer side                                                                                                                             |

**Conclusion of demo:** the writer side is functional. The full 1-year corpus for both wallets can be loaded with this same flow in **~30 min wall-clock** (12 monthly windows × 2 wallets). The dashboard will start consuming the corpus as CP2 / CP3 / CP4 / CP6 merge — backfilling more does not unblock those PRs, but having the corpus already resident means the user-facing render lights up the moment those readers ship.

## Validation

`exercise:` Run `pnpm tsx scripts/experiments/poly-backfill/probe.sh` and `pnpm tsx scripts/experiments/poly-backfill/walk.ts --wallet RN1 --windows 12 --max-pages-per-window 5 --out /tmp/poly-backfill` from a clean worktree with `.env.local` sourced. Expect both wallets' NDJSON files to land in `/tmp/poly-backfill/` with non-zero row counts and timestamps spanning the requested windows. Inspect a sample row and confirm it carries `conditionId`, `title`, `outcome`, `usdcSize`.

`observability:` This is a research spike running locally; no Loki signal. Validation evidence is the on-disk NDJSON sample + the timing summary printed by `walk.ts` (rows/window, total wall-clock, dedupe rate). PR description embeds the sample output verbatim.

`deploy_verified:` N/A. Spike does not change any deployed surface; nothing to flight.

## Links

- Parent feature: `task.5012` (CP1–CP7 DB-backed read model)
- Related: `task.5018` (CP7 price-history mirror — different data source)
- Existing data clients: `nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`
- Existing writer: `nodes/poly/app/src/features/wallet-analysis/server/trader-observation-service.ts:appendFills`
- Live state machine the offline analytics will mirror: `nodes/poly/app/src/features/copy-trade/plan-mirror.ts`
