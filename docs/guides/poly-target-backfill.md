---
id: poly-target-backfill-guide
type: guide
title: "Guide: Backfill Polymarket target-wallet history into a deployment"
status: draft
trust: draft
summary: "Operator runbook for seeding `poly_trader_fills` + `poly_trader_user_pnl_points` (and, post PR #1265, `poly_market_metadata`) for a curated copy-target wallet against any environment's Postgres. Captures the SSH-tunnel pattern, idempotency tags, sequencing, and the read-path heap budgets the deployed slices respect."
read_when: "Onboarding a new copy-target wallet on candidate-a / preview / production; rerunning a partial backfill; auditing why a research-tab metric isn't rendering for a target."
owner: derekg1729
created: 2026-05-05
implements: spike.5024
tags: [poly, backfill, operator, runbook]
---

# How to backfill a Polymarket target wallet

For when you need to seed a curated copy-target wallet (e.g. RN1, swisstony, the next whale) into one of the deployed `cogni_poly` Postgres instances so the research dashboard renders real history instead of just live-tick data.

This guide is **operational**, not architectural. Architecture lives in `docs/research/poly/backfill-spike-2026-05-05.md` (the design + as-built record).

## Tables involved + which script seeds each

| table                            | what it stores                                          | seeded by                                                                                                                                                                                                                                                       | live-tick maintains it?                                 |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `poly_trader_wallets`            | wallet registry (id, address, label, kind)              | bootstrap config (`runTraderObservationTick`); no script needed                                                                                                                                                                                                 | yes — created on first observation                      |
| `poly_trader_fills`              | per-fill ledger                                         | **`scripts/experiments/poly-backfill/walk.ts` + `load.ts`** (this guide)                                                                                                                                                                                        | yes (forward only — script seeds the past)              |
| `poly_trader_user_pnl_points`    | PnL time-series at `1h` + `1d` fidelity                 | **`scripts/experiments/poly-backfill/pnl-backfill.ts`** (this guide). Note: live tick already populates `1d` over `interval=max` and `1h` over `interval=1w`; this script extends `1h` to full-lifetime.                                                        | yes (live tick covers `1d` lifetime + `1h` last 7 days) |
| `poly_market_metadata`           | Gamma market metadata (resolution, outcomes, end-times) | **PR #1265** ("persist Gamma market metadata to canonical table") provides the writer + Data API method. Use that path; **do not** revive the deleted `gamma-fetch.ts` — Gamma rate-limits hard at scale (14 K markets → 14,460 of 14,462 429'd at fan-out 10). | depends on 1265's tick cadence                          |
| `poly_market_outcomes`           | per-(condition, token) winner / loser / unknown         | CP3's `runMarketOutcomeTick` (already in main). Catches up over time once fills land.                                                                                                                                                                           | yes (writer tick)                                       |
| `poly_market_price_history`      | per-asset CLOB price (1h / 1d)                          | CP7's `runPriceHistoryTick` (already in main). Bounded by active-position set + last-7-day fills.                                                                                                                                                               | yes (writer tick; fix bug.5168 worker-pool form)        |
| `poly_trader_current_positions`  | snapshot-of-now                                         | live tick                                                                                                                                                                                                                                                       | yes                                                     |
| `poly_trader_position_snapshots` | append-only history                                     | live tick                                                                                                                                                                                                                                                       | yes                                                     |

## The flow

1. **Walk** the Polymarket Data API for fills → NDJSON on disk
2. **Load** that NDJSON into `poly_trader_fills` of the target environment via SSH-tunnelled Postgres
3. **PnL backfill** the user-pnl-api → `poly_trader_user_pnl_points`
4. **Wait** for CP3's `runMarketOutcomeTick` and PR #1265's metadata tick to catch up — they fill in resolution data on their own cadence once fills are present. **Do not run a parallel Gamma scrape**; you'll burn rate-limit budget for nothing.

Steps 1+2 are independent per wallet. Step 3 is a single API call per wallet. Step 4 is automatic.

## Pre-flight checks

```bash
# 1. SSH key for the env
ls .local/{candidate-a,preview,production}-vm-key
# .local/candidate-a-vm-key is the canary VM's key (candidate-a == renamed canary)

# 2. The Postgres root password (lives in the env file matching the VM)
#    candidate-a → .env.canary, preview → .env.preview, production → .env.production
grep POSTGRES_ROOT_PASSWORD ~/dev/cogni-template/.env.canary
```

## Steps in detail

### 0. Open the SSH tunnel

```bash
KEY=~/dev/cogni-template/.local/candidate-a-vm-key
IP=$(cat ~/dev/cogni-template/.local/candidate-a-vm-ip)

# Background tunnel: localhost:55433 → VM:5432
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -f -N -L 55433:localhost:5432 root@"$IP"
nc -zvw3 localhost 55433  # confirm "succeeded"
```

The tunnel is the only sanctioned write path for backfill — the public 5432 port was closed by `bug.5167` and shouldn't be reopened.

### 1. Walk the fills

