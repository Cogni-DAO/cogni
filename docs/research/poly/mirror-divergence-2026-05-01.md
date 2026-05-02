---
id: research.poly-mirror-divergence-2026-05-01
type: research
title: "Poly Mirror P/L Divergence — 2026-05-01"
status: draft
trust: draft
summary: "Why our copy-mirror was −30% vs target's even-to-up daily P/L. Hypotheses A (slippage — not the bug), C (sizing — material but expected), D (wrong-outcome resolution — active 14% strict / 66% mixed bug), and E (hedge-leg drop — percentile filter skips target's tiny YES hedges, leaving us holding the un-hedged primary). Adds per-bucket histograms for RN1 + swisstony showing 51% of trade events are sub-$5."
read_when: Before designing or reviewing any change to mirror sizing, hedge handling, layering, or outcome resolution. Cite as the standing analysis behind story.5000 and design.poly-mirror-position-projection.
owner: derekg1729
created: 2026-05-01
tags: [poly, mirror, divergence, slippage, sizing, outcome-mapping]
implements: bug.5003
---

# Mirror P/L Divergence Analysis — 2026-05-01

> Operator observation: target wallet RN1 is net even-to-up today; our mirror is **−$95 of $260 deposits (~30%)**. Hypotheses A/C from bug.5003 investigated below, plus a **buried critical finding (D)** that emerged during analysis.

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

Target's bet-size distribution (USD notional = `size × price`, last 1000 trades):

```
percentile     RN1 (0x2005d16a)   swisstony (0x204f72f3)
─────────      ────────────────   ──────────────────────
   min            $0.003                 $0.001
   p25            $1.32                  $1.06
   p50            $4.56                  $3.65
   p75           $21.64                  $8.01
   p90          $160.28                 $38.21
   p95          $480.04                 $81.90
   p99        $1,441.13                $538.59
   max        $6,617.60              $8,264.92

  total            $84,074              $29,881   (last 1000)
  mean                $84                  $30
```

Our trades 2026-05-01 (n=105): total $215.13, **avg $2.05** — between target's `min` and `p25`. Hard cap $5/trade per task.5001 v0 policy.

### Layering vs notional — the buried trap

Percentile sketch hides **how many** trades happen at each level. RN1 and swisstony are both heavily right-skewed: thousands of small layered trades, a handful of big convictions.

```
RN1 (last 1000)                 swisstony (last 1000)
bucket      count  cnt%  not%   bucket      count  cnt%  not%
<$1         180    18%   0%     <$1         209    20%   0%
$1–$5       332    33%   0%     $1–$5       440    44%   3%
$5–$25      250    25%   3%     $5–$25      232    23%   7%
$25–$100    116    11%   7%     $25–$100     80    8%   14%
$100–$500    79     7%  24%     $100–$500    26    2%   19%
$500–$2k     38     3%  37%     $500–$2k     12    1%   25%
$2k+          5     0%  26%     $2k+          1    0%   27%
```

**The asymmetry that matters for mirror design:**

- 51% of RN1's trade _count_ is under $5 — but only 0% of dollar flow.
- 87% of trade count is under $100 — only 11% of flow.
- 3% of trades ($500+) carry **63%** of dollar flow.

A percentile filter set to follow "real" bets (e.g. p75 → $21 for RN1) catches **25% of trades but ~91% of dollar flow**. This sounds like a clean win, but it has two failure modes:

1. **Hedge legs are tiny by design.** Confirmed live 2026-05-02: RN1 bought 593 NO @ $0.67 on Osasuna BTTS (we mirrored at $5.19), then layered ~$1.36-each YES @ $0.20 hedges as YES collapsed. Every hedge fell below percentile and was skipped. We hold the un-hedged primary; RN1 is delta-reduced for ~free. See **Finding E** below.
2. **Layered scale-in is the strategy, not noise.** When RN1 puts on conviction, they often place 5–20 small fills walking the book over minutes-to-hours. A percentile filter sees one big trade and skips the layering entry; the resulting mirror position has worse VWAP and doesn't accumulate at the same pace.

**Convexity gap**: Target sizes by conviction. Their median bet ($4.56) is bigger than our average. Their 99th-percentile ($1,441) is 700× ours. Even with a perfect mirror, our portfolio shape doesn't capture target's high-conviction wins because we cap their $500+ bets at our $5 ceiling.

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

| condition_id      | our token | target token |
| ----------------- | --------- | ------------ |
| `0x…4f3b8b34d45d` | …899376   | …523617      |
| `0x…d489781fca0b` | …877414   | …856124      |
| `0x…d3fab1ab20a3` | …272309   | …221704      |
| `0x…8e2d383b1793` | …969356   | …123493      |

