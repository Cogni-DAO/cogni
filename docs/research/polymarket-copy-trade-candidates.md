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

Mirror **three wallets** for v0 paper trading, all sports-scoped:

1. **bossoskil1** (`0xa5ea13a8`) — esports, highest-confidence "skill not luck" signal (+$1.4M RT across 28 markets).
2. **0x36257cb6** — NBA, cleanest positive-ROI profile, cheapest to mirror.
3. **CarlosMC** (`0x777d9f00`) — multi-sport diversifier; reduces single-wallet correlation risk.

**Confidence: medium.** The binding limitation of this research is that we **cannot verify true edge** from the public Data API alone — resolution outcomes and entry-price-vs-implied-probability Brier deltas require cross-referencing with `gamma-api.polymarket.com/markets`. The round-trip PnL metric we used is a reasonable proxy for wallets that partially close positions, but undercounts wallets that hold to resolution (see Candidate B caveat). Leaderboard ROI is a different but complementary signal — combining the two filters out most obvious failure modes but does not prove skill.

**v0 risk caps** (non-negotiable):

- Paper trading only until 2-week shadow run shows positive aggregate PnL.
- $50 USDC notional per mirrored trade, $500 daily aggregate cap per wallet.
- Post-only GTC orders only — no market takes during copy.
- Auto-kill a wallet-mirror if 10 consecutive resolved copies are net-negative.
- Sports markets only (allowlist by title keywords).

## Open Questions

1. **Resolution-outcome cross-referencing.** Without joining trades against market resolution timestamps + outcomes from `gamma-api` or the Polymarket subgraph, we can't compute true win rate, true ROI, or Brier-delta-vs-market-implied-probability. This is the single biggest research gap and becomes follow-up spike.0324 (proposed below).
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

## Appendix B — Raw metrics fixture

Frozen at [`docs/research/fixtures/poly-wallet-metrics.json`](fixtures/poly-wallet-metrics.json) — 73 wallets × full metrics, generated 2026-04-18 by [`scripts/experiments/top-wallet-metrics.ts`](../../scripts/experiments/top-wallet-metrics.ts).

Re-run: `npx tsx scripts/experiments/top-wallet-metrics.ts` (no env needed; public Data API).