```bash
# Single window, one wallet, last 30 days
pnpm tsx scripts/experiments/poly-backfill/walk.ts \
  --wallet RN1 \
  --start $(date -v-30d +%s) --end $(date +%s) \
  --max-pages 10000 \
  --out /tmp/poly-backfill/rn1-30d

# OR the orchestrator: 4 parallel monthly windows for ~10 min wall-clock
./scripts/experiments/poly-backfill/walk-windows.sh \
  --wallet RN1 --start 2026-04-05 --end 2026-05-05 \
  --windows 4 --max-pages-per-window 1500 \
  --out /tmp/poly-backfill
```

Empirical numbers: RN1 averages ~27 K fills/day; a 30-day walk produces ~825 K rows / ~770 MB NDJSON. Both targets observed are <1 year old.

### 2. Load into the target env's `poly_trader_fills`

```bash
# Get the env's postgres root password
PGPASS=$(grep POSTGRES_ROOT_PASSWORD ~/dev/cogni-template/.env.canary | cut -d"'" -f2)

DATABASE_URL_POLY="postgresql://postgres:${PGPASS}@localhost:55433/cogni_poly" \
  pnpm tsx --no-warnings --max-old-space-size=2048 \
  scripts/experiments/poly-backfill/load.ts \
  --in /tmp/poly-backfill/<wallet>-fills.ndjson \
  --wallet-address 0x… \
  --apply
```

**Idempotent** on `(trader_wallet_id, source, native_id)`. **Tagged** with `raw.backfill_source = 'spike.5024'` (or whatever you pass) for revert. Sustained ~1.6 K rows/s through the SSH tunnel.

**Revert** (if anything goes sideways):

```sql
DELETE FROM poly_trader_fills WHERE raw->>'backfill_source' = 'spike.5024';
```

### 3. Backfill PnL time-series

```bash
DATABASE_URL_POLY="postgresql://postgres:${PGPASS}@localhost:55433/cogni_poly" \
  pnpm tsx scripts/experiments/poly-backfill/pnl-backfill.ts \
  --wallet-address 0x… \
  --apply
```

Single API call per fidelity per wallet → ~7 K 1h-points + ~300 1d-points → ~1 s upsert. Idempotent on `(trader_wallet_id, fidelity, ts)`.

### 4. Wait for the writer ticks to populate metadata + outcomes + price history

After fills land, three deployed ticks fan out to the new markets:

- **`runMarketOutcomeTick` (CP3)** — populates `poly_market_outcomes`
- **PR #1265's metadata writer** — populates `poly_market_metadata`
- **`runPriceHistoryTick` (CP7, post bug.5168 fix)** — populates `poly_market_price_history`. Worker-pool form, bounded heap.

Grafana / Loki signals to watch:

- `event="poly.market-outcome.tick.ok"` — outcome write count
- `event="poly.market-price-history.tick_ok"` — price-history asset count
- `event="poly.user-pnl.outbound"` — user-pnl-api fetches

**Do NOT run a parallel `gamma-fetch.ts`** to populate `poly_market_outcomes` directly. Gamma rate-limits at 14 K-market scale (verified empirically). Let the deployed ticks do their job.

## Gotchas that bite

1. **The 384 MB Tier-0 heap.** Read-path slices that `SELECT FROM poly_trader_fills` for a backfilled wallet **must** be SQL-aggregated (see `wallet-analysis-service.ts` post-spike.5024). An unbounded read of an 825 K-row wallet OOMs the pod. The snapshot/execution slices are fixed; **distributions still has a 25 K most-recent cap (CP9 follow-up)**.
2. **Writer ticks fan out per-asset.** `runPriceHistoryTick` enumerates DISTINCT assets from `poly_trader_fills` (last 7 days) ∪ `poly_trader_current_positions`. Backfilling a high-volume wallet (RN1: ~10 K assets in 7 days) used to OOM the pod via `Promise.all(assets.map(asset => limit(...)))` queue holding all wrappers + completed payloads. Fixed by bug.5168 — worker-pool with persistent cursor. **Don't reintroduce the `Promise.all` pattern**.
3. **Postgres port 5432 is closed externally.** SSH tunnel only. Verify with `nc -zvw3 localhost 55433` (post-tunnel) or `nc -zvw3 candidate-a.vm.cognidao.org 5432` (pre-tunnel — should time out).
4. **Wallet must already exist in `poly_trader_wallets`.** The bootstrap config seeds curated targets on live-tick first run. If you're onboarding a new target, add to bootstrap config and let the live tick run once before backfilling.
5. **Distributions tab will show only ~21 hr of activity for whales** until CP9 (SQL-aggregated histograms). Snapshot, Fills, Trade size, Hour of day, Bets/market all render correctly. Size P/L, Time in position, Entries/outcome wait on `poly_market_outcomes` populating.
6. **Live tick already does `1d` PnL `interval=max` on first run.** The `pnl-backfill.ts` script's value-add is full-lifetime `1h` fidelity (live tick caps at `interval=1w` for retention). Re-running on an already-populated wallet is a no-op upsert.
7. **Don't backfill production without observing candidate-a + preview first.** The CP7 worker-pool fix is verified by 5 unit + 1 component test, but the full crashloop-prevention proof is observing 8h+ pod stability post-flight on candidate-a. Walk that gate before pointing the loader at preview/prod.

