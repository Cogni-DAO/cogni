---
id: wallet-drift-investigation-handoff-2026-05-10
type: research
title: "Handoff: poly wallet drift investigation — silent loss accumulation + trade-history blanking"
status: draft
trust: draft
summary: "Wallet 0x95e4...5134 dropped ~$200 in dashboard total today with PnL chart appearing flat, AND the 14-day trades-per-day chart shows only today's bar (prior 13 days at zero). Two suspected regressions sit underneath: (1) `poly_market_outcomes` is missing resolutions for ~692 conditions Polymarket flags as `redeemable=true` for this wallet, hiding $4–8k of cost-basis exposure from the PnL accounting path; (2) the dashboard trades-per-day chart reads from a position-list with `LIMIT 2000`, which gets fully consumed by today's mirror activity and truncates older days. The prior agent (me) ran a lot of queries and made arithmetic mistakes the user caught, so this handoff is a clean restart with receipts, not conclusions."
read_when: "You are picking up the 2026-05-10 wallet-drift investigation. The user (Derek) explicitly said the prior agent's math was unreliable; verify everything before acting."
owner: derekg1729
created: 2026-05-10
implements: TBD-bug-files
tags: [poly, wallet, drift, pnl, outcomes-pipeline, dashboard, bug.5012-class]
---

# Poly wallet drift investigation — handoff

## TL;DR

Two suspected issues on the trading wallet `0x95e407…5134` dashboard. Spec-alignment caveat first: **only one is a spec violation. The other is a gap in unspecified territory.**

1. **Bug — trades-per-day chart blanks prior days**: chart reads from `orderLedger.listTenantPositions({limit: 2000})` (`nodes/poly/app/src/app/api/v1/poly/wallet/_lib/ledger-positions.ts:47`) and bucket-counts the rows by day. Today's mirror activity alone is 8,481 fills in `poly_copy_trade_fills`; the 2000-row cap is fully consumed by today + a sliver of yesterday, so the chart's prior 13 days all return zero. This **directly violates `docs/design/poly-dashboard-balance-and-positions.md:142–144`**: "The DB read model owns row cardinality and ordering for dashboard positions. Live Polymarket data enriches matching rows and may append new upstream-only rows, but must not replace the table with a capped upstream slice." Canonical bug.5012-class anti-pattern: LIMIT-N on a fill-scanning read where the right shape is `count() GROUP BY date_trunc('day', observed_at)` against `poly_trader_fills`. A `readDailyCountsFromDb` helper already exists at `wallet-analysis-service.ts:464` and does it correctly — the dashboard execution route just doesn't use it.
2. **Gap — outcomes-pipeline silent dropout (NOT a spec violation, because no spec covers it)**: 692 conditions are flagged `redeemable=true` by the Polymarket Data API for this wallet, but our `poly_market_outcomes` table has `resolved_at IS NULL` for them. Cumulative cost basis hidden in these positions: ~$8,690. Of those, 676 conditions classify as "unresolved" in the dashboard's bucketization with `cost_basis=$4,635, current_value=$1.83, cashPnl=−$4,633` — chain says lost, our DB says open, PnL chart can't realize the loss. **There is no spec that says `poly_market_outcomes.resolved_at` must be populated.** `docs/design/poly-positions.md:199–201` references the `ConditionResolution` chain event as Capability B but never states "this is the writer for the outcomes table." So this is a silent dropout in an unspecified pipeline, not a regression against a stated invariant. The fix-or-don't decision must include writing the missing spec.

The user's lived symptom — "dashboard went $1900 → $1700 but PnL looks flat" — is consistent with both producing **silent loss accumulation**: losing positions don't move into the realized-PnL surface because the outcome isn't recognized, while the value column collapses to ~$0 because Polymarket prices them correctly.

**Don't trust the prior agent's arithmetic or framing.** The prior agent (me) initially called both items "regressions" — the user pushed back and a doc audit confirmed only one is a spec violation. Re-run every query.

