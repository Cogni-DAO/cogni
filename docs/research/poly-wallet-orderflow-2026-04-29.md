---
id: research-poly-wallet-orderflow-2026-04-29
type: research
title: "Poly Top-2 Wallet Order-Flow Style — 2026-04-29"
status: active
trust: reviewed
summary: "First per-trade behavioural read on the top-2 wallets from the 2026-04-28 curve screen (RN1, swisstony). Both are pure ride-to-resolution traders — 0 SELL trades in 1000 most recent fills, 500+ REDEEM events apiece. Layered intra-event DCA (<4hr windows), broad price-band coverage, never multi-day swing. Confirms our redeem pipeline is structurally aligned (chain-driven on `ConditionResolution`, not target-driven). Surfaces the distribution shapes — DCA depth, event clustering, trade-size, entry-price, time-of-day — that the wallet-research deep-dive should visualise."
read_when: Designing the wallet deep-dive UI; deciding mirror-sizing policy; characterising target-wallet style before promotion to the mirror roster; auditing whether our close-position logic mirrors target behaviour.
owner: derekg1729
created: 2026-04-29
verified: 2026-04-29
tags:
  [
    knowledge-chunk,
    polymarket,
    poly-node,
    copy-trading,
    wallet-research,
    order-flow,
    distributions,
  ]
---

# Poly Top-2 Wallet Order-Flow Style — 2026-04-29

> source: Polymarket Data-API `/trades` + `/activity?type=REDEEM`, public endpoints, no auth | confidence: high (live data, deterministic re-run) | freshness: 24-48h window only — see "Time-frame caveat" below

## Question

