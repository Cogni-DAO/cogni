---
id: chr.poly-wallet-research
type: charter
title: "Poly Wallet Research Charter"
state: Active
summary: "Canonical methodology for finding, profiling, and ranking Polymarket proxy-wallets the poly node should mirror. Defines the curve-shape-first ranking model (consistency over time > snapshot leaderboard PnL), the agent's discovery sequence over `core__poly_data_*` tools, and the gaps that need to close before this can become a fully-automated pipeline."
created: 2026-04-28
updated: 2026-04-28
---

# Poly Wallet Research Charter

> v0 — methodology lives here, in git. vNext — promotes to Doltgres knowledge (`knowledge_poly`) and is referenced inline on the `/research` page so humans + agents read the same source of truth.

## Goal

The poly node copies trades from external wallets. **Picking the right wallets is the single highest-leverage decision in the entire copy-trade pipeline** — every other piece (fill detection, signing, idempotency, execution) is mechanical once the target list is good. This charter defines what "right" means, in measurable terms, and the systematic process the agent runs to produce a ranked list.

## What "good" looks like — the curve-shape thesis

A copy-traded wallet is good if its **realized cumulative-PnL time-series curve** has all of:

1. **Smooth monotonic uptrend** over ≥ 3 months — the slope is positive across most subwindows, not a single jackpot followed by flat.
2. **Low max drawdown relative to peak** (≤ 25%) — losses are recoverable noise, not regime breaks.
3. **High activity in the most recent window** — last-7d trades ≥ 5, last-30d trades ≥ 50. Not abandoned.
4. **High total magnitude** — total realized PnL ≥ $500k. Below that, edge is statistically indistinguishable from variance even if win-rate looks great.
5. **Category in our copy-able allowlist** (see §Categories) and not in the regulatory-flagged blocklist.

Visual reference (the screenshots Derek used to anchor this charter):

| Pattern                                                            | Verdict  | Example                                      |
| ------------------------------------------------------------------ | -------- | -------------------------------------------- |
| Smooth +$6.5M curve over 8 months, low DD, still rising            | ✅ COPY  | `0x2005d16a84ceefa912d4e380cd32e7ff827875ea` |
| Smooth +$7.6M curve over 9 months, near-zero DD, exponential       | ✅ COPY  | `0x204f72f35326db932158cba6adff0b9a1da95e14` |
| Made profit, gave it all back over 6 months, recovering — choppy   | ❌ AVOID | `0xead152b855effa6b5b5837f53b24c0756830c76a` |
| Made $1M in two weeks then completely flat (no trades) for a month | ❌ AVOID | `0x59a0744db1f39ff3afccd175f80e6e8dfc239a09` |

The curve shape is the primary signal. Snapshot leaderboard PnL is the **noisiest** secondary signal — it captures unrealized P/L on open positions and rewards single-bet jackpots. Prior research ([`docs/research/polymarket-copy-trade-candidates.md`](../../docs/research/polymarket-copy-trade-candidates.md) Appendix C) demonstrated empirically that leaderboard ROI inverted on resolved-outcome data for a third of the shortlist.

## Measurable identifiers — the rubric

Every candidate gets scored on these dimensions. All thresholds are MVP defaults; tune as we accumulate real-money outcomes.

### Hard filters (any failure = reject)

| #   | Identifier                                         | Source                                                   | Threshold                       |
| --- | -------------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| H1  | Time-series exists with ≥ 90 days of data points   | `user-pnl-api.polymarket.com/user-pnl?interval=all`      | `monthsActive ≥ 3`              |
| H2  | Currently active                                   | `data-api/activity` last event timestamp                 | `daysSinceLastTrade ≤ 7`        |
| H3  | Total realized PnL                                 | last point of user-pnl `interval=all` series             | `≥ $500,000`                    |
| H4  | Max drawdown as % of peak equity                   | derived from user-pnl series (rolling-max minus current) | `≤ 25%`                         |
| H5  | Dominant category NOT in blocklist                 | top-3 markets from `data-api/activity` event slugs       | not crypto-5min / geo / insider |
| H6  | Not in Harvard 2026 flagged-wallet dataset (vNext) | static exclusion list                                    | absent                          |
| H7  | True win-rate on ≥ 30 resolved positions           | resolution-join (existing `wallet-screen-resolved.ts`)   | `≥ 52%`                         |
| H8  | Median trade dwell time                            | derived from `data-api/activity` BUY → SELL pairs        | `≥ 60 seconds` (anti-HFT)       |

### Ranking score (survivors only)

```
score = curveQuality × magnitudeFactor × livenessFactor × categoryBonus

curveQuality      = R²(linear fit of log(equity) vs time)        ∈ [0, 1]
magnitudeFactor   = sqrt(totalPnl_USD / 1_000_000)                ∈ [0, ~3]
livenessFactor    = min(1, trades_last_7d / 5)                    ∈ [0, 1]
categoryBonus     = { tech 1.2, weather 1.1, sports 1.0, finance 1.0, other 0.8 }
```

