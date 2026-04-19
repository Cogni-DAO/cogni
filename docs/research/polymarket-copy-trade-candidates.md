---
id: research-polymarket-copy-trade-candidates
type: research
title: "Polymarket Copy-Trade Candidate Identification"
status: active
trust: draft
summary: "Identifies 2–3 concrete Polymarket wallets worth paper-mirroring for v0 of the follow-a-wallet feature. Combines (a) cited market-niche edge analysis anchoring sports as the best copy-trade category and geopolitics/crypto-HFT as avoids, with (b) a data-driven funnel over 73 top-leaderboard wallets computing trade frequency, specialization, recency, and realized round-trip PnL. Recommends bossoskil1 (esports), 0x36257cb6 (NBA), and CarlosMC (multi-sport) with explicit confidence caveats, and calls out a follow-up spike to cross-reference resolution outcomes before any real-money path."
read_when: Picking wallets for the poly node's paper-trading mirror. Deciding which market categories to scope follow-a-wallet to at launch. Sanity-checking that leaderboard top-PNL is a bad selection heuristic.
owner: derekg1729
created: 2026-04-18
verified: 2026-04-18
tags:
  [
    knowledge-chunk,
    polymarket,
    poly-node,
    copy-trading,
    follow-wallet,
    wallet-selection,
    edge-research,
  ]
---

# Polymarket Copy-Trade Candidate Identification

> source: spike.0323 research session 2026-04-18 | confidence: medium | freshness: re-check quarterly as wallets rotate and Polymarket category structure evolves

## Question

spike.0314 decided _how_ to copy-trade (Data API → observation → paper-mirror). task.0315 proved the node can _place_ a trade. The missing piece: **which 2–3 wallets do we actually mirror for v0?** A good candidate (a) trades frequently enough to produce signal, (b) operates in a niche where edge is structurally possible, (c) has fast-resolving markets so capital turns over, and (d) has a realized-ROI track record that looks like skill, not a lucky whale bet.

## Context

The `proj.poly-prediction-bot` Run-phase names "follow-a-wallet" as a deliverable. We have:

- `PolymarketDataApiClient` with `listTopTraders`, `listUserActivity`, `listUserPositions` — public endpoints, no auth.
- `PolymarketClobAdapter` (task.0315) capable of placing a post-only order.
- A v0 probe script `scripts/experiments/top-wallet-recent-trades.ts` that already reads leaderboards + trades.

Naive heuristic "rank by leaderboard PNL, copy #1" fails four ways, and this spike has to address each:

1. PNL leaderboards are whale-biased — one $5M winning bet dominates.
2. Win rate ≠ edge — a wallet buying YES at 0.95 wins 95% of the time with zero skill.
3. Some categories have no edge to extract — copying a category-efficient market is net-negative after fees + slippage.
4. Copy-ability ≠ profitability — a sub-second latency-arb bot leaves no window for a 30-second Data-API poller to mirror.

## Findings

### Part 1 — Market-niche edge scorecard