## The user's direct question

> "Our app isn't actively buying already-lost positions, is it??"

**Best-effort answer with current data**: 19 BUY fills totaling $42.83 across 11 conditions in the last 14 days were observed after `poly_market_outcomes.resolved_at` for that condition. Small dollar volume. **BUT** that query only catches buys-after-resolution where `poly_market_outcomes` knows the resolution. The 692-condition outcomes gap means the real number is unknown until that pipeline is fixed. Query in Appendix C.

The bigger pattern is probably not "buying after resolution" — it's "buying very near resolution on markets that resolve loser shortly after, and the resolution then never lands in our outcomes table." See `recipes/alpha-leak-debug.md` for the structurally similar "we trade behind the target" investigation.

## STEP 0 — what to verify first (before any code change)

These four queries should be your starting point. Run from `scripts/grafana-postgres-query.sh` against `--env production --node poly`. The numbers below are the prior agent's read at ~2026-05-10T18:00Z; **verify them against current state because the wallet keeps trading**.

```sql
-- 1. The outcomes-pipeline gap (the headline number)
SELECT COUNT(DISTINCT cp.condition_id) AS n_conds,
       ROUND(SUM(cp.cost_basis_usdc)::numeric, 2) AS orphan_cost_basis,
       ROUND(SUM(cp.shares)::numeric, 0) AS orphan_shares
FROM poly_trader_current_positions cp
LEFT JOIN poly_market_outcomes mo
  ON LOWER(cp.condition_id) = LOWER(mo.condition_id)
WHERE cp.trader_wallet_id = 'fc501f44-448a-4247-972e-ed1f90447a0b'
  AND cp.active = true
  AND (cp.raw->>'redeemable')::boolean = true
  AND mo.resolved_at IS NULL;
-- Prior reading: 692 conditions, $8,689.92, 34,162 shares
```

```sql
-- 2. Position bucketization (the dashboard breakdown)
SELECT
  CASE WHEN mo.resolved_at IS NULL THEN 'unresolved (open exposure)'
       WHEN (mo.payout)::numeric > 0 THEN 'winner-resolved'
       ELSE 'loser-resolved' END AS bucket,
  CASE WHEN (cp.raw->>'redeemable')::boolean = true THEN 'redeemable=yes'
       ELSE 'redeemable=no' END AS redeemable,
  COUNT(*) AS n_positions,
  ROUND(SUM(cp.shares)::numeric, 0) AS shares,
  ROUND(SUM(cp.cost_basis_usdc)::numeric, 2) AS cost_basis,
  ROUND(SUM(cp.current_value_usdc)::numeric, 2) AS current_value,
  ROUND(SUM((cp.raw->>'cashPnl')::numeric)::numeric, 2) AS cash_pnl_per_polymarket
FROM poly_trader_current_positions cp
LEFT JOIN poly_market_outcomes mo
  ON LOWER(cp.condition_id) = LOWER(mo.condition_id)
 AND LOWER(cp.token_id) = LOWER(mo.token_id)
WHERE cp.trader_wallet_id = 'fc501f44-448a-4247-972e-ed1f90447a0b'
  AND cp.active = true
GROUP BY 1, 2
ORDER BY current_value DESC;
```

```sql
-- 3. Mirror fills today vs. earlier days (proves data exists for the chart)
SELECT DATE_TRUNC('day', observed_at) AS d, COUNT(*) AS n
FROM poly_copy_trade_fills
WHERE billing_account_id = '207795de-891c-4791-9f8b-aa0f0bcc4911'
  AND observed_at >= NOW() - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1 DESC;
-- Prior reading: 8481 today, 7124 yesterday, 1500/1723/1125 prior 3 days — clearly populated
```