Top-N by `score` → the v0 mirror roster.

> **Calibration update (2026-04-28, post-50-fresh-screen):** H5 (category) and H8 (bot-vs-bot) are **hard filters**, not soft signals. The 50-wallet expansion exposed a wallet (`bobe2`) that satisfied H1–H4 numerically but trades geopolitics with bot-tier cadence. Without H5+H8 as hard gates, the score function would surface it as a top candidate. See [`poly-wallet-methodology-self-review.md`](../../docs/research/poly-wallet-methodology-self-review.md).

### Soft signals (not scored, but logged for human review)

- Longest contiguous up-month streak / total months active
- Monthly returns positive fraction
- BUY/SELL ratio (98/2 = buy-and-hold; 50/50 = active flow trader)
- Top-3 markets by USDC volume (input to H5 inference; the inference itself is a hard gate)
- USDC.e wallet balance vs. position notional (capital-stack inference)
- **AI sparkline (12 cells)** — fixed-length Unicode-block representation of the user-pnl curve, self-normalized to the wallet's own min/max. Powers both the human research-page row and the agent's at-a-glance ranking. Spec lives in `task.0421` after the post-50-fresh-screen update.

### Sourcing slices — empirical yields (post-2026-04-28 screen)

| Leaderboard slice                                                                        | Yield (qualified per ~50 wallets)              | Recommendation  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------- |
| ALL / MONTH / WEEK × **PNL**                                                             | ~13% (11 / 87)                                 | ✅ keep         |
| ALL / MONTH × **VOL**                                                                    | **~0% (0 / 50 net of category + bot filters)** | ❌ deprioritize |
| Category-filtered leaderboards (per `?category=tech\|sports\|weather\|culture\|finance`) | not yet measured                               | ⚪ next stage   |
| Per-market `/holders` harvest                                                            | not yet measured                               | ⚪ next stage   |

## Bot-vs-bot detection

A wallet that is itself an arbitrage bot trading against other bots leaves no copy-able edge for us. Reject any candidate where:

- Top-3 markets are all `BTC`/`ETH`/`SOL` 5-min or 15-min bucket markets.
- Median dwell time between matched BUY and SELL on the same `tokenId` is < 60 s.
- Trade cadence is > 100/day with median trade size > $1k (industrial-scale; sub-second decisioning).
- Round-trip PnL is positive but realized ROI per resolved market is < 0.5% (latency arb economics — high turnover, thin margins, requires same-block speed we cannot match with a 30-second poll).

These signals correctly excluded `JPMorgan101` (BTC 5-min) in the prior research even though its leaderboard stats looked elite.

## Category allowlist / blocklist

| Bucket                         | Verdict    | Rationale                                                                  |
| ------------------------------ | ---------- | -------------------------------------------------------------------------- |
| Sports (NBA, NFL, MLB, tennis) | ✅ allow   | Pinnacle-vs-Polymarket lag; retail-dominant book                           |
| Esports                        | ✅ allow   | Same edge thesis; thinner liquidity → size cap                             |
| Tech / consumer                | ✅ allow   | Best curve-quality wallets in v3 screen (`tourists`, `ProfessionalPunter`) |
| Daily weather                  | ✅ allow   | NOAA/ECMWF vs retail book; 24h resolution; copyable                        |
| Cricket / IPL                  | ✅ allow   | Non-US info asymmetry                                                      |
| Awards                         | ⚠️ caution | Slow turnover; satellite, not v0                                           |
| US elections                   | ⚠️ caution | Thesis trades, not flow; only mirror in active high-salience windows       |
| Crypto 5/15-min buckets        | ❌ block   | Latency arb; uncopyable                                                    |
| Geopolitics (insider)          | ❌ block   | Harvard 2026 flagged; congressional probe in flight                        |
| Reality TV                     | ❌ block   | Pre-tape spoiler insider trading                                           |
| FDA / M&A / SCOTUS             | ❌ block   | Schiff-Curtis bill targets these specifically                              |

## The agent's research process

End state: an autonomous agent runs this loop on a schedule (vNext) and writes the ranked roster into `knowledge_poly`. v0: a human invokes `poly-research` with a freeform prompt; the agent follows this sequence; output is reviewed before any wallet enters the mirror roster.

### Stage 1 — Seed the universe

```
∀ window ∈ {DAY, WEEK, MONTH, ALL}:
  ∀ orderBy ∈ {PNL, VOL}:
    candidates += core__wallet_top_traders({ timePeriod: window, orderBy, limit: 1000 })
```

Optional augmentation (vNext): per-category `/v1/leaderboard` and `/holders` harvest on top markets in each allowed category.