## Production / preview SSH access

Same shape as candidate-a; key in `.local/{env}-vm-key`, password in `.env.{preview,production}`. Per repo policy:

- **Preview**: read-only by default; backfill writes are an exception that must be captured in this guide before the session ends. **Currently NOT recommended** until candidate-a's full corpus has rendered cleanly for ≥24 h with no OOMs.
- **Production**: never SSH for any reason except an approved postmortem-grade incident. Backfill production by **promoting the candidate-a-validated dataset forward**, not by re-running the scripts blind.

## Open follow-ups

- **CP9** — SQL-aggregate `getDistributionsSlice`. Removes the 25 K cap; `summariseOrderFlow`'s histograms become `width_bucket` + `PERCENTILE_DISC` queries. Pattern: snapshot's implementation in `wallet-analysis-service.ts` is the reference.
- **PR #1265 wiring** — once that lands, drop the "Gamma rate-limit gotcha" and the `poly_market_metadata` row of this guide can point at PR 1265's writer instead.
- **Backfill-source provenance** — current loader tags `raw.backfill_source = 'spike.5024'`. Future loaders should pass a `--source-tag` flag so each backfill batch is independently revertable.

## How to verify a backfill (and where it will NOT show up)

Two `*_fills` tables exist; they look interchangeable but feed different surfaces. Confusing them is the #1 way to misjudge a backfill as broken.

| table                   | source                                                  | what UI reads it                                                                                                                                                |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poly_trader_fills`     | polymarket Data API `/activity?type=TRADE`              | research slices: `getTradesSlice`, `getDistributionsSlice`, `getSnapshotSlice`, `getBalanceSlice`, `getExecutionSlice` (`/api/v1/poly/wallets/[addr]?slices=…`) |
| `poly_copy_trade_fills` | local mirror order ledger (one row per attempted order) | dashboard `TRADES / DAY` chart + Open/History tabs via `orderLedger.listTenantPositions` (`/api/v1/poly/wallet/execution`)                                      |

**The backfill scripts (`walk.ts` + `load.ts`) only write `poly_trader_fills`.** They do NOT write `poly_copy_trade_fills` — that table is local-event-driven (mirror coordinator writes one row per order placement; no polymarket equivalent). So:

- ✅ A successful backfill **will** show in research slices, P/L charts (after `pnl-backfill.ts`), Markets/Distributions/Snapshot.
- ❌ A successful backfill **will NOT** show in the dashboard's TRADES/DAY bar chart — that surface is bounded by when the local mirror coordinator was running and authenticated.

### Verification checklist (do these, not "look at the chart")

1. **Row-count parity**: pull polymarket `/activity?user=…&type=TRADE&limit=500` for a recent slice; dedupe by `(transactionHash, asset, side)`; compare against `SELECT count(*) FROM poly_trader_fills WHERE trader_wallet_id = …` for the same time window. Expect 99–100% match (1–3% delta = walk's pagination boundary-dedupe rate).
2. **Spot-check 5 newest tx_hashes**: pick 5 from polymarket inside the walk window, `WHERE tx_hash IN (...)`. Should be 5/5 present with matching shares + observed_at.
3. **Sample 100 mid-window**: same as above with 100 random txs from inside `[walk.start, walk.end - 30min]`. Expect ≥99% present.
4. **Hit the API directly**: `curl https://<env>.cognidao.org/api/v1/poly/wallets/<addr>?slices=trades` returns the JSON the research view consumes — easier than spelunking through tabs.

### Gotcha: error-row spam can blank the TRADES/DAY chart even when real fills exist

If CLOB auth is failing in your env (e.g. candidate-a `stale_api_key`), the mirror generates ~5K `status='error'` rows/day in `poly_copy_trade_fills`. The chart's underlying query is `SELECT … WHERE status IN (… 'error') ORDER BY observed_at DESC LIMIT 2000` (`DASHBOARD_LEDGER_POSITION_LIMIT` in `_lib/ledger-positions.ts`). The error rows flood the LIMIT window and push real `filled` rows past the cutoff → `shouldCountLedgerTrade` returns 0 trades for every day. **Symptom looks identical to "backfill failed".**

Mitigation:

- One-shot for a stuck candidate-a env: `DELETE FROM poly_copy_trade_fills WHERE billing_account_id='<your-ba>' AND status='error' AND observed_at >= now() - interval '14 days'`. Idempotent — mirror just re-errors. Unmasks the real fills immediately.
- Permanent fix: drop `'error'` from `DASHBOARD_LEDGER_POSITION_STATUSES` in `_lib/ledger-positions.ts:39`, or split the chart query from the lifecycle query.

### Gotcha: P/L chart vs TRADES/DAY chart will look out of sync during a backfill

P/L chart reads `poly_trader_user_pnl_points` (full-history via `pnl-backfill.ts`). TRADES/DAY reads `poly_copy_trade_fills` (mirror-uptime-bounded). After a fresh backfill onto an env where the mirror only recently came online, P/L will show full history while TRADES/DAY shows only the mirror-uptime tail. **This is expected; not a bug.**