```sql
-- 4. Mirror "filled" status only, by day — what the chart *should* show
SELECT DATE_TRUNC('day', observed_at) AS d, COUNT(*) AS n
FROM poly_copy_trade_fills
WHERE billing_account_id = '207795de-891c-4791-9f8b-aa0f0bcc4911'
  AND status = 'filled'
  AND observed_at >= NOW() - INTERVAL '14 days'
GROUP BY 1 ORDER BY 1 DESC;
-- Prior reading: 211 today, then 889/673/733/459/387/284/313/72/106/31/18/26/4 going back
```

If Q1 still returns ~hundreds of orphan conditions: the outcomes pipeline regression is the priority. Skip to that section.
If Q4 shows 14 days of filled trades but the dashboard still renders only today's bar: the trades-chart regression is straightforward; skip to that section.

## What we already know (so you don't re-derive)

### The wallet under investigation

- Address: `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` (stored lowercase in `poly_trader_wallets.wallet_address`)
- `trader_wallet_id` (UUID): `fc501f44-448a-4247-972e-ed1f90447a0b`
- `billing_account_id`: `207795de-891c-4791-9f8b-aa0f0bcc4911`
- Kind: `cogni_wallet`, label `Tenant trading wallet`

### The redeem pipeline is healthy (post bug.5041)

PR #1311 shipped this morning. Migration 0047 cleared 64 stuck `transient_exhausted` abandons; classifier prevents recurrence. Current redeem state for this wallet:

| status | error_class | n |
|---|---|---|
| confirmed | NULL | 1083 |
| skipped (loser) | NULL | 556 |
| confirmed | malformed | 2 |
| abandoned | malformed | 1 |

**Zero rows in pending/claimed/submitted/failed_transient/transient_exhausted.** The redeem worker is not the cause of the drift; the worker can only act on jobs that get enqueued, and jobs only get enqueued when `poly_market_outcomes` records a resolution.

### The outcomes-pipeline gap (suspected regression #1)

From Q1 above: **692 conditions** the Polymarket Data API says the wallet can redeem (= resolved on chain), but `poly_market_outcomes.resolved_at IS NULL`. Sub-bucketization (Q2 result snapshot):

| bucket | redeemable | n | shares | cost_basis | current_value | cashPnl |
|---|---|---:|---:|---:|---:|---:|
| loser-resolved | no | 118 | 3,665 | $1,377.99 | $1,284.70 | −$93.29 |
| unresolved (open) | no | 34 | 374 | $202.65 | $205.63 | +$2.98 |
| **unresolved (open)** | **redeemable=yes** | **676** | **18,593** | **$4,634.72** | **$1.83** | **−$4,632.89** |
| loser-resolved | redeemable=yes | 20 | 444 | $153.61 | $0 | −$153.61 |

Row 3 is the alarm: 676 positions sit "unresolved" in our taxonomy but are worth $1.83 of $4,634.72 cost — chain says these positions are dead, our DB doesn't know yet.

Hypotheses for the outcomes-pipeline regression (in priority order):