For the two top-ranked target wallets from the [2026-04-28 curve screen](poly-wallet-curve-screen-2026-04-28.md) — RN1 (`0x2005d16a84…`, $7.68M, rank #1) and swisstony (`0x204f72f353…`, $6.56M, rank #2) —

1. What is their open/close style? Do they ride positions to resolution or close on highs?
2. Does our copy-trade pipeline mirror their close behaviour? Specifically: do we mirror CLOB SELL fills, and do we redeem on resolution like they do?
3. What does their **order-flow distribution** look like (DCA depth, multi-market clustering, trade-size, entry price, time-of-day)?

## Method

1. **Trades.** `GET data-api.polymarket.com/trades?user=<proxy>&limit=1000` per wallet. Default `limit=1000` returns full BUY+SELL history, taker AND maker fills (no `takerOnly` flag).
2. **Redemptions.** `GET data-api.polymarket.com/activity?user=<proxy>&type=REDEEM&limit=500` per wallet — confirms whether the wallet rides to resolution.
3. **Per-position lifecycle.** Group trades by `(conditionId, outcome)`. Classify each group as `closed-fully` (sells ≥ buys), `partial-close`, or `held-open / rode-to-resolution` (zero sells).
4. **Distributions.** Six histograms per wallet — DCA depth, event clustering, trade-size USDC, entry price, DCA window (first→last trade gap), time-of-day.

Source code: the two read-only probes that produced this data live as ad-hoc scripts in the local research worktree. Once `summariseOrderFlow` lands (task.0429), the same six distributions are computable on-demand via `GET /api/v1/poly/wallets/<addr>?include=distributions` for any 0x address. To reproduce against fresh data, hit the live route.

## Headline finding — pure ride-to-resolution

| metric | RN1 (#1) | swisstony (#2) |
| --- | ---: | ---: |
| `/trades` rows fetched | 1000 | 1000 |
| BUY trades | **1000** | **1000** |
| SELL trades | **0** | **0** |
| BUY notional | $343k | $137k |
| (cond, outcome) groups | 246 | 216 |
| fully-closed via CLOB SELL | **0 (0.0%)** | **0 (0.0%)** |
| held to resolution / open | **246 (100%)** | **216 (100%)** |
| REDEEM events | 500+ | 500+ |
| REDEEM USDC claimed | $2.28M | $580k |

> Both `/trades` and `/activity?REDEEM` page-cap at 1000 / 500 respectively. Total all-time counts are larger; the style read still holds — zero SELLs in the recency window.

**Implication.** They never realise on-CLOB. They get edge at entry, hold to resolution, redeem winning CTF tokens for USDC. Their high R² / low DD curve is a **consequence of style**, not of trade management. There is no "close on highs" or "trailing-stop" alpha for us to copy — the alpha is at entry.

## Do we mirror their closes?

The "close" question splits cleanly in two:

| their action | our path | mirrored? |
| --- | --- | --- |
| CLOB SELL fill | `wallet-watch` → `planMirrorFromFill` → `clob-executor` SELL | ✅ **Yes, automatically** — planner is side-agnostic; any observed SELL produces a mirror SELL intent. Empirically **never triggers** for these two targets. |
| Hold to resolution → REDEEM CTF | Independent `features/redeem` pipeline (subscribes to CTF / NegRiskAdapter `ConditionResolution` on-chain, multicalls Capability A `decideRedeem`, redeems funder's winning positions) | ✅ **Convergent, not mirrored** — we trigger off the same on-chain `ConditionResolution` event they do, not off their `/activity?REDEEM` rows. End state: both sides redeem at chain finality (N=5). |

So no behavioural gap for these targets. We are aligned by construction:

- Mirror planner ([`features/copy-trade/plan-mirror.ts`](../../nodes/poly/app/src/features/copy-trade/plan-mirror.ts)) is BUY/SELL-agnostic.
- Redemption ([`features/redeem`](../../nodes/poly/app/src/features/redeem/AGENTS.md)) is bespoke and chain-driven, not target-driven. This is correct: their redeem is also chain-driven (or auto-redeemed by their proxy), so observing target REDEEM activity to trigger ours would only add latency vs. the chain event we already subscribe to.

### Latent risk

- [bug.0329](../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) still latent — if any future target ever SELLs on a `neg_risk=true` market, our mirror would reject for missing CTF `setApprovalForAll` on NegRiskAdapter. Low risk for these two targets (they don't SELL at all), but worth landing the fix in `poly-auth-wallets` before roster expansion.

## Order-flow distributions

> ASCII histograms below. Source bucket data preserved in this doc — if the source script regresses we can still recompute from the persisted curves. Once the [wallet deep-dive design](../design/wallet-analysis-components.md) lands the `distributions` slice, these become live recharts components.

### RN1 (`0x2005d16a84…`) — n=1000 over 2 days

#### DCA depth — trades per `(market, outcome)` group

```
  1-1 |   87 ████████████████████████████████████████   ← single-shot
  2-2 |   41 ███████████████████
  3-4 |   48 ██████████████████████
  5-9 |   51 ███████████████████████
10-19 |   19 █████████
20-49 |    2 █                                           ← max 37 trades on one outcome
```

**248 unique (market, outcome) groups, p50=2, p90=9.** They DCA hard: ~65% of positions get ≥2 entries, 20%+ get ≥5.

#### Multi-market clustering — trades per parent event

```
  1-1 |   18 ██████████████████████████████
  2-2 |   15 █████████████████████████
  3-4 |   15 █████████████████████████
  5-9 |   22 █████████████████████████████████████
10-19 |   24 ████████████████████████████████████████
20-49 |   11 ██████████████████
50-99 |    2 ███
```

**107 events, p50=5, p90=21.** Most events get multiple bets across sub-markets (moneyline + spread + O/U + props). Top events: Madrid Open (71 trades), Ducks/Oilers O/U 5.5 (53), Wild/Stars (39).

#### Trade size — USDC notional (log buckets)

```
       $0-10 | 377 ████████████████████████████████████████   ← 38% are dust
      $10-50 | 209 ██████████████████████
     $50-100 | 109 ████████████
    $100-500 | 148 ████████████████
   $500-1000 |  63 ███████
  $1000-5000 |  87 █████████
 $5000-10000 |   5 █
       ≥$10k |   2                                            ← max $37k
```

**p50=$28, p90=$978, max $37k.** Bimodal-leaning: dust probes alongside a long 4-figure conviction tail.

#### Entry price (probability)

```
0.00-0.05 |  30 ███████
0.05-0.15 |  74 ██████████████████
0.15-0.30 | 136 █████████████████████████████████
0.30-0.45 | 166 ████████████████████████████████████████   ← peak just below 50/50
0.45-0.55 | 135 █████████████████████████████████
0.55-0.70 | 132 ████████████████████████████████
0.70-0.85 | 153 █████████████████████████████████████
0.85-0.95 | 121 █████████████████████████████
0.95-1.00 |  53 █████████████                              ← locks
```

**p50=0.51 (basically uniform).** Broad coverage 0.15–0.95. Notable cluster at locks (0.95+) ⇒ likely arbitrage / settle-late entries.

#### DCA window — first→last trade per group

```
  0-1 min |  11 ██████
  1-5 min |  11 ██████
 5-30 min |  36 ████████████████████
30-60 min |  30 ████████████████
   1-4 hr |  73 ████████████████████████████████████████   ← dominant DCA shape
  4-24 hr |   0
```

**p50=53 min, p90=121 min, all <4 hr.** Intra-event accumulation; never multi-day swing.

#### Hour-of-day (UTC)

```
00:00 | ████████████████████████████████████████   peak
17–20 | ████████████████████████████████           secondary peak
06–11 | (mostly silent)                            quiet window
```

Two clusters — late-evening US (00 UTC = 8pm ET, US sports primetime) and afternoon (17–20 UTC = European football late afternoon).

### swisstony (`0x204f72f353…`) — n=1000 over 1 day

#### DCA depth

```
  1-1 | 102 ████████████████████████████████████████
  2-2 |  33 █████████████
  3-4 |  38 ███████████████
  5-9 |  31 ████████████
10-19 |  20 ████████
20-49 |   9 ████                                         ← max 45
```

**233 groups, p50=2, p90=11.** Slightly heavier single-shot share than RN1, longer DCA tail.

#### Multi-market clustering

```
  1-1 |  25 ████████████████████████████████████████
  2-2 |  10 ████████████████
  3-4 |  15 ████████████████████████
  5-9 |  14 ██████████████████████
10-19 |  12 ███████████████████
20-49 |   9 ██████████████
50-99 |   4 ██████
 ≥100 |   1 ██                                           ← Trail Blazers/Spurs O/U 214.5: 166 trades
```

**90 events, p50=4, p90=26.** Heavier event-concentration than RN1 — single events with 100+ trades show willingness to absorb tonnage on one line.

#### Trade size — USDC notional

```
       $0-10 | 351 ████████████████████████████████████████
      $10-50 | 295 ██████████████████████████████████
     $50-100 |  95 ███████████
    $100-500 | 211 ████████████████████████
   $500-1000 |  31 ████
  $1000-5000 |  17 ██
```

**p50=$26, p90=$315, max $3.9k.** Smaller per-trade size than RN1 — more numerous, smaller orders.

#### Entry price (probability)

```
0.30-0.45 | 227 ████████████████████████████████████████   ← clear peak
0.55-0.70 | 150 ██████████████████████████
0.70-0.85 | 162 █████████████████████████████
0.85-0.95 |  74 █████████████
```

**p50=0.51, p90=0.88.** Concentrated 0.30–0.85 band; fewer locks and fewer deep dogs than RN1.

#### DCA window

```
  0-1 min |  29 ████████████████████████████
  1-5 min |  13 ████████████
 5-30 min |  32 ██████████████████████████████
30-60 min |  15 ██████████████
   1-4 hr |  42 ████████████████████████████████████████   ← dominant
  4-24 hr |   0
```

**p50=16 min, p90=108 min.** Faster DCA cadence than RN1 (shorter median); same structural <4h ceiling.

#### Hour-of-day (UTC)

```
02:00 | ██████████████████████████████████
03:00 | ████████████████████████████████████████   peak
04:00 | ███████████████████
05:00 | ████████████████████████████████
06–01 | (silent)
```

**Single 02–05 UTC window** = European afternoon / Asian late-night. Tightly time-boxed style.

## Style summary

| dimension | RN1 | swisstony |
| --- | --- | --- |
| trade frequency | ~500/day | ~1000/day |
| DCA depth (p90) | 9 entries / outcome | 11 entries / outcome |
| event concentration (max) | 71 trades | **166 trades** |
| trade size median | $28 | $26 |
| trade size p90 | **$978** | $315 |
| DCA window p90 | 121 min | 108 min — both **<4h** |
| price preference | uniform 0.15–0.95 | concentrated 0.30–0.85 |
| active hours UTC | 17–01 + 09–11 (broad) | 02–05 (single window) |

**Common pattern.** Intra-event DCA traders. Layer entries across <4hr around event start, multiple sub-markets per event (moneyline + spread + O/U), never hold multi-day, never close on CLOB → ride to resolution → redeem. Their alpha is **price discovery during the pre-event hours**, not direction-picking days in advance.

## Time-frame caveat

The 1000-row `/trades` page covers **only ~1-2 days** for both wallets given their high frequency:

| wallet | n trades | first | last | span |
| --- | ---: | --- | --- | ---: |
| RN1 | 1000 | 2026-04-28 | 2026-04-29 | ~2 days |
| swisstony | 1000 | 2026-04-29 | 2026-04-29 | ~1 day |

This is a **right-now order-flow snapshot**, not a longitudinal portrait. The charter ranking ($7.68M / $6.56M cumulative over 9.8 / 8.7 months) is correctly built from the user-pnl curve API; per-trade distributions only resolve a 24-48h window.

**Backfill ceiling.** Polymarket caps `/trades` at ~10k rows. For a 1000-trades/day wallet that's ~10 days max. Beyond that, the only ground truth is on-chain CTF transfer logs (Polygonscan `getLogs` on the CTF + NegRiskAdapter contracts).

## Implications for our pipeline

1. **Sizing.** RN1 fires $0.09 dust orders alongside $37k conviction shots. Our `mirror_usdc` cap collapses both to one fixed notional — we can't distinguish "scratch" from "loaded gun" without a tiered sizing policy. v1+ design problem, not a v0 bug.
2. **Close logic alignment confirmed.** Our event-driven redeem pipeline + side-agnostic mirror planner already covers the top-2 targets' style. No bespoke close logic to write.
3. **Coverage gap.** Mirror sizing math should be revisited only after we have ≥30-day history per target — not the current 1-2 days — to pick a tier policy that doesn't over-fit recent regime.
4. **bug.0329.** Land neg-risk SELL approvals before broadening the roster.

## Next steps (no preemptive decomposition)

1. **Bake distributions into the wallet deep-dive UI** — see [`docs/design/wallet-analysis-components.md`](../design/wallet-analysis-components.md) `distributions` slice extension (this doc's sibling landing).
2. **Persist target fills.** Doltgres `poly_target_fills` raw store + nightly delta + on-chain backfill. File when we want to lift the 10k API ceiling for longitudinal study. Sketch already in [`poly-wallet-curve-screen-2026-04-28.md` § Proposed Dolt schema](poly-wallet-curve-screen-2026-04-28.md#proposed-dolt-knowledge-schema).
3. **Re-run distributions weekly.** Once persistence lands; cheap until we have many roster wallets.

## Pointers

- Live API replacement (task.0429): `GET /api/v1/poly/wallets/<addr>?include=distributions` — same six distributions, on-demand for any 0x address.
- Curve-shape screen (parent): [`poly-wallet-curve-screen-2026-04-28.md`](poly-wallet-curve-screen-2026-04-28.md)
- Charter (methodology): [`work/charters/POLY_WALLET_RESEARCH.md`](../../work/charters/POLY_WALLET_RESEARCH.md)
- Wallet deep-dive design: [`docs/design/wallet-analysis-components.md`](../design/wallet-analysis-components.md)
- Mirror planner (BUY/SELL-agnostic): [`nodes/poly/app/src/features/copy-trade/plan-mirror.ts`](../../nodes/poly/app/src/features/copy-trade/plan-mirror.ts)
- Redeem pipeline (chain-driven, bespoke): [`nodes/poly/app/src/features/redeem/AGENTS.md`](../../nodes/poly/app/src/features/redeem/AGENTS.md)