Full cited deep-dive in the [sibling appendix table](#appendix-a--full-niche-scorecard-web-cited). Condensed view, anchored on the Harvard 2026-03 "From Iran to Taylor Swift" informed-trading paper ([corpgov.law.harvard.edu](https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/)) and The Block's 2025 market-share report ([theblock.co](https://www.theblock.co/post/383733/prediction-markets-kalshi-polymarket-duopoly-2025)):

| Category                                 | Edge plausibility (1-5) | Copy-ability (1-5) | Resolution   | Verdict                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | ----------------------: | -----------------: | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sports (NBA/NFL/MLB/tennis/esports)**  |                       4 |              **4** | hours–days   | ✅ **Best v0 target.** Pinnacle-vs-Polymarket lag documented; some futures 40% off fair value; retail-dominated category ([tradetheoutcome.com](https://www.tradetheoutcome.com/best-polymarket-categories-trade-2026/)).                                                                                                                                                        |
| Crypto bucket markets (5/15-min BTC/ETH) |                       5 |              **1** | minutes      | ❌ **Avoid.** Edge is latency arb vs. Binance spot; sub-block; a 30-second poller is 2–3 orders of magnitude too slow ([medium.com](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets-last-second-dynamics-bot-strategies-and-db8efcb5c196), [quantvps.com](https://www.quantvps.com/blog/binance-to-polymarket-arbitrage-strategies)). |
| US elections (on-cycle)                  |                       4 |                  2 | months       | ⚠️ The famous 2024 "French whale" (Fredi9999) made ~$85M on a thesis bet, not a flow-trading strategy ([bloomberg.com](https://www.bloomberg.com/news/articles/2024-11-07/trump-whale-s-polymarket-haul-boosted-to-85-million)). Copy-target only in active high-salience windows.                                                                                               |
| Awards (Oscars, MVPs)                    |                       3 |                  3 | weeks–months | ⚠️ Analytical edge exists; slow turnover. Viable "satellite" target but not v0.                                                                                                                                                                                                                                                                                                  |
| Fed / FOMC / CPI                         |                       2 |                  2 | days–weeks   | ❌ Polymarket is the downstream of CME/SOFR futures; no evidence of wallet-level skill premium.                                                                                                                                                                                                                                                                                  |
| Geopolitics (ceasefires, strikes)        |        5 (for insiders) |              **1** | days         | ❌ **Avoid.** Harvard paper: flagged accounts won 69.9%, >60σ from chance, ~$143M anomalous profit. Copying means inheriting regulatory tail risk ([npr.org](https://www.npr.org/2026/04/10/nx-s1-5780569/betting-polymarket-iran-investigation-lawmakers)).                                                                                                                     |
| Entertainment / celebrity                |                       3 |                  1 | days–weeks   | ❌ **Avoid.** Harvard flagged the Taylor Swift engagement wallet specifically; one-shot insider plays, not repeatable flow.                                                                                                                                                                                                                                                      |

**v0 scope recommendation: sports-only mirror, including esports.** Esports isn't explicitly covered in the web sources but inherits the same thesis as sports (retail-dominant books, informed edge from team-form / meta / roster knowledge) and — critically — our data shows a top-ranked esports-specialist wallet operating there (see Part 3).

### Part 2 — Wallet funnel

Method, fully implemented in [`scripts/experiments/top-wallet-metrics.ts`](../../scripts/experiments/top-wallet-metrics.ts) and frozen at [`docs/research/fixtures/poly-wallet-metrics.json`](fixtures/poly-wallet-metrics.json):

1. Union top-25 wallets across {DAY, WEEK, MONTH} × {PNL, VOL} → **73 unique wallets**.
2. For each, fetch up to 500 recent trades via `listUserActivity`.
3. Compute per-wallet metrics: trade frequency (30d / 7d), days-since-last-trade, unique markets, BUY/SELL ratio, median / p90 USDC size, **realized round-trip PnL** (sum of SELL cashflow − BUY cashflow per `conditionId` for markets where both sides were observed), and a coarse category classifier from market titles.
4. Filter: **leaderboard ROI ≥ 3%, days-since-last-trade ≤ 3, trades ≥ 200, round-trip coverage ≥ 5 markets**.

Funnel result:

```
73 wallets  →  leaderboard union
  ↓  filter: active (<=3d) + ROI>=3% + >=200 trades + >=5 RT markets
10 wallets  →  shortlist
  ↓  filter: specialization in copy-able category (sports/esports) + positive round-trip
3 wallets   →  recommended
+ 2 wallets →  watch list (positive signal but one caveat)
```

Full condensed shortlist:

| wallet        | name              |  lb vol |  lb ROI% | t/day | cat specialty (top-3 markets)             | RT Δusdc (cov)                                   |
| ------------- | ----------------- | ------: | -------: | ----: | ----------------------------------------- | ------------------------------------------------ |
| `0xa5ea13a8…` | **bossoskil1**    |  $18.4M |      8.0 |  15.9 | **esports** (LoL, CS)                     | **+$1.41M (28)**                                 |
| `0x36257cb6…` | (anon)            |   $2.1M | **15.2** |   9.9 | **NBA** (Blazers/Nuggets, Wolves/Nuggets) | +$59k (7)                                        |
| `0x777d9f00…` | **CarlosMC**      |   $8.8M |     13.8 |   8.2 | **multi-sport** (NCAA BB, soccer, intl)   | +$75k (8)                                        |
| `0xb6d6e99d…` | JPMorgan101       |   $3.7M |     22.7 |   2.7 | BTC 5-min buckets                         | +$1.38M (63) — **uncopyable (latency arb)**      |
| `0x2b3ff45c…` | Mentallyillgambld |   $3.6M | **27.0** |   7.7 | NCAA BB, NBA                              | +$900k (27) — **9d cold**                        |
| `0xfea31bc0…` | newdogbeginning   |   $1.4M |      9.5 |  16.7 | golf (Masters), World Cup                 | **−$147k (13)** — mixed signal                   |
| `0xee00ba33…` | S-Works           |   $2.2M |     20.7 |   6.9 | CS, NBA                                   | −$52k (7)                                        |
| `0x5c3a1a60…` | VARsenal          |   $0.3M |     27.9 |   3.9 | T20 cricket, NBA                          | −$52k (17)                                       |
| `0xbaa2bcb5…` | denizz            |  $12.4M |      8.2 |  16.7 | **Iran ceasefire markets**                | −$54k (36) — **insider-flagged category, avoid** |
| `0xd4f904ec…` | avenger           | $0.002M |   10,177 |   1.6 | Elon-tweet bucket markets                 | −$93k (20) — **outlier, ignore**                 |

### Part 3 — Top candidate scorecards

#### 🥇 Candidate A — bossoskil1 — `0xa5ea13a81d2b7e8e424b182bdc1db08e756bd96a`

```
Category specialty     : Esports (League of Legends, Counter-Strike)
Leaderboard appearances: DAY/PNL#15, DAY/VOL#7, WEEK/PNL#8, WEEK/VOL#23, MONTH/PNL#10
Leaderboard vol / pnl  : $18.4M  /  $1.60M   (ROI 8.0%)
Trade count (last 500) : 500  — t30=477, t7=187, t/day=15.9
Days since last trade  : 0.1
Unique markets         : 256
BUY / SELL share       : 87% / 13%
Median / p90 trade USDC: $3.1k  /  $44k
Round-trip PnL         : +$1,408,094.88 across 28 markets where both sides observed
Top-3 markets          : LoL Sentinels×Cloud9, CS OG×BESTIA, LoL LNG×EDG
Copy-ability (1-5)     : 4 — 15/day gives signal; median $3k is mirrorable at 1% scale ($30 per trade)
```

**Hypothesis for edge:** Esports is a retail-dominant, form-heavy category. Knowing the current meta, roster changes, recent scrim results, and tournament context is a legitimate analytical edge. The +$1.4M round-trip across 28 distinct markets (not concentrated on one lucky bet) is the strongest "skill, not luck" signal in the whole dataset. Five-window leaderboard appearances (DAY + WEEK + MONTH) confirm this isn't a single hot streak.

**Risks to copying:**

- Esports liquidity is thinner than NBA/NFL — slippage per mirror is higher.
- BO3 esports matches resolve in ~1–3 hours (fast ✓) but the pre-match window where they'd want to enter is also short — copy-latency on taker fills could bleed the whole edge.
- No public studies on Polymarket esports efficiency; the niche-plausibility rating is inferred from analogy to sports, not cited.

**Paper-mirror plan:** Post-only GTC at same tick as entry, max $50 notional per copy, same market same side. Kill if 10 consecutive paper trades realized negative PnL.

---

#### 🥈 Candidate B — (anon) — `0x36257cb65f199caa86f7d30625bbc1250a981187`

```
Category specialty     : NBA game markets (moneylines, spreads, O/U)
Leaderboard appearances: DAY/PNL#4, DAY/VOL#17
Leaderboard vol / pnl  : $2.1M  /  $316k   (ROI 15.2%  ← strongest positive ROI of active shortlist)
Trade count (last 500) : 308  — t30=297, t7=158, t/day=9.9
Days since last trade  : 0.1
Unique markets         : 208
BUY / SELL share       : 98% / 2%   ← buy-and-hold-to-resolution style
Median / p90 trade USDC: $2.2k  /  $9.9k
Round-trip PnL         : +$58,854 across 7 markets where both sides observed (small coverage caveat)
Top-3 markets          : Trail Blazers×Nuggets, Wolves×Nuggets (+O/U), repeat games
Copy-ability (1-5)     : 5 — smallest sizes + NBA liquidity = easy mirror
```

**Hypothesis for edge:** The wallet matches the canonical "sharp-vs-public NBA" thesis directly — NBA category + 15.2% LB ROI + DAY-window top-4 on PNL + smaller capital base ($2M vol vs. the $60M+ whales). 98% BUY / 2% SELL means they size up at entry and hold to resolution (consistent with betting moneylines/spreads at fair-odds and collecting). Low round-trip coverage (only 7 markets show both sides) is precisely because they _hold_, not a bad sign.

**Risks to copying:**

- Round-trip coverage = 7 is a small sample for our PnL estimate. The leaderboard PNL of $316k is the more-reliable signal here.
- Buy-and-hold means you copy at entry and sit on the position through NBA game close. Real money exposure would need a daily position cap.
- Anonymous handle → no social signal, no context for drawdowns.

**Paper-mirror plan:** Post-only GTC mirror at entry; no mirror-of-SELL logic needed since they rarely sell; position closed automatically at market resolution.

---

#### 🥉 Candidate C — CarlosMC — `0x777d9f00c2b4f7b829c9de0049ca3e707db05143`

```
Category specialty     : Multi-sport (NCAA basketball, English Premier League, international soccer)
Leaderboard appearances: WEEK/PNL#13, MONTH/PNL#15
Leaderboard vol / pnl  : $8.8M  /  $1.27M   (ROI 13.8%)
Trade count (last 500) : 500  — t30=247, t7=38, t/day=8.2 (tapering slightly)
Days since last trade  : 0.1
Unique markets         : 214
BUY / SELL share       : 98% / 2%   ← same buy-and-hold pattern
Median / p90 trade USDC: $3.4k  /  $29.8k
Round-trip PnL         : +$75,428 across 8 markets where both sides observed
Top-3 markets          : Creighton×St.John's O/U 155.5, Will Türkiye win 2026-03-26?, Spurs×Arsenal O/U 2.5
Copy-ability (1-5)     : 4 — recent 7d activity (38 trades) is half the 30d rate, slight slowdown
```

**Hypothesis for edge:** Diversified sports bettor with WEEK + MONTH leaderboard stamps. Not a specialist (which the literature prefers) but the diversification itself is a signal: the book is broad enough that a disciplined bettor can pick softer lines across sub-categories (NCAA O/Us, non-top-5-league soccer) where Polymarket liquidity is thinner and lines laggier. 13.8% ROI at $8.8M volume is harder to reproduce by luck than a $2M volume wallet.

**Risks to copying:**

- 7-day activity dropped from 58/week pace to 38/week — mild taper. Watch whether this is normal seasonality or exit.
- "Multi-sport" means our v0 bot needs to handle markets across NCAA, EPL, international football, and potentially more. Simpler to scope to one sport at first.
- The 14% ROI may over-represent a single big run (MONTH window); DAY-window absent from leaderboard hits.

**Paper-mirror plan:** Same as Candidate B; optionally scope v0 to only mirror trades where the market title contains sports keywords from an allowlist.

---

### Part 4 — Watch list (not recommended for v0)

- **Mentallyillgambld** (`0x2b3ff45c…`) — 27% ROI + $900k RT across 27 markets (NCAA BB, NBA) is the strongest profile _if_ active. 9 days cold. Set up a monitor; promote if they return with recent activity.
- **newdogbeginning** (`0xfea31bc0…`) — pure Masters/World Cup specialist, 9.5% LB ROI, but round-trip PnL is −$147k. Possible interpretations: (a) genuinely negative recent run, (b) buy-and-hold binaries where the SELL side is "resolution payout" not a trade, which our metric doesn't capture. Flagged as "needs resolution-outcome cross-reference before judging."

### Part 5 — Explicit wallet avoids

- **JPMorgan101** (`0xb6d6e99d…`) — 22.7% ROI, +$1.38M RT, looks great. **But category = BTC 5-minute buckets**, which the edge research identifies as sub-block latency arb. We cannot copy a bot that fills in the same block as Binance tick. Excluded on copy-ability, not on skill.
- **denizz** (`0xbaa2bcb5…`) — top markets are all US-Iran ceasefire / surrender questions. This is the exact category Harvard flagged for informed trading ([corpgov.law.harvard.edu](https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/), [npr.org](https://www.npr.org/2026/04/10/nx-s1-5780569/betting-polymarket-iran-investigation-lawmakers)). Copy-trading these wallets means inheriting regulatory tail risk with a known congressional probe in flight.
- **avenger** (`0xd4f904ec…`) — $2k leaderboard volume + 10,177% ROI. Lucky single bet on an Elon-tweet-count market. Not skill.
- Generic whale leaderboard #1s (`0x5d58e38c…`, `0x64805429…`, `0x9e9c8b08…`) — $40M–$68M volume, near-zero ROI, generalist. "Top" only because of capital, not edge.

## Recommendation

> **Amended 2026-04-18 (same day).** The "binding limitation" flagged in the original Open Questions — that we couldn't verify true edge without resolution data — turned out to be cheap to close in the same session. The **CLOB endpoint `/markets/{conditionId}`** returns `closed` + `tokens[].winner`, so we joined every wallet's trades against resolution outcomes to compute **realized** PnL per token position: `pnl = sell_usdc + (remaining_shares × $1 if winner else $0) − buy_usdc`. The findings materially changed the ranking.

### True-win-rate matrix (from resolved token positions)

| wallet                        | resolved posns |   W |      L | **true win rate** | realized PnL | realized ROI | max DD | DD % of peak |
| ----------------------------- | -------------: | --: | -----: | ----------------: | -----------: | -----------: | -----: | -----------: |
| **CarlosMC** (`0x777d9f00`)   |             51 |  29 |     22 |         **56.9%** |   **+$877k** |   **+55.2%** |  $128k |    **14.6%** |
| **bossoskil1** (`0xa5ea13a8`) |            254 | 136 |    117 |         **53.5%** | **+$2,137k** |   **+52.3%** |  $216k |     **9.6%** |
| ~~0x36257cb6~~                |             54 |  24 | **29** |      **44.4%** ⚠️ |         +$3k |        +0.8% |   $57k |  **241%** 🚩 |

### Key finding — `0x36257cb6` is a false positive; drop from roster

- Their 15.2% leaderboard ROI was **mark-to-market on open positions**, not realized. 154 of 208 markets they traded are still unresolved.
- On the 54 resolved positions they are **losing**: 24W / 29L, realized PnL of only +$3k on $392k deployed = breakeven-with-noise.
- Max drawdown was **241% of peak realized equity** — they went deeply underwater multiple times; the equity curve is a mess.
- Buy-and-hold style (98/2 BUY/SELL) let the leaderboard flatter them. The realized data tells a different story.
- **Action:** remove from the v0 mirror roster. The composition is now **2 wallets: CarlosMC + bossoskil1**, pending the broader screen noted below.

### Revised top 2 from the resolved join

1. **CarlosMC** — **best true win rate (56.9%)** + cleanest DD (14.6% of peak). UFC / MLB / NBA underdog buyer. $877k realized on $1.59M deployed.
2. **bossoskil1** — slightly lower win rate (53.5%) but **4× the realized PnL and tighter 9.6% DD**. Esports flow-trader; selective sizing drives the ROI.

Both are strong. Ordering swapped from the original recommendation; `0x36257cb6` is demoted.

### Expanded 140-wallet resolved-screen — the real shortlist

The 3-candidate recommendation above was a survivor-pick off the original 73-wallet leaderboard union. After running the same resolution-join methodology against a **140-wallet universe** (top-50 × 6 leaderboards, 12.4k unique markets looked up), **16 wallets pass the full filter set**: ≥1 trades/day, active ≤5 days, ≥15 resolved positions, true WR ≥52%, realized ROI ≥10%, median round-trip duration ≤9h, max DD ≤40% of peak.

**Top 10 by composite score `WR × √ROI × 100 / (DD% + 10)`:**

| rank | wallet        | name             | cat     | t/day | resolved |      true WR | realized ROI | realized PnL |     max DD% | med dur |
| ---: | ------------- | ---------------- | ------- | ----: | -------: | -----------: | -----------: | -----------: | ----------: | ------: |
|    1 | `0x6d3c5bd1…` | VeryLucky888     | NBA     | 16.67 |       33 |    **78.8%** |       1033%¹ |         $33k |    **4.9%** |    0.2h |
|    2 | `0xc69020e5…` | **goodmateng**   | esports | 10.33 |       22 | **95.5%** ⭐ |         245% |    **$356k** |        6.9% |    0.7h |
|    3 | `0x161eb168…` | **piston777**    | esports | 16.67 |       43 |    **86.0%** |        19.5% |        $151k | **2.2%** ⭐ |    0.2h |
|    4 | `0x26f8af9d…` | **Mr.Ape**       | esports |  11.2 |   **75** |        64.0% |         135% |        $114k |       14.5% |    0.4h |
|    5 | `0x36257cb6…` | (anon)           | NBA     |   9.9 |       37 |        54.1% |        60.1% |        $406k |    **6.6%** |    0.7h |
|    6 | `0xa5ea13a8…` | bossoskil1       | esports |  15.9 |       64 |        60.9% |        69.9% |        $841k |       24.9% |    0.9h |
|    7 | `0x52ecea7b…` | fkgggg2mouzfuria | esports | 16.67 |       51 |        52.9% |        16.7% |        $109k |        9.2% |    0.1h |
|    8 | `0x492442ea…` | (anon)           | NBA     | 16.67 |       39 |        64.1% |        43.3% |  **$1,171k** |       28.1% |    0.1h |
|    9 | `0x32ed517a…` | sportmaster777   | NBA     | 16.67 |   **96** |        55.2% |        27.8% |         $31k |       18.3% |      1h |
|   10 | `0x5c3a1a60…` | VARsenal         | esports |   3.9 |       66 |        65.2% |        32.4% |        $100k |       26.1% |    0.7h |

¹ `VeryLucky888`'s 1033% ROI = $33k PnL on ~$3k deployed. Name hints at the likelihood. Low-capital scalping — very small bets. Flag.

**Important revision — `0x36257cb6` is back (partially rehabilitated):** the 140-wallet screen ran ~30 min after the initial 3-wallet analysis, with a different rolling window of their last 500 trades. In this slice they show **54.1% WR / 60.1% ROI / $406k realized / 6.6% DD** — materially healthier than the earlier slice (44.4% / 0.8% / $3k / 241% DD). The rolling-window instability is itself a warning: their track record is brittle to sample choice. Keep them off the primary roster but add to the watch list.

### New primary recommendations (supersedes the 2-wallet revision above)

Given the expanded data, the v0 roster should be **3 wallets, esports-heavy**:

1. **piston777** (`0x161eb168`) — **best risk-adjusted profile in the entire screen**: 86% WR across 43 resolved esports positions, 2.2% max DD (!!), 16.67 trades/day, 0.2h median duration. Smaller-ROI (19.5%) but the Sharpe-like cleanliness and high sample size make this the lowest-regret paper-mirror pick.
2. **goodmateng** (`0xc69020e5`) — **95.5% win rate** on 22 resolved esports positions, 245% ROI, 6.9% DD, $356k realized. Win rate is extraordinary; flag as "too good to be true" and size cautiously until more of their unresolved positions close. This is the high-upside pick.
3. **Mr.Ape** (`0x26f8af9d`) — 75 resolved positions (largest sample among filter-passing esports), 64% WR, 135% ROI, 14.5% DD. Robust across a bigger n than the top two — this is the "we're confident the edge exists" pick.

**Esports sweep.** All three primary picks are esports specialists. The category thesis — retail-dominant books on LoL/CS/Dota with informed edge via team-form / meta / roster knowledge — is now confirmed by data, not just analogy to sports.

**NBA alternates** if we want roster diversification away from single-category regime risk: `0x492442ea…` ($1.17M realized, 64% WR) or `sportmaster777` (96-position sample, 55.2% WR, 27.8% ROI).

**Previous picks revisited:**

- **bossoskil1** — rank 6 in the expanded screen. Still strong but dethroned by piston777 / goodmateng / Mr.Ape within the same esports category. Keep as alternate.
- **CarlosMC** — did not appear in the top-50 leaderboards at screen time (different leaderboard snapshot). Their earlier resolved-join numbers (56.9% WR on 51 resolved) are still valid — they belong on the watch list but not the primary roster.
- **0x36257cb6** — see note above; rehabilitated as a watch-list candidate; not primary.

### Screen caveat

The CLOB lookup resolved 2,641 of 12,400 unique markets (21%). Missing markets were classified as "open"; true resolution rates are almost certainly higher and would shift some wallets across the filter threshold. Rerunning with exponential backoff on rate-limited responses would tighten the numbers, but the **ranking is robust**: the same rate-limit effect applies uniformly across wallets. The identity of the top-N is much more stable than their exact scores.

### $50-notional paper-mirror projection (linear-scaled from actual history)

| wallet     | their median trade | scale factor | projected PnL over same N copies | projected max DD | bankroll w/ 2× DD buffer |
| ---------- | -----------------: | -----------: | -------------------------------: | ---------------: | -----------------------: |
| bossoskil1 |             $16.1k |       0.003× |                       **+$6.6k** |         **$671** |               **$1,340** |
| CarlosMC   |             $31.2k |       0.002× |                       **+$1.4k** |         **$206** |                 **$412** |

**Confidence: medium.** The resolution-join closes the biggest measurement gap from the initial analysis, but survivorship bias remains: both candidates entered our sample because they're currently on the leaderboard. A wider sweep (200+ wallets, not 73) is in flight; see Appendix C. Real slippage + 2% taker fees will probably eat 30–50% of projected edge.

**v0 risk caps** (non-negotiable):

- Paper trading only until 2-week shadow run shows positive aggregate PnL.
- $50 USDC notional per mirrored trade, $500 daily aggregate cap per wallet.
- Post-only GTC orders only — no market takes during copy.
- Auto-kill a wallet-mirror if 10 consecutive resolved copies are net-negative.
- Sports markets only (allowlist by title keywords).

## Open Questions

1. ~~**Resolution-outcome cross-referencing.**~~ **Resolved in-session** via `clob.polymarket.com/markets/{conditionId}` which exposes `tokens[].winner`. See Recommendation section above — the join was cheap and it materially revised the ranking.
2. **Post-removal-of-500ms-delay sports slippage.** Polymarket removed its 500ms crypto taker delay in Feb 2026; no independent study of sports impact exists. Paper-trade telemetry will fill this gap in-situ.
3. **Whether esports-specialist edge persists through meta changes.** bossoskil1's track record is current-meta; meta patches (especially LoL/CS map updates) could invalidate the edge overnight. Watchable via Telemetry.
4. **Whether buy-and-hold-to-resolution wallets (Candidates B & C) leave copy-able entry windows or fill too fast.** The 98% BUY / 2% SELL pattern implies mostly limit orders sitting on the book — good for copy-ability — but we don't yet know the median book-dwell time before their orders fill.
5. **How to detect wallet retirement / handle reset.** If bossoskil1 stops trading for 7+ days, do we auto-demote and pull from the watch list? Logic not yet specified.

## Proposed Layout

This research closes spike.0323. It opens one follow-up spike and two tasks inside the existing `proj.poly-prediction-bot` roadmap.

### Project

No new project. Fits the existing **`proj.poly-prediction-bot`** Run-phase "follow-a-wallet" deliverable. The candidate list shipped here is the concrete input to that deliverable.

### Specs

No new spec. When the paper-mirror is built, it should be spec'd alongside the existing `ObservationEvent` surface from spike.0314 — as a _consumer_ of the awareness-plane observation stream, not a separate subsystem.

### Follow-up work (no separate items yet — let evidence decide)

spike.0314 already set the precedent of "one prototype task, not a decomposition" — the same discipline applies here. Three directions are visible, in rough priority order, but none warrant a filed work item until this research is put to use:

1. **Verify the ranking before building.** Join a wallet's trades against resolved-market outcomes from `gamma-api.polymarket.com/markets` (or the Polymarket subgraph) and recompute true win rate, true ROI-per-resolved-trade, and Brier-delta-vs-entry-implied-probability. Invalidates or confirms the three candidates here. If confirmed, the paper-mirror below becomes easy to defend; if invalidated, we redo the candidate selection before writing any emitter. Cheap — one day of script-writing + analysis. **Do this first if we commit to the feature.**
2. **Roster + observation emitter.** Extend the Data-API poller to watch the 3 candidate addresses and emit `ObservationEvent(kind=polymarket_wallet_trade)` per trade per spike.0314's architecture. Chat-tool surface + DB-only storage; no execution. This is the minimum end-to-end wiring that makes wallet activity visible to `poly-brain`.
3. **Paper-mirror harness.** Plug the observation stream into `PolymarketClobAdapter` with `DRY_RUN=true`, $50-per-trade notional cap, sports-only allowlist, auto-kill after 10 consecutive resolved copies net-negative. 2-week paper-soak is the hard gate before any real-money path.

File a work item for (1) when we decide to act; file (2) and (3) only after (1) either confirms the candidates or produces new ones. No preemptive decomposition.

---

## Appendix A — Full niche scorecard (web-cited)

This section aggregates the Phase-1 research citations that the condensed scorecard in Findings Part 1 draws from. For the full deep-dives and all 27 source URLs, see the research summary embedded in spike.0323 close-out (agent transcript, 2026-04-18).

Key anchor sources:

- Harvard Law School Forum — ["From Iran to Taylor Swift: Informed Trading in Prediction Markets"](https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/) (2026-03-25) — primary academic evidence of insider trading patterns; source for the 69.9% win-rate / >60σ / ~$143M anomalous profit figures that drive the geopolitics/celebrity avoids.
- The Block — ["Prediction markets explode in 2025"](https://www.theblock.co/post/383733/prediction-markets-kalshi-polymarket-duopoly-2025) — category volume shares (sports ~39%, politics ~34%, crypto ~18%, econ growing) used for the scorecard's volume column.
- Trade The Outcome — ["Best Polymarket Categories to Trade in 2026"](https://www.tradetheoutcome.com/best-polymarket-categories-trade-2026/) — Pinnacle-vs-Polymarket lag thesis; 40%-off-fair-value claim on sports futures.
- Benjamin-Cup Medium + QuantVPS — ([medium.com](https://medium.com/@benjamin.bigdev/unlocking-edges-in-polymarkets-5-minute-crypto-markets-last-second-dynamics-bot-strategies-and-db8efcb5c196), [quantvps.com](https://www.quantvps.com/blog/binance-to-polymarket-arbitrage-strategies)) — documents the sub-block latency-arb edge in BTC/ETH 5-min bucket markets. Key input to the **JPMorgan101 avoid decision.**
- Bloomberg / CBS 60 Minutes — 2024 French-whale post-mortems; establish "thesis trader, not flow trader" framing for election wallets.
- NPR + Bloomberg (Iran coverage) — establish the congressional-probe regulatory tail risk for geopolitics category.

## Appendix B — Raw metrics fixture (initial 73-wallet funnel)

Frozen at [`docs/research/fixtures/poly-wallet-metrics.json`](fixtures/poly-wallet-metrics.json) — 73 wallets × Data-API-only metrics, generated 2026-04-18 by [`scripts/experiments/top-wallet-metrics.ts`](../../scripts/experiments/top-wallet-metrics.ts). This is the initial "proxy metrics" pass; superseded by the resolved-screen in Appendix C.

Re-run: `npx tsx scripts/experiments/top-wallet-metrics.ts` (no env needed; public Data API).

## Appendix C — Resolved-outcome wallet screen (expanded universe)

Frozen at [`docs/research/fixtures/poly-wallet-screen.json`](fixtures/poly-wallet-screen.json), generated 2026-04-18 by [`scripts/experiments/wallet-screen-resolved.ts`](../../scripts/experiments/wallet-screen-resolved.ts).

Method:

1. Union top-50 wallets across `{DAY, WEEK, MONTH} × {PNL, VOL}` → ~150 unique wallets.
2. Fetch up to 500 recent trades per wallet.
3. Dedupe `conditionId`s globally and fetch each market once from `clob.polymarket.com/markets/{cid}` (returns `closed` + `tokens[].winner`).
4. For each wallet × token-position: `pnl = sell_usdc + (remaining_shares × $1 if winning token) − buy_usdc`. Sum to get realized PnL; sort chronologically for equity curve + max drawdown.
5. Apply hard filters: trades/day ≥ 1, active ≤ 5 days, ≥ 15 resolved positions, true WR ≥ 52%, realized ROI ≥ 10%, median round-trip duration ≤ 9h, max DD ≤ 40% of peak.
6. Rank survivors by composite score `WR × √ROI × 100 / (DD% + 10)`.

Re-run: `npx tsx scripts/experiments/wallet-screen-resolved.ts` (no env needed; ~10 min).

## Appendix D — Phase 2 expansion: long-tail niches + discovery methods

A second research agent closed three gaps left by the initial pass:

### D.1 Polymarket's category-filtered leaderboard API

The initial screen used the uncategorized `/v1/leaderboard` endpoint (~500 wallets ceiling). Polymarket actually supports 8 category-filtered variants, each with its own top-N: **politics, sports, crypto, weather, culture, economics, tech, finance**. Reference: [docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings](https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings). Combined with `{DAY, WEEK, MONTH} × {PNL, VOL}`, that's 8 × 3 × 2 = 48 leaderboard slices, ~1000–1500 unique wallets vs. the ~150 from the uncategorized variant — roughly **10× the discovery universe**.

### D.2 Long-tail niche additions

Three niches the initial scorecard missed, all with plausible edge:

| niche                                                          | edge source                                                    | resolution | copy-ability | verdict                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ---------- | -----------: | ------------------------------------------------------- |
| **Daily weather** (city high-temp markets)                     | NOAA/ECMWF ensembles vs. retail book; public bot guide exists  | 24h        |            4 | ✅ **strong add** — $300–400k/day per top market        |
| **Cricket / IPL T20**                                          | Non-US info asymmetry (local specialists vs. absent US sharps) | hours      |            4 | ✅ **strong add** — $1.8M single-match volumes          |
| **Expanded esports** (Valorant, Overwatch, Rocket League, SC2) | Same edge thesis as LoL/CS — retail books + meta/roster info   | 1–3h       |            4 | ✅ **expand scope** — 447 active mkts across 11+ titles |

Sources: [tradetheoutcome weather bot guide](https://www.tradetheoutcome.com/how-to-build-a-polymarket-weather-bot/), [polymarket.com/predictions/climate-weather](https://polymarket.com/predictions/climate-weather), [polymarket.com/sports/cricipl/games](https://polymarket.com/sports/cricipl/games), [polymarket.com/esports/live](https://polymarket.com/esports/live).

### D.3 New confirmed avoids (regulatory)

- **Reality TV** (Survivor, Bachelor) — pre-taped spoiler leaks drove pre-vote prices to 98% on correct contestants; Palantir+TWG surveillance deal announced. Active insider-trading controversy ([gamingamerica.com](https://gamingamerica.com/news/1050316/reality-tv-betting-insider-trading-prediction-markets)).
- **FDA approvals, CEO/M&A timing, indictments, SCOTUS rulings** — [Schiff-Curtis "Prediction Markets are Gambling Act"](https://www.cnbc.com/2026/03/25/prediction-markets-bill-insider-trading-kalshi-polymarket-adam-schiff-john-curtis.html) + [Torres bill](https://ritchietorres.house.gov/posts/in-response-to-suspicious-polymarket-trade-preceding-maduro-operation-rep-ritchie-torres-introduces-legislation-to-crack-down-on-insider-trading-on-prediction-markets) target these categories specifically.
- **Harvard 2026 flagged-wallet dataset** ([corpgov.law.harvard.edu](https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/)) — 210,718 flagged (wallet, market) pairs. **Load as exclusion gate before any real-money path** — a copy-trade bot that accidentally mirrors a flagged wallet is a regulatory letter waiting to happen.

### D.4 Wallet-discovery methods beyond leaderboards

Ranked by leverage for long-tail copy-trade discovery:

1. **Goldsky subgraphs** ([docs.polymarket.com/developers/subgraph/overview](https://docs.polymarket.com/developers/subgraph/overview)) — 8 public subgraphs (activity / positions / pnl / orderbook / …) expose every on-chain trade event. Lets us build arbitrary per-niche rankings (e.g. "wallets ≥50 trades on weather markets, sorted by realized ROI"). Unauth GraphQL. **This is the right primitive for long-tail discovery.**
2. **Category-filtered leaderboard API** (§D.1) — simplest path; reuses existing `PolymarketDataApiClient` pattern.
3. **Per-market "top holders" panel** on polymarket.com — the only way to find niche specialists per individual market.
4. **Third-party analytics** ([polymarketanalytics.com](https://polymarketanalytics.com/), [polydata.pro](https://polydata.pro/traders)) — Smart Scores + Sharpe ratios + bot-detection; good cross-validation; ToS unclear on scraping.
5. **Dune dashboards** ([dune.com/genejp999/polymarket-leaderboard](https://dune.com/genejp999/polymarket-leaderboard), [dune.com/filarm/polymarket-activity](https://dune.com/filarm/polymarket-activity)) — pre-computed aggregations; good for one-off sanity checks.

### D.5 Rate-limit reality check — avoid repeating the v2-screen mistake

A first attempt at a v2 screen (`scripts/experiments/wallet-screen-v2.ts`, 8 cats × 3 windows × top-30) was aborted mid-run: the trade-fetch union produced 41,696 unique markets, and the CLOB `/markets/{cid}` lookup loop saturated the per-IP Cloudflare budget even at concurrency 12. Published limit is 1,500 / 10s for `/markets/{cid}`, but real Cloudflare shaping kicks in earlier, and shared-IP contention with other egress (research scripts, dev server, mirror worker) erodes headroom further. Published rate-limit table and our usage pattern are summarized in the in-chat research record; will formalize in a separate follow-up if we keep building screening infrastructure.

**Principles going forward:**

- Cache market metadata on disk keyed by conditionId — `closed=true` markets are immutable, fetch once ever.
- Shared token-bucket rate limiter across every Polymarket fetch caller in the repo.
- For research/screening bursts: cap at ≤50 req/s even when the documented limit is higher; leaves headroom for the live mirror + dashboard.
- Never re-set balance allowance per order (tightest bucket at 50 / 10s).

### D.6 Freshly-derived final roster (synthesis of Appendix B + C + the targeted retry on Mr.Ape)

Because the v2 screen aborted, the final ranking below is synthesized from:

- the 140-wallet resolved-outcome screen (Appendix C),
- the targeted deep analysis on the top 3 (30d stats + CLOB backoff retry for Mr.Ape),
- the Phase-1 category scorecard (Appendix A),
- the Phase-2 avoids (§D.3).

**2026-04-18 v3 update — cross-category screen supersedes the esports-only answer.** Fresh 8-category screen (160 wallets, 5281 closed markets resolved via disk-cached CLOB) produced 11 survivors, **none of them esports**. Tech / weather / finance dominate once the universe isn't biased toward esports-heavy sports leaderboards. See `docs/research/fixtures/poly-wallet-screen-v3-ranking.md`. Revised top 5 across all categories:

| rank | wallet        | name             | category |    WR |    ROI |       PnL |    DD% | med dur |
| ---: | ------------- | ---------------- | -------- | ----: | -----: | --------: | -----: | ------: |
|    1 | `0xc6dd7225…` | tourists         | tech     | 85.7% |  47.9% |     $193k | **0%** |    0.1h |
|    2 | `0x22e4248b…` | ProfessionalPunt | tech     | 83.8% |  97.4% |     $148k |   5.6% |   1.08h |
|    3 | `0x00425c69…` | 99problems123    | tech     | 58.8% | 101.1% | **$262k** |   2.2% |   1.41h |
|    4 | `0x331bf91c…` | BeefSlayer       | weather  | 78.0% |  27.3% |       $5k |  10.7% |   0.48h |
|    5 | `0xff30ac5b…` | aldynspeedruns   | finance  | 63.9% |  50.8% |     $109k |   8.8% |   0.91h |

The earlier "esports is the winner" finding was a sampling artifact — the original 140-wallet universe used the uncategorized leaderboard which over-represents sports categories. With category-balanced sampling (top-10 per category × 8 categories), tech wallets trading tech-prediction + geopolitical-adjacent markets outrank esports on every axis.

### D.7 Per-category reliability breakdown (v3 data, copy-tradeable filter)

Same v3 dataset grouped by leaderboard category, filtered to **median duration ≤ 9h** for copy-tradeability (30s-poll mirror can't handle multi-day holds). Long-hold specialists noted but excluded from primary roster.

| category       | best copy-tradeable wallet         |       n |        WR |   ROI |   PnL |      DD% |   dur | category verdict                                    |
| -------------- | ---------------------------------- | ------: | --------: | ----: | ----: | -------: | ----: | --------------------------------------------------- |
| **TECH** ⭐⭐  | **tourists** (`0xc6dd7225…`)       |      14 | **85.7%** | 47.9% | $193k |   **0%** |  0.1h | cleanest picks overall                              |
| TECH           | ProfessionalPunter (`0x22e4248b…`) |      37 |     83.8% | 97.4% | $148k |     5.6% | 1.08h | second-best tech                                    |
| **WEATHER** ⭐ | **BeefSlayer** (`0x331bf91c…`)     | **118** |   **78%** | 27.3% |   $5k |    10.7% | 0.48h | large sample, clean curve                           |
| WEATHER        | HondaCivic (`0x15ceffed…`)         | **181** |     57.5% |  2.3% |   $4k | **0.2%** |  0.1h | largest n in entire screen; low ROI but ultra-clean |
| **CULTURE**    | **0xa8fac068…** (anon)             |      34 |     79.4% | 33.1% |  $42k | **1.8%** | 6.38h | MrBeast-adjacent markets                            |
| CULTURE        | alohaa (`0x02b4401a…`)             |     117 | **98.3%** | 1225% |   $2k |     3.2% | 3.24h | tiny-capital scalping; skip                         |
| **FINANCE**    | **aldynspeedruns** (`0xff30ac5b…`) |      72 |     63.9% | 50.8% | $109k |     8.8% | 0.91h | solid                                               |
| POLITICS       | SP888 (`0x5d05b1f5…`)              |      17 |     88.2% |   81% |   $5k | **0.7%** | 17.8h | borderline duration                                 |
| SPORTS         | (none pass cleanly)                |       — |         — |     — |     — |        — |     — | see below                                           |
| CRYPTO         | (none pass)                        |       — |         — |     — |     — |        — |     — | all top wallets 28–141% DD — latency arb            |
| ECONOMICS      | (all long-hold)                    |       — |         — |     — |     — |        — |     — | 37h–382h medians; not copyable                      |

### D.8 Sports wallet degradation on full-sample data

When the v3 screen gave the full sports-category slice (not just the esports-biased uncategorized leaderboard), the sports wallets look materially worse than the earlier Appendix C analysis suggested:

| wallet     |  n (v3) |    WR |   ROI |       DD% | was reported as                         |
| ---------- | ------: | ----: | ----: | --------: | --------------------------------------- |
| bossoskil1 | **101** | 50.5% | 13.2% | **53.2%** | 60.9% WR / 69.9% ROI / 24.9% DD at n=64 |
| 0x492442ea |      62 | 54.8% |   17% |   **94%** | 64.1% / 43.3% / 28.1% at n=39           |
| Dhdhsjsj   |      38 | 42.1% | 48.1% |       28% | (not previously analyzed)               |

**Interpretation:** the original resolved-screen's rate-limiting (2,641/12,400 markets, 21% coverage) disproportionately missed the losing trades, flattering win rates. With 5,281 closed markets resolved in v3 (better coverage of the sports subset), the drawdowns reveal themselves. **Esports/sports wallets are less reliable than previously stated.** Goodmateng (82.3% WR / 1.5% DD at n=141) still looks clean in the 30d-only slice; but for cross-category paper-mirror scope, tech/weather wallets are the safer first pick.

### D.9 Final actionable roster (revised from D.6)

Supersedes every prior recommendation in this doc.

**v0 paper-mirror roster — 4 wallets, 4 categories:**

| rank | wallet                               | category | why                                                                   |
| ---: | ------------------------------------ | -------- | --------------------------------------------------------------------- |
|    1 | **ProfessionalPunter** `0x22e4248b…` | tech     | n=37, 83.8% WR, 97% ROI, 5.6% DD, 1h duration — best balanced profile |
|    2 | **tourists** `0xc6dd7225…`           | tech     | 85.7% WR, 0% DD — highest precision but low n=14; size conservatively |
|    3 | **BeefSlayer** `0x331bf91c…`         | weather  | n=118, 78% WR, 10.7% DD — largest-sample weather specialist           |
|    4 | **aldynspeedruns** `0xff30ac5b…`     | finance  | n=72, 63.9% WR, 8.8% DD — diversifier                                 |

**Keep as watch-list:** goodmateng (esports, still elite on 30d-only slice), HondaCivic (weather, ultra-low DD at n=181 but near-zero ROI — acts like a control/benchmark).

**Drop from roster:** Mr.Ape, piston777, all NBA picks — sports reliability didn't hold up on fuller resolution coverage.

**Original esports v0 roster — kept as reference below for historical comparison.** The Mr.Ape/goodmateng/piston777 findings remain valid _within esports_, but not the category-agnostic best picks.

---

**Esports v0 roster (historical; superseded):**

|  rank | wallet                                       | name           | specialty                        | 30d resolved |   true WR | realized ROI |   max DD | median dur | confidence                                                                                 |
| ----: | -------------------------------------------- | -------------- | -------------------------------- | -----------: | --------: | -----------: | -------: | ---------: | ------------------------------------------------------------------------------------------ |
| **1** | `0xc69020e5aeef54bacdf8ad1611769e2162ee42b8` | **goodmateng** | esports (86% of trades)          |          141 | **82.3%** |   **253.6%** | **1.5%** |        39m | highest realized PnL ($1.67M / 30d) — upgrade from "high-upside flag" once n=141 confirmed |
| **2** | `0x26f8af9d49328e5fdae2c24e62e5c523bebd3452` | **Mr.Ape**     | esports (71%)                    |      **227** |     68.7% |       201.3% |     4.1% |        31m | largest sample in shortlist — the "edge is real" pick                                      |
| **3** | `0x161eb16874e34f545991e774b4e1ac5b65f86ef0` | **piston777**  | esports (55%) + NBA/mixed sports |          121 |     79.3% |         8.7% |    25.4% |        13m | highest frequency (16.7 t/d) + fastest turnover; lower ROI but highest activity            |

**Watch list — 4 wallets (would promote if primary roster drops a candidate):**

| rank | wallet                                       | name           | specialty                 | note                                                                                                         |
| ---: | -------------------------------------------- | -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
|    4 | `0xa5ea13a81d2b7e8e424b182bdc1db08e756bd96a` | bossoskil1     | esports                   | 60.9% WR / 69.9% ROI on 64 resolved; dethroned by the top 3 in same category                                 |
|    5 | `0x492442eab586f242b53bda933fd5de859c8a3782` | (anon)         | NBA                       | $1.17M realized / 64% WR / 28% DD — NBA diversifier if we want to break single-category concentration        |
|    6 | `0x32ed517a14e2f6b9e5b6e8b5d4f92b8c91a3a1e8` | sportmaster777 | NBA                       | 96 resolved (largest NBA sample), 55% WR / 28% ROI / 18% DD                                                  |
|    7 | `0x777d9f00c2b4f7b829c9de0049ca3e707db05143` | CarlosMC       | multi-sport (UFC/MLB/NBA) | 56.9% WR / 55.2% ROI on 51 resolved; dropped from the current leaderboard snapshot but historical edge solid |

**Explicit avoids (do not mirror):**

- `0xb6d6e99d3bfe055874a04279f659f009fd57be17` **JPMorgan101** — BTC 5-min bucket latency arb; uncopyable
- `0xbaa2bcb55c…` **denizz** — Iran-ceasefire specialist, Harvard-paper-flagged category
- `0xd4f904ec…` **avenger** — $2k-volume outlier
- Anything trading Survivor / Bachelor / reality TV markets
- Anything trading FDA approvals, CEO transitions, indictments, SCOTUS rulings

**Rule of thumb:** before mirroring any new wallet, cross-check against the Harvard flagged dataset (§D.3). Single correctness gate, zero runtime cost.
