---
id: research.poly-mirror-divergence-2026-05-01
type: research
status: draft
created: 2026-05-01
tags: [poly, mirror, divergence, slippage, sizing, outcome-mapping]
implements: bug.5003
---

# Mirror P/L Divergence Analysis — 2026-05-01

> Operator observation: target wallet RN1 is net even-to-up today; our mirror is **−$95 of $260 deposits (~30%)** (later grew to **−$130 of $260 in <12h**). Hypotheses A/C from bug.5003 investigated below.

## ⚠️ Correction (2026-05-01 ~24:00 UTC) — read first

**Hypothesis D in this doc was a false alarm.** I claimed a "wrong-outcome mirroring" bug based on `/positions` API showing target with no holdings on assets we mirrored. On-chain verification of one suspect tx hash (`0x8822381bb4fa3b70…`) via Polygon `eth_getTransactionReceipt` proved:

```
TransferSingle(operator=0xe2222...310f59, from=0xe2222..., to=0x000…2005d16a…)
                                                              ↑ RN1 received the CTF token
```

The trade IS RN1's. Polymarket Data API correctly reported it; our normalizer correctly preserved `trade.asset` byte-for-byte; CLOB place wrote the correct `token_id`. **There is no outcome→token mapping bug.** The `/positions` discrepancy is a Data-API visibility quirk (likely size threshold / indexing lag), NOT pipeline divergence.

PR #1184 (which adds an `ASSET_IS_AUTHORITATIVE` runtime guard) is therefore tautological under current code — it cannot fire. Recommend close.

**The remaining real driver is Hypothesis C — sizing asymmetry.** Read that section as the primary finding. The bet-sizer agent should focus there.

Out-of-scope nuances a follow-up agent could close:

- Only **1 of 4** suspect tx hashes was on-chain-verified (the rest are below the public Data-API offset cap of ~3000). High-likelihood the other 3 are also real RN1 trades.
- Counter-factual P/L ("if we had perfectly mirrored sizing, what would today look like?") was not computed; this is the next quantitative step.

## Inputs

- **Our trades**: `poly_copy_trade_fills` on prod, status=filled, observed_at::date = today (2026-05-01). 105 fills.
- **Target trades**: Polymarket Data API `/trades?user=0x2005d16a…&takerOnly=false&limit=1000` (latest window, mostly today). 1000 trades returned.
- **UTC reference**: 2026-05-01 ~21:00.

---

## Hypothesis A — Slippage

**Verdict: NOT the bug.**

Matched 14 of our 105 trades against a target trade on the same `token_id` + `side` immediately preceding ours. Of those 14:

```
slippage diff_pp distribution (our_px − target_px, in percentage points):
  min     p25    median  mean   p75    p95    max
  0.00    0.00   0.00    0.00   0.00   0.00   0.00

entries WORSE than target by ≥1pp:  0  / 14
entries equal-to-target (|Δ|<0.5pp): 14 / 14
entries BETTER than target (Δ<0):   0  / 14
```

Mirror places a limit order AT target's exact price; when filled, it fills at exactly that price. **Zero slippage on every matched fill.** Slippage is not the explanation.

---

## Hypothesis C — Sizing asymmetry

**Verdict: Massive — but expected at v0.**

Target's bet-size distribution today (USD notional = `size × price`, n=1000):

```
percentile     usd_notional       
─────────      ─────────────       ▁▂▃▄▅▆▇█
   min            $0.003           ▏
   p25            $0.66            ▎
   p50            $4.33            ▌
   p75           $40.20            ▆
   p90          $217.46            ▇
   p95          $560.45            ▇▇
   p99        $1,333.38            █
   max        $1,592.53            ██

  total today  $82,636 across 1000 trades
  mean         $82.64
```

Our trades today (n=105): total $215.13, **avg $2.05** — sitting between target's `min` and `p25`. Our hard cap is $1/trade (project doc constraint, lifted to ~$5 per task.5001 mirror policy v0). 

**Convexity gap**: Target sizes by conviction. Their median bet ($4.33) is bigger than our average. Their 99th-percentile ($1,333) is 600× ours. Even with a perfect mirror, our portfolio shape doesn't capture target's high-conviction wins because we cap their $500+ bets at our $5 ceiling.

Sizing is sub-optimal but not the surprise. v0 by design.

---

## Hypothesis D — **Wrong-outcome mirroring (NEW, critical)**

**Verdict: 🔴 ACTIVE BUG. ~14% of overlapping conditions have us on the OPPOSITE side of the binary.**