### Stage 2 — Cheap pre-filter

```
for each wallet in candidates:
  value = core__poly_data_value({ user })
  if value < $1_000:        drop
  pnl = core__poly_data_user_pnl({ user, interval: "all" })   ← TOOL GAP, see §Gaps
  metrics = computeCurveMetrics(pnl)
  if metrics.monthsActive < 3:           drop  (H1)
  if metrics.daysSinceLastTrade > 7:     drop  (H2)
  if metrics.totalPnl < 500_000:         drop  (H3)
  if metrics.maxDdPctOfPeak > 0.15:      drop  (H4)
```

This stage alone shrinks ~1500 → ~30.

### Stage 3 — Profile survivors

```
for each survivor:
  activity = core__poly_data_activity({ user, limit: 500 })
  category = inferDominantCategory(activity)              ← H5
  if category in BLOCKLIST:              drop
  resolved = resolutionJoin(activity)                     ← per wallet-screen-resolved.ts
  if resolved.winRate < 0.52 || resolved.n < 30:  drop    ← H7
  dwell = medianDwellTime(activity)
  if dwell < 60s:                        drop             ← H8 (bot-vs-bot)
```

### Stage 4 — Rank

```
for each profiled wallet:
  s = curveQuality × sqrt(totalPnl/1M) × livenessFactor × categoryBonus
sort desc by s
return top-N
```

### Stage 5 — Sanity check

- `core__web_search` for the wallet handle / address — flag any reporting hits.
- (vNext) Cross-reference Harvard 2026 flagged dataset.
- Human review before promotion to mirror roster.

## Tooling gaps

What our agent is missing today vs what this methodology requires:

| Gap                                                                                                                                                                                                                                                                                                                                          | Severity          | Fix                                                                                                                                                        | Where it lives            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ | --------- | --------- | ----------- | ---------- | ----------------------------------------------------------------- | ---------------------------- |
| **No `core__poly_data_user_pnl` tool.** The PnL time-series curve — the primary ranking signal in this charter — is invisible to the agent. The HTTP client (`PolymarketUserPnlClient`) exists in `packages/market-provider` and is used by the dashboard route, but is not exposed via the `core__poly_data_*` family.                      | 🔴 Blocking       | Wrap as a new `core__poly_data_user_pnl` tool in `nodes/poly/packages/ai-tools/src/tools/`. Mirror the contract pattern of the existing 7 poly-data tools. | task.0421 (filed below)   |
| **No `core__poly_data_pnl_curve_metrics` derived tool.** Even with raw curve points, the agent has no canonical reducer for `{ totalPnl, maxDrawdown, maxDdPctOfPeak, monthsActive, daysSinceLastTrade, slopeR², longestUpStreak, monthlyReturnPositiveFraction }`. Forcing the LLM to compute these inline is error-prone and burns tokens. | 🟡 High           | Pure-function reducer in `packages/market-provider/src/analysis/pnl-curve-metrics.ts`, exposed as a stateless tool. Same pattern as `wallet-metrics.ts`.   | task.0417 (same)          |
| **No bot-vs-bot detector.** `medianDwellTime`, top-market category sniff, sub-block-cadence detection are not encoded anywhere.                                                                                                                                                                                                              | 🟡 High           | Add to the same `pnl-curve-metrics` module or a sibling `bot-vs-bot.ts`.                                                                                   | task.0417 (same)          |
| **No category-filtered leaderboard tool.** Current `core__wallet_top_traders` hits only the uncategorized leaderboard (~1000 cap). The category-filtered endpoint exists ([docs](https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings)) and would 10× the discovery universe.                                      | 🟢 Medium         | Add `category?: 'sports'                                                                                                                                   | 'crypto'                  | 'tech' | 'weather' | 'culture' | 'economics' | 'politics' | 'finance'`param to the existing`core\_\_wallet_top_traders` tool. | task.0421 stretch / new task |
| **No persistent ranked roster.** Each agent run re-derives the ranking from scratch; no Doltgres knowledge table to read prior conclusions or diff against today.                                                                                                                                                                            | 🟢 Medium (vNext) | New `knowledge_poly.poly_wallet_rankings` table; `poly-research` graph writes via `core__knowledge_write`. Surface on `/research` via existing pattern.    | follow-up after task.0417 |
| **No Harvard flagged-wallet exclusion gate.** Static dataset exists; not loaded into the screening pipeline.                                                                                                                                                                                                                                 | 🟢 Medium (vNext) | Vendored CSV in `nodes/poly/packages/knowledge/seeds/`; cross-check at Stage 5.                                                                            | follow-up                 |

The single highest-leverage fix is `core__poly_data_user_pnl` + the curve-metrics reducer. **Until those ship, the agent can name candidates but cannot evaluate them on the charter's primary criterion.**

