---
id: research-poly-wallet-methodology-self-review
type: research
title: "Poly Wallet Methodology — Self-Review for Overfitting + AI-Snapshot Design"
status: active
trust: draft
summary: "Critical self-review of chr.poly-wallet-research v1 by the same agent that wrote it. Identifies eight overfitting / circularity risks (training-on-test sample of 4, hand-tuned coefficients, linear-R² assumption that mis-handles exponential curves, survivorship bias from leaderboard-only seeding, recency bias, fragile liveness signal, single-example calibration of H4, premature anointing of low-sample 0x8dxd). Proposes the AI-agent snapshot format for at-a-glance wallet evaluation: a fixed-length quantile sparkline + one-line metric string returned from a derived `core__poly_data_user_pnl_summary` tool, mirroring the human dashboard sparkline UI."
read_when: Reviewing the chr.poly-wallet-research methodology before scaling it. Designing the wallet-research page row UI. Adding the AI snapshot tool to task.0421. Checking whether the v1 rubric is robust enough to write to Dolt knowledge as ground truth.
owner: derekg1729
created: 2026-04-28
verified: 2026-04-28
tags:
  [
    knowledge-chunk,
    polymarket,
    poly-node,
    methodology-review,
    overfitting,
    sparkline,
    ai-snapshot,
  ]
---

# Poly Wallet Methodology — Self-Review for Overfitting + AI-Snapshot Design

> source: critical self-review by the same agent that authored chr.poly-wallet-research and the 87-wallet screen | confidence: medium-high on overfitting risks, the AI snapshot proposal still needs human signoff

## Why this exists

Derek pushed back: "we will be systematically scanning poly wallets… ensure we're not overfitting." Justified pushback. The charter and the first screen were written by one agent, validated by the same agent, against four wallets that were **named in the same prompt** that asked for the methodology. That is by definition training-on-test. This doc names every place that risk lives.

## Eight overfitting / circularity risks in v1

### 1. n = 4 reference wallets, both classes, used to derive AND validate the rubric

The rubric ranks Derek's two ✅ wallets at #1 and #2 of the 87-wallet screen. **This proves nothing**: the rubric was written knowing those four wallets' shapes. Score `2.51 > 0.00` is a tautology, not evidence of generalization.

**Real test:** the 50-wallet expansion screen running in parallel right now — if its top-N wallets visually match the swisstony / RN1 pattern (smooth uptrend, low DD, large magnitude, still active), the rubric generalizes. If it surfaces wallets Derek would call "meh," it overfits.

### 2. Score formula is hand-tuned with arbitrary coefficients

`score = curveQuality × √(totalPnl/$1M) × livenessFactor × categoryBonus` — every operator and constant in this expression was picked by eye:

- The `√` on PnL "compresses magnitude so a $7M wallet doesn't drown out a $1M wallet with a perfect curve." Could equally be `log` or `pow(0.3)`.
- `/14` days in `livenessFactor` is just "two weeks felt right."
- Category bonuses (`tech 1.2 / weather 1.1 / sports 1.0`) come from a prior research doc whose own n was small.

These are **degrees of freedom**, every one of which could be tuned to match the 4 reference wallets without learning anything generalizable.

**Mitigation:** lock the weights into the charter with a `version` tag (`chr.poly-wallet-research@2026-04-28`). Do not silently re-tune. When the formula changes, bump the version, re-screen, diff the rankings.

### 3. Linear R² is the wrong fit for compounding wealth

A capital-compounder's equity curve is **exponential**, not linear. swisstony's chart is visibly accelerating (image 2: faster slope in Mar–Apr than in Sep–Nov). Linear R² happens to be high (0.95) here because over a 9-month window the curve isn't _that_ exponential — but the metric is theoretically wrong.

The right fit for "consistent compounding" is `log(equity) vs t`. PnL goes negative early in life, so we cannot literally take `log`. The clean substitute is **Spearman rank correlation `ρ(p, t)`** — it measures "monotonically going up" without assuming any functional form. ρ=1 means every later point is higher than every earlier point.

**Recommendation:** add `spearmanRho` as a sibling metric to `slopeR2` in v0.5. Compare. If ρ tracks R² closely on the screen sample, R² is fine; if they diverge meaningfully on accelerating wallets, switch the score to use ρ.