Method: for each `condition_id` where BOTH we and target traded today, check whether our `token_id` set matches target's `asset` set. Same token = same outcome. Different token = OPPOSITE outcome of the binary (YES vs NO, Over vs Under, etc).

```
overlapping conditions today:                                 29

  SAME outcome (perfect mirror)                               10  ████████░░░░░░░░░░░░░░░░░░  34%
  OPPOSITE outcome (we bought the wrong side of the market)   4  ███░░░░░░░░░░░░░░░░░░░░░░░  14%
  MIXED (sometimes same, sometimes opposite)                 15  ████████████░░░░░░░░░░░░░░  52%

  ──────────────────────────────────────────────────────────────
  conditions where we are at LEAST partially wrong:          19  ██████████████░░░░░░░░░░░░  66%
```

Examples (last-6-digit suffix shown):

| condition_id | our token | target token |
|---|---|---|
| `0x…4f3b8b34d45d` | …899376 | …523617 |
| `0x…d489781fca0b` | …877414 | …856124 |
| `0x…d3fab1ab20a3` | …272309 | …221704 |
| `0x…8e2d383b1793` | …969356 | …123493 |

For each binary-outcome market, target's payout and ours are **inversely correlated** when we picked the wrong token. They win → we lose; they lose → we win. With ~30% of overlapping conditions affected (4 fully opposite + 15 partially), the net P/L damage is plausibly the entire −30% gap.

### Likely root causes (ranked, untested)

1. **Outcome-name → token_id resolution mismatch.** Target's fill payload exposes `asset` (token_id directly). Our normalizer may translate via the `outcome` field name (`"Yes" / "No" / "Over" / "Under" / player names`) and pick the wrong tokenId on conditions where the name → outcomeIndex mapping isn't deterministic.
2. **Stale market metadata cache** — outcome-index assigned at our cache-fetch time, target's outcome-index at trade time. Polymarket has reordered outcomes between the two.
3. **The target's `side` field semantics** (`BUY` vs `SELL` of an outcome) interacting with our intent translation. If target SELLs a YES position and we mistakenly BUY the NO outcome (instead of also SELL-ing YES), we end up on the wrong side.

---

## Other surprising findings

- **84 unique tokens we hit today vs 69 unique target assets** in the last 1000 target trades. **50/84 of our tokens (60%)** have no target match in the recent window. Two possibilities:
  1. We're mirroring older target signals (>1000 trades back) — our cursor lag is wider than expected.
  2. We're picking token_ids target never touched (combined with finding D, this strongly suggests our outcome resolution is broken on a subset of conditions).
- **No SELL fills on either side** today. Both we and target are BUY-only. Mirror exit asymmetry is NOT today's problem.

---

## Recommendation (priority order)

| # | Action | Why |
|---|--------|-----|
| 1 | **Investigate finding D — wrong outcome on 14% strict / 66% partial.** Reproduce the resolution path: target fill `(conditionId, asset, side)` → our normalizer → our `token_id`. Find the condition where they diverge. | This is the dominant explanation for the −30% gap. |
| 2 | Lift size cap toward target's median ($4) once D is fixed. Don't fix sizing on top of a wrong-outcome bug — you'll just lose more. | C is real but #1 must come first. |
| 3 | Slippage non-issue at v0 placement style — limit-at-target-price + held-resting works. Defer maker-style placement (P4/CLOB-WS) until the basics are right. | A is fine. |
| 4 | Mirror cursor lag investigation — 50/84 tokens unaccounted-for in the recent target window. May correlate with finding D or be independent. | Secondary. |

---

## Reproducibility

```bash
# Our trades today (prod DB, requires SSH+psql or future Grafana Postgres datasource — see bug.5161)
SELECT REPLACE(market_id,'prediction-market:polymarket:',''), attributes->>'side',
       (attributes->>'limit_price')::numeric, (attributes->>'size_usdc')::numeric,
       attributes->>'token_id'
FROM poly_copy_trade_fills
WHERE status='filled' AND observed_at::date = CURRENT_DATE;

# Target's trades (public, no auth)
curl 'https://data-api.polymarket.com/trades?user=0x2005d16a84ceefa912d4e380cd32e7ff827875ea&limit=1000&takerOnly=false'

# Match: same conditionId, compare token_id sets per side. Diverging sets = finding D.
```

Linked work items: bug.5003 (divergence umbrella), bug.5160 (price clamp — Hypothesis B from the umbrella, not investigated here), bug.5161 (Grafana Postgres datasource — would have made this 5-min instead of 30-min).