1. **ConditionResolution subscriber missed events** — `redeem-subscriber.ts`'s `watchContractEvent` for `ConditionResolution` is the primary write path for `poly_market_outcomes`. viem's HTTP-filter polling has documented dropouts (bug.5015 era).
2. **Periodic redeem-catchup hasn't run / isn't writing outcomes** — `runRedeemCatchup` runs every 10 min and is supposed to fill subscriber gaps. Check Loki for `feature.poly_redeem.catchup.complete` events vs `poly_market_outcomes` row counts on the same day.
3. **Layer-3 redeem-diff tick** (`bug.5028` / PR #1286) was meant to detect divergence between Polymarket Data-API truth and our DB. If it ran on these 692 conditions and emitted log signals, those signals weren't acted on. Search Loki for `feature.poly_redeem.diff_tick.complete` and any divergence-emit events.

Each hypothesis is testable; don't pick one without evidence.

### The trades-per-day chart regression (suspected regression #2)

Code path:

- Component: `nodes/poly/app/src/app/(app)/dashboard/_components/OperatorWalletChartsRow.tsx` consumes `dailyTradeCounts` from `useDashboardExecution`.
- Hook → API: `nodes/poly/app/src/app/api/v1/poly/wallet/execution/route.ts:L156–162` calls `orderLedger.listTenantPositions({ statuses: DASHBOARD_LEDGER_POSITION_STATUSES, limit: DASHBOARD_LEDGER_POSITION_LIMIT })` then `summarizeDailyTradeCounts(rows, capturedAt)`.
- Constants in `nodes/poly/app/src/app/api/v1/poly/wallet/_lib/ledger-positions.ts:L39–L47`:
  - `DASHBOARD_LEDGER_POSITION_LIMIT = 2_000`
  - Statuses: `['pending','open','filled','partial','canceled','error']`

`poly_copy_trade_fills` for this billing_account has 25,651 total rows and 8,481 today alone. `limit: 2000` is fully consumed by today + ~yesterday → the daily-count map never sees prior days → those bars render as zero (the chart's zero-day rendering is a 4px stub, which matches the screenshot exactly).

**The chart should not read the ledger at all for a "trades per day" view.** It should read `poly_trader_fills` (canonical fills) with a `COUNT(*) GROUP BY date_trunc('day', observed_at)` SQL aggregation — that's the data-research-skill standard. `getSnapshotSlice` already has `readDailyCountsFromDb` (`nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts:L464`) that does exactly this; the execution-route code path bypasses it.

Two-line fix shape: swap the `summarizeDailyTradeCounts(ledger_rows)` call for a SQL aggregate against `poly_trader_fills` filtered by the trading wallet's `wallet_address`. Or — call into the existing `readDailyCountsFromDb` helper. Verify the SQL plan via EXPLAIN on a 5000-fill wallet before merging.

## Where the prior agent went wrong (do not repeat)

The user (Derek) caught two arithmetic / conclusion failures from the prior session:

1. **The $4998 "unrealized loss" number.** Prior agent ran `sum(cost_basis_usdc − current_value_usdc) WHERE cost > value+1` and called the result "unrealized loss." That conflates (a) realized loss on resolved losers still active in cache with (b) genuinely unrealized loss on positions that crashed mid-bet. The $4,633 cashPnl from Polymarket's published `raw->>'cashPnl'` on the 676-position bucket is the trustworthy delta. Use vendor-published metrics over derived ones (data-research skill: "If the field exists in the persisted `raw` payload, the SQL extracts it instead of computing a substitute").
2. **Calling the drop "real loss, not stranded accounting"** before checking the outcomes pipeline. The user pushed back; checking `poly_market_outcomes` against the wallet's `redeemable=true` set immediately revealed the 692 orphans. Investigate the outcomes pipeline before concluding anything about "real" vs "stranded."

The prior agent also produced 0–1 inline narrative comments per fix that violated `style.md`, requiring a second cleanup pass (PR #1311). Don't burn that cycle again.

## Code pointers (lines as of `239fe57e3` / PR #1311 head)

| Concern | File | Line / function |
|---|---|---|
| Outcomes-pipeline write path (subscriber) | `nodes/poly/app/src/features/redeem/redeem-subscriber.ts` | `watchContractEvent` for `ConditionResolution`, search file |
| Periodic catchup that fills subscriber gaps | `nodes/poly/app/src/features/redeem/redeem-catchup.ts` | `runRedeemCatchup` |
| Layer-3 position-diff (the divergence detector) | `nodes/poly/app/src/features/redeem/` (filename has `diff` in it) | `runRedeemDiffTick` |
| Trades chart data source | `nodes/poly/app/src/app/api/v1/poly/wallet/execution/route.ts` | L151–162, `summarizeDailyTradeCounts` consumer |
| `summarizeDailyTradeCounts` impl | `nodes/poly/app/src/app/api/v1/poly/wallet/_lib/ledger-positions.ts` | L219–240 |
| The constants that cause the truncation | same file | L39–L47 |
| The correct daily-count reader (already exists, just unused here) | `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` | `readDailyCountsFromDb` ~L464 |
| Current-positions cache projection | `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts` | `readPositionAggregatesFromDb` ~L390 |
| Current-position read model used by `/wallet/execution` | `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts` | `readCurrentWalletPositionModel`, `deriveCurrentPositionStatus` |
| `poly_trader_fills` schema (canonical fills) | `nodes/poly/app/src/adapters/server/db/schema/` (search) | `polyTraderFills` |
| `poly_market_outcomes` schema | same dir | `polyMarketOutcomes` |

## Validation recipe for any fix

1. **Local repro the chart bug** — point a unit test at a fake ledger with 3000 fills spanning 5 days, all today-heavy. Assert the rendered `dailyCounts` shows all 5 days populated. The current code path will produce one or two days populated; a SQL-aggregate-against-fills path will produce all five.
2. **Local repro the outcomes-pipeline bug** — write a stack/integration test that:
   1. Seeds `poly_trader_current_positions` with `raw->>'redeemable' = 'true'` for condition X.
   2. Asserts that within one redeem-diff cycle, `poly_market_outcomes.resolved_at` for X is non-NULL.
   3. Watch what actually triggers the `poly_market_outcomes` write; if no path triggers it, the regression is upstream (subscriber/catchup/diff).
3. **Validate on candidate-a** — flight with `vcs/flight`, then Loki for the new SQL-aggregate event firing, and re-run STEP 0 Q1 against candidate-a postgres. The orphan count should drop toward zero as the outcomes-pipeline write path catches up.
4. **deploy_verified** — run the STEP 0 queries against production after the prod promote. Q1's count should drift toward zero, Q4's prior-day bars should be non-zero on the dashboard.

## Appendix A — 692-condition orphan list (sampled)

Sourced from STEP 0 Q1 with a `SELECT cp.condition_id` projection at the time of the snapshot. **Re-pull before acting; the set changes as new markets resolve.** Top 25 by `cost_basis_usdc`:

```
-- query to regenerate the list (not embedded as data — the snapshot rots fast):
SELECT cp.condition_id, cp.cost_basis_usdc, cp.shares
FROM poly_trader_current_positions cp
LEFT JOIN poly_market_outcomes mo
  ON LOWER(cp.condition_id) = LOWER(mo.condition_id)
WHERE cp.trader_wallet_id = 'fc501f44-448a-4247-972e-ed1f90447a0b'
  AND cp.active = true
  AND (cp.raw->>'redeemable')::boolean = true
  AND mo.resolved_at IS NULL
ORDER BY cp.cost_basis_usdc DESC
LIMIT 25;
```

## Appendix B — what's already been ruled out

- ❌ **Redeem worker** is the cause. Queue is empty post-PR-#1311.
- ❌ **Polymarket Data API not refreshing** for this wallet. `last_observed_at` on `poly_trader_current_positions` shows ~hourly refresh activity; the `redeemable=true` flag itself comes from those refreshes.
- ❌ **Case mismatch on wallet_address joins.** `wallet_address` is stored lowercase; queries that pass lowercase return the expected 14 days of fills.

## Appendix C — Loki one-liners

```bash
# Were any outcomes-pipeline events fired in the last 24h?
scripts/loki-query.sh '{env="production",service="app"} | json | event=~"feature.poly_redeem.(catchup|diff_tick|outcome_tick).complete"' 1440 200

# ConditionResolution subscriber events (write path for poly_market_outcomes)
scripts/loki-query.sh '{env="production",service="app"} | json | event=~"poly.ctf.subscriber.condition_resolution_observed"' 1440 500

# Any "outcome upsert" or "divergence detected" emissions?
scripts/loki-query.sh '{env="production",service="app"} |~ "outcome|divergence|orphan"' 1440 200
```

## Appendix D — query for the "buying after resolution" question

```sql
SELECT COUNT(*) AS n_post_resolve_buys,
       ROUND(SUM(f.size_usdc)::numeric, 2) AS spent,
       COUNT(DISTINCT f.condition_id) AS n_conds
FROM poly_trader_fills f
INNER JOIN poly_market_outcomes mo
  ON LOWER(f.condition_id) = LOWER(mo.condition_id)
 AND LOWER(f.token_id) = LOWER(mo.token_id)
WHERE f.trader_wallet_id = 'fc501f44-448a-4247-972e-ed1f90447a0b'
  AND f.side = 'BUY'
  AND mo.resolved_at IS NOT NULL
  AND f.observed_at > mo.resolved_at
  AND f.observed_at >= NOW() - INTERVAL '14 days';
-- Prior reading: 19 fills, $42.83 spent, 11 conditions, all on payout=NULL/0 tokens.
-- This query CANNOT see the larger drift because the join requires
-- `mo.resolved_at IS NOT NULL` — i.e., the outcomes table HAS to know about
-- the resolution. The 692-orphan set is invisible here. Fix outcomes pipeline first.
```

## Spec-doc situation (you'll need to fix this too)

The user asked "WHY DO WE HAVE 5+ DESIGN SPECS FOR THIS?" Honest answer: **2 too many.** Recommended consolidation before merging any fix that touches these areas:

| Doc | Action | Reason |
|---|---|---|
| `docs/spec/poly-copy-trade-phase1.md` | **Collapse into `poly-position-exit.md` as §1** | It's an index masquerading as a spec — 305 lines that mostly say "read the real files." No standalone invariants. |
| `docs/spec/poly-position-exit.md` | **Keep, absorb phase1.** Rename to "Poly Execution & Ledger." | The real authority-boundaries spec for live/closed/pending. |
| `docs/design/poly-positions.md` | **Keep, rename "Poly Position Lifecycle."** | The 4-authority diagram (chain / CLOB / Data API / local DB) is orthogonal to UI. Reuse-by-design. |
| `docs/design/poly-dashboard-balance-and-positions.md` | **Keep, rename "Poly Dashboard Execution Card."** | Owns the load-bearing `L142–144` row-cardinality invariant that Regression B violates. |
| `docs/design/poly-dashboard-market-aggregation.md` | **Fold into the dashboard doc as §3.** | One tab on the same card. Not a separate concern. |

**Missing spec to write**: nothing currently owns the contract for `poly_market_outcomes` writes, dashboard PnL calculation, or the relationship between Polymarket Data-API `redeemable=true` and our outcomes table. The 692-orphan gap exists in unspecified territory; until that contract is written, "fix vs accept" is a judgment call rather than an enforceable rule.

After consolidation: **3 docs in scope** (1 spec, 2 design) plus **1 new "Poly Outcomes & PnL" spec** that needs to exist. Net same count, cleaner ownership.

## Recommendations for the next dev

1. **Don't trust the prior agent's narrative.** Re-run STEP 0 against current production state.
2. **Regression B is the only confirmed spec violation.** Fix it first, in its own PR. Replace `summarizeDailyTradeCounts(ledger_rows)` with a `count() GROUP BY day` SQL aggregate against `poly_trader_fills` for the trading wallet, joined like `readDailyCountsFromDb` already does. ~30 LOC. Cite `poly-dashboard-balance-and-positions.md:142–144` in the PR description.
3. **Issue A needs a spec before code.** Write the missing "Poly Outcomes & PnL" spec — what writes `poly_market_outcomes.resolved_at`, what's the lag SLO between chain resolution and our row, what does the dashboard PnL surface depend on. Then identify the silent-dropout root cause and fix it. Don't write a "backfill these 692" migration without identifying the upstream write-path gap — that's the same trap bug.5041 fell into (cosmetic fix + one-shot recovery, deferring the structural fix, leading to the same incident hitting again twelve hours later).
4. **Consolidate the docs in the same PR as Issue A's spec.** Adding a new spec on top of 5 existing fragmented ones makes the sprawl worse, not better.
5. **The user is rightly skeptical.** Show queries with receipts, not conclusions.