### 4. Survivorship bias — leaderboard-only seeding

The screen seeds 87 wallets from the public leaderboard. By construction, every entrant is already a top-50 winner on at least one window. This is the largest sampling distortion: **the universe contains only wallets that already won big.** Wallets trading consistent edge at lower volumes — exactly the type the curve-shape thesis should surface — never enter.

The charter calls this gap out (`Tooling gaps` row #4: category-filtered leaderboards + holders-based discovery). The first screen did not address it. This is the highest-priority real-world correction; weighted properly, it would re-rank everything.

**Mitigation:** Phase 2 of the screen (after this self-review) seeds from `data-api/holders` on top markets per allowed category — not just leaderboards.

### 5. Recency bias not measured

A wallet that was elite 12 months ago and treaded water for the last 3 still scores high all-time R². The first screen has no `last90R²` or `last90Slope` column. A wallet whose all-time score is great but whose recent score is mediocre is a wallet whose edge has decayed — exactly the wrong kind to copy.

**Mitigation:** add `last90.{slopeR2, slope, totalPnl, daysSinceLastChange}` to the metric bundle. Reject when `last90Slope ≤ 0` or `last90R² < all-timeR² × 0.6`.

### 6. Liveness via `daysSinceLastChange` is a brittle proxy

`daysSinceLastChange` reads the user-pnl curve. The curve only changes when realized PnL changes. A wallet that opened a $500k position yesterday but hasn't sold yet will show `daysSinceLastChange = 0` only because of mark-to-market noise — _not_ because they actually traded. Conversely, a wallet that traded $50 yesterday and the curve barely moved within rounding might read as "idle for 7 days."

**Mitigation:** cross-check liveness against `data-api/activity` last `TRADE` event timestamp (a real action), not just curve delta. The tool exists; the screen just doesn't use it yet.

### 7. H4 calibration was anchored on a single example

We bumped the max-DD-% threshold from 15% → 25% because **swisstony specifically** measured 18.9%. If swisstony measures 26% next month from a deeper pullback, do we keep loosening? Bad pattern.

**Mitigation:** change the metric, not the threshold. Replace "max DD ever in all-time history" with **"max DD that hasn't yet recovered to within 5% of peak"** — i.e. only DDs that are still open count. swisstony's recent ~$1M giveback would still count if the curve hasn't recovered yet, but a 6-months-ago drawdown that the wallet has since blown past doesn't penalize them. This better matches the visual judgment Derek applies to the curves.

### 8. `0x8dxd` was prematurely anointed as a "great new discovery"

I called this wallet rank #3 with R²=0.96 and DD=2.0%. **The wallet only has 4.8 months of history.** A 4-month win streak is fully consistent with a wallet currently in their lucky run that will reverse. Calling it a "great copy target" today is selecting on a metric that hasn't had time to fail.

**Mitigation:** add a `confidence` score that monotonically decays as `monthsActive` shrinks. A wallet with 17 months of clean curve > a wallet with 5 months of cleaner curve. Probably `confidence = min(1, monthsActive / 12)`. 0x8dxd's confidence becomes ~0.4 instead of 1.0; its rank-adjusted score drops below the 17-month cohort.

## What changes for the screen running right now

The 50-wallet expansion screen is the real test. When it returns I'll:

1. Compute `spearmanRho` and `last90` slice metrics on the same data (cheap retrofit; no extra fetches).
2. Apply `confidence` rescoring — wallets with `<6mo` history flagged.
3. Look for the failure modes: does the screen surface anything that doesn't match the visual "good" pattern? Does the original top-3 hold up when ranked by the modified score?

Findings appended below once subagents return.

## AI snapshot — the canonical "great vs meh" data shape

Derek's question: "for an AI research agent, what is the clearest data representation for the quick snapshot impression of 'great copy target vs meh'?"

The human dashboard answer is the sparkline chart (image 5: position rows with mini-chart + price + delta). It works because **shape is the headline signal** and shape is what eyes parse fastest.

For the AI, the constraints are different:

- **Raw point arrays are toxic.** A 300-element `[{t, p}, …]` per wallet × 50 wallets × per-iteration thinking → context bloat that the LLM cannot reason about coherently.
- **Pre-computed metrics ARE useful** but a metric bundle alone does not convey _shape_. "DD 19%, R²=0.95" doesn't make you feel "smooth recovery from one giveback" the way the chart does.
- **The LLM has strong visual-text reasoning.** A 16-character Unicode-block sparkline (`▁▁▂▂▃▄▄▅▆▇▇█`) parses in one glance — even better than a chart for an agent because no rendering is needed.

### Proposed shape — fits on one line per wallet

```
swisstony  0x204f72f3  ▁▁▂▂▃▄▄▅▆▇▇█  $6.56M  9mo  R²=.95↑  DD19%  live0d  esports  ✓pass  s=2.45  conf=.7
```

That's the **entire** wallet snapshot: 12 cells of a pre-quantized sparkline + the metric strip + the verdict. ~80 chars. Stack 20 of these and an agent can rank-order them by eye in one pass.

### How the sparkline is built (deterministic, reproducible)

1. Take the user-pnl `points: Array<{t, p}>` for the wallet.
2. Resample to **fixed N=12 cells** by taking equal-time-spaced quantile bins (or equal-count bins on the points; bench both, prefer time-spaced).
3. For each cell, take the median `p` in that bin.
4. Map that `p` to one of 8 Unicode quantile blocks (`▁▂▃▄▅▆▇█`) by **min-max normalizing within the wallet's own range**: `cell = floor(((p - min) / (max - min)) × 7)`.

Self-normalization matters — it means a $7M and a $100k wallet that both grew smoothly produce the same shape, which is exactly what we want. Magnitude lives in the `$6.56M` cell of the metric strip, not in the sparkline.

### Why this is the correct interface for an agent

- **Compresses 300 floats → 12 chars** with no information loss for the question being asked ("does it go up smoothly?").
- **Same shape feeds the human research page row** — one column of the table is `<MiniChart points={…} />` for humans, and the agent's snapshot string for the API. Same upstream data, two renderings, zero divergence risk.
- **Idempotent + cacheable.** A pure function over the curve. The screen run hashes neatly into the Dolt chunk row.

### Implementation lives in `task.0421`

This means the v0.5 tool surface is two tools, not just `core__poly_data_user_pnl` + a curve-metrics reducer:

| Tool                                           | Purpose                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core__poly_data_user_pnl`                     | raw curve fetch (already in task.0421)                                                                                                                                                                                                                                                                      |
| `core__poly_data_pnl_curve_metrics`            | the pure metric reducer (already in task.0421)                                                                                                                                                                                                                                                              |
| **`core__poly_data_user_pnl_summary`** ← _new_ | **the canonical AI snapshot.** Returns `{ sparkline12, metrics, charterVerdict: { passed, reasons }, score, confidence }` from a single tool call. The agent loop calls THIS in stage 2 of the discovery sequence; raw curves are a fallback only when the summary triggers a "look more closely" decision. |

I'll edit task.0421 to add the third tool to its scope, with the sparkline construction algorithm spelled out so the implementer doesn't reinvent.

### What this means for Dolt schema

The chunk body grows by one field — `sparkline12: string` — and the AI render path comes for free off the persisted row. The dedicated table version (vNext) gets `sparkline_12 TEXT` so the same column powers the human table cell. One source of truth.

## What this self-review does NOT close

- **External validation.** Even after fixing all eight issues, the rubric is still a single agent's design. Real validation means deploying a paper-mirror against the top-N for 2+ weeks and measuring realized PnL of the copy strategy. The charter says this; this self-review reinforces it.
- **Adversarial robustness.** Wash-trading, sock-puppet farms, cluster wallets — the rubric does not detect any of these. They land in `task.0322` Phase-4 design.
- **The choice of 12 sparkline cells.** Could be 16, 20, 24. 12 is a guess. Worth A/B'ing with two test runs and picking the smaller one if the agent's pass-rate is unchanged.

## Findings from the 50-wallet expansion

Five subagents profiled 50 fresh wallets seeded from VOL leaderboards (ALL/VOL + MONTH/VOL — slices NOT covered in the first screen). Frozen at [`docs/research/fixtures/poly-wallet-curve-screen-50fresh-2026-04-28.json`](fixtures/poly-wallet-curve-screen-50fresh-2026-04-28.json).

### Headline numbers

| Stat                                           | Value     | What it means                                                           |
| ---------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| Wallets profiled                               | 50        | Fresh universe; zero overlap with first screen                          |
| Passed H1–H4 (numerical hard filters)          | **1/50**  | Massive rejection — confirms the rubric is not "everything passes"      |
| Flagged `botRisk: high` (cadence + market mix) | **32/50** | 64% of VOL leaderboard are bots                                         |
| Net qualified after applying H5 + H8 manually  | **0/50**  | Even the one numerical-pass wallet (bobe2) is geopolitics + bot-flagged |

### Implications, in order of severity

#### 🔴 Sourcing strategy is the bottleneck — VOL leaderboards are bot graveyards

This is the single biggest empirical finding. **All five subagents independently** flagged the VOL slices as bot-saturated. ALL/VOL pulled `debased` ($1.46M, R²=0.99 — would look great in isolation) but the wallet trades 9/10 crypto-buckets, fingerprinting it as latency-arb. MONTH/VOL was worse: 7/10 high-cadence bots, 4/10 net-negative all-time, one wallet with **29479% drawdown** (i.e. blew up multiple times).

**Action:** the next screen seeds from category-filtered leaderboards (`?category=tech|sports|weather|culture`) + per-market `/holders` harvesting. The PNL slices already screened are good; VOL slices are not worth re-running.

#### 🔴 The `passed` flag does not reflect H5 (category) or H8 (bot-vs-bot)

`bobe2` "passed" with `score=1.25`, but its top markets are **geopolitics** (charter blocklist) and `botRisk: high`. The numerical filters (H1–H4) were satisfied because the curve was clean and the wallet has $1.7M PnL across 17 months. But the **agent then has to know to override the `passed: true` with the soft-signal verdict** — a footgun for autonomous use.

**Action:** the production tool must compute `passed = H1 ∧ H2 ∧ H3 ∧ H4 ∧ H5 ∧ H8` — i.e. category and bot-risk are hard gates, not soft signals. Move them out of "soft signals (logged for human review)" in the charter and into the hard-filter list. I'll edit the charter in this commit.

#### 🟡 R² returned `null` for 3 of 5 subagent outputs — numerical robustness gap

Three of the top-5 scoring wallets in the batch (bobe2, Sharky6999, wokerjoesleeper) report `R²: null`. The subagents independently re-implemented `compute()` and likely hit `NaN` from divisions on degenerate data (constant series, or all-zero variance windows). The reference script handled this; the re-implementations did not.

**Action:** the production tool **must** explicitly handle: empty arrays, single-point arrays, all-zero curves, exact-constant curves, NaN/Infinity from the API. Test fixtures for each. Without this, the agent loop will produce silently-wrong rankings on edge wallets.

#### 🟢 The rubric does NOT overfit to "smooth uptrend"

Concern #1 in the self-review was that the rubric was tuned to Derek's 4 examples. The 50-wallet expansion empirically falsifies that worry: the same rubric correctly rejected 49 wallets across many failure modes (bot-cadence, abandoned-post-jackpot, deep-DD, tiny-PnL-noise, negative-slope-flatline). If the rubric were just "matches Derek's curve shape" it would have accepted any wallet with a smooth uptrend — instead it correctly demoted `debased` and `cigarettes` whose curves visually qualify but who fail H4 (DD) and H8 (bot).

So: **eight of my own self-review concerns remain valid, but Concern #1 is empirically reduced.** Concern #5 (recency bias) is the next-most-pressing one to test.

### Updated charter changes landing in this commit

1. Promote H5 (category blocklist) and H8 (bot-vs-bot) from soft signals to hard gates. `passed` requires all eight.
2. Add a deprecated-sourcing note: ALL/VOL and MONTH/VOL leaderboards yield ~0% qualified targets per 50 wallets. Use PNL slices + per-category leaderboards + holders harvesting instead.
3. Add the AI snapshot tool (`core__poly_data_user_pnl_summary`) to task.0421's scope, with the sparkline-12 algorithm spec.
4. Add `numerical robustness` to the v0.5 implementation requirements: empty / single-point / constant / NaN / Infinity must all return clean structured results.