For each binary-outcome market, target's payout and ours are **inversely correlated** when we picked the wrong token. They win → we lose; they lose → we win. With ~30% of overlapping conditions affected (4 fully opposite + 15 partially), the net P/L damage is plausibly the entire −30% gap.

### Likely root causes (ranked, untested)

1. **Outcome-name → token_id resolution mismatch.** Target's fill payload exposes `asset` (token_id directly). Our normalizer may translate via the `outcome` field name (`"Yes" / "No" / "Over" / "Under" / player names`) and pick the wrong tokenId on conditions where the name → outcomeIndex mapping isn't deterministic.
2. **Stale market metadata cache** — outcome-index assigned at our cache-fetch time, target's outcome-index at trade time. Polymarket has reordered outcomes between the two.
3. **The target's `side` field semantics** (`BUY` vs `SELL` of an outcome) interacting with our intent translation. If target SELLs a YES position and we mistakenly BUY the NO outcome (instead of also SELL-ing YES), we end up on the wrong side.

---

## Hypothesis E — Hedge-leg drop (NEW, 2026-05-02)

**Verdict: 🟡 ACTIVE behavioural gap. Not a code bug — a strategy mismatch with the percentile filter.**

Surfaced live on 2026-05-02 prod ("we entered the opposite side" incident on Osasuna BTTS):

| Time (UTC)  | Side | Outcome            | Price | Size          | Mirror action                              |
| ----------- | ---- | ------------------ | ----- | ------------- | ------------------------------------------ |
| 19:09–19:54 | BUY  | **No** @ 0.43–0.67 |       | 9–593 sh      | mirrored ✓ ($5.19 NO @ 0.67)               |
| 19:55–20:01 | BUY  | No @ 0.66–0.80     |       | 5–800 sh      | mirrored ✓                                 |
| 20:13       | BUY  | **Yes** @ 0.20     |       | ~1.36 ea (×7) | **all skipped, `below_target_percentile`** |
| 20:23       | BUY  | Yes @ 0.12         |       | 1.82          | **skipped**                                |

Sequence is unambiguously a **scaling hedge**: target loaded NO heavily at 0.43–0.80, then started layering tiny YES buys at 0.12–0.20 as YES collapsed. Cost-basis-on-the-pair drops; tail risk on the NO leg is capped. Our mirror followed the loud part and ignored the quiet part — exactly what a loud-only filter does, but exactly the wrong choice when target is on the same condition_id with the opposite token.

**Kill criterion for the percentile filter on hedges:** if `(target_wallet, condition_id)` already has an open mirror position on the _opposite_ token, drop the percentile gate and follow the small trade. Cap follow-size at our open exposure on that condition.

Tracked: `story.5000`. Confirms `Hypothesis D` "wrong-outcome" cases are likely a mix of true outcome-resolution bugs **and** hedges we never followed (so we hold one leg of what target holds two legs of, and it visually presents as "opposite side"). Re-run finding D's matcher with a same-condition hedge filter before declaring it 14% strict — some of that 14% may evaporate.

---

## Other surprising findings

- **84 unique tokens we hit today vs 69 unique target assets** in the last 1000 target trades. **50/84 of our tokens (60%)** have no target match in the recent window. Two possibilities:
  1. We're mirroring older target signals (>1000 trades back) — our cursor lag is wider than expected.
  2. We're picking token_ids target never touched (combined with finding D, this strongly suggests our outcome resolution is broken on a subset of conditions).
- **No SELL fills on either side** today. Both we and target are BUY-only. Mirror exit asymmetry is NOT today's problem.

---

## Recommendation (priority order)

| #   | Action                                                                                                                                                                                                                   | Why                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 1   | **Investigate finding D — wrong outcome on 14% strict / 66% partial.** Reproduce the resolution path: target fill `(conditionId, asset, side)` → our normalizer → our `token_id`. Find the condition where they diverge. | This is the dominant explanation for the −30% gap. |
| 2   | Lift size cap toward target's median ($4) once D is fixed. Don't fix sizing on top of a wrong-outcome bug — you'll just lose more.                                                                                       | C is real but #1 must come first.                  |
| 3   | Slippage non-issue at v0 placement style — limit-at-target-price + held-resting works. Defer maker-style placement (P4/CLOB-WS) until the basics are right.                                                              | A is fine.                                         |
| 4   | Mirror cursor lag investigation — 50/84 tokens unaccounted-for in the recent target window. May correlate with finding D or be independent.                                                                              | Secondary.                                         |

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

Linked work items: bug.5003 (divergence umbrella), bug.5160 (price clamp — Hypothesis B from the umbrella, not investigated here), bug.5161 (Grafana Postgres datasource — would have made this 5-min instead of 30-min), **story.5000** (hedge-followup mirror policy, from Finding E).