## Invariants

- **Curve shape is the primary signal**, not snapshot PnL. Any future ranker that downgrades curve quality below leaderboard rank violates this charter.
- **Resolved-outcome win-rate is the only acceptable win-rate.** Mark-to-market on open positions is a known false-positive driver (see prior research §Recommendation).
- **Category allowlist + blocklist are non-negotiable.** A wallet with a perfect curve trading insider geopolitics is a regulatory liability, not an opportunity.
- **Bot-vs-bot detection runs before ranking, not after.** Latency-arb wallets must never enter the score function — they pollute the distribution.
- **No wallet enters the mirror roster without human review** until 2 weeks of paper-trade outcomes back the methodology.

## v0 → vNext path

| Phase        | Where the methodology lives                                            | Where the ranked roster lives         | Trigger                         |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------- | ------------------------------- |
| **v0** (now) | this charter                                                           | manual, in conversation transcripts   | human invokes `poly-research`   |
| v0.5         | this charter + `task.0417` ships the user-pnl tool + curve metrics     | structured `PolyResearchReport` JSON  | human invokes `poly-research`   |
| vNext        | this charter (rules) + `knowledge_poly.poly_wallet_methodology` (data) | `knowledge_poly.poly_wallet_rankings` | scheduled `poly-research` run   |
| vNext+       | charter unchanged; surfaced inline on `/research`                      | live-rendered from `knowledge_poly`   | autonomous loop with human gate |

## Projects

| Project                                                               | Status | Description                                                                                  |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| [`proj.poly-copy-trading`](../projects/proj.poly-copy-trading.md)     | Active | Mirror pipeline that consumes the ranked roster this charter produces.                       |
| [`proj.poly-prediction-bot`](../projects/proj.poly-prediction-bot.md) | Active | Run-phase "follow-a-wallet" deliverable; prior research lives here.                          |
| [`task.0421`](../items/task.0421.poly-wallet-curve-metrics-tools.md)  | Filed  | Closes the highest-leverage tooling gap: `core__poly_data_user_pnl` + curve-metrics reducer. |

## Constraints

- **Polymarket Data API rate limits** are Cloudflare-shaped at ~60 rpm per IP; bursts silently throttled. Caps the discovery universe per run.
- **`/v1/leaderboard` offset cap of 1000** — uncategorized leaderboard misses long-tail wallets. Holders-based discovery + category-filtered leaderboards exist but are not yet wrapped as agent tools.
- **Resolution data is incomplete** — `clob.polymarket.com/markets/{cid}` only resolves ~21% of markets in a single pass before rate limits kick in. Realized-PnL math is bounded by this coverage.
- **No persistent ranked roster** in v0 — every agent run re-derives ranking from scratch. Promotion to Doltgres is gated on this charter being validated against 2 weeks of paper-mirror outcomes.
- **No autonomous mirror promotion** — every wallet entering the live mirror roster requires human review until the methodology has positive-PnL paper-trade telemetry behind it.
- **Regulatory tail risk** is structural, not technical — the blocklist categories (geopolitics-insider, FDA/M&A/SCOTUS, reality-TV) cannot be relaxed even if the curve looks clean.

## Pointers

- Prior research, full multi-pass screen results: [`docs/research/polymarket-copy-trade-candidates.md`](../../docs/research/polymarket-copy-trade-candidates.md)
- Reusable wallet-analysis components + data plane: [`docs/design/wallet-analysis-components.md`](../../docs/design/wallet-analysis-components.md)
- Existing agent graph: [`nodes/poly/graphs/src/graphs/poly-research/`](../../nodes/poly/graphs/src/graphs/poly-research/)
- Existing data tools: [`nodes/poly/packages/ai-tools/src/tools/poly-data-*.ts`](../../nodes/poly/packages/ai-tools/src/tools/)
- The HTTP client that needs to be agent-exposed: [`packages/market-provider/src/adapters/polymarket/polymarket.user-pnl.client.ts`](../../packages/market-provider/src/adapters/polymarket/polymarket.user-pnl.client.ts)
- Resolution-join screen script (Stage-3 reference impl): [`scripts/experiments/wallet-screen-resolved.ts`](../../scripts/experiments/wallet-screen-resolved.ts)
- Project roadmap: [`work/projects/proj.poly-copy-trading.md`](../projects/proj.poly-copy-trading.md), [`work/projects/proj.poly-prediction-bot.md`](../projects/proj.poly-prediction-bot.md)
- Follow-up implementation task: [`task.0421`](../items/task.0421.poly-wallet-curve-metrics-tools.md)
- First live screen + Dolt schema proposal: [`docs/research/poly-wallet-curve-screen-2026-04-28.md`](../../docs/research/poly-wallet-curve-screen-2026-04-28.md)
