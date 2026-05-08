---
name: delta-minimizer
description: "Drive |Δ| (variance from copy-target positions) on the Polymarket dashboard toward zero by classifying high-|Δ| markets into a fixed taxonomy of mirror-loop failure modes, emitting an actionable scorecard, and filing follow-up work items for unattributed patterns. Use this skill whenever the user asks to 'minimize delta', 'rank copy-trade gaps', 'why is our delta high', 'optimize tracking error', 'loop the delta study', or runs '/delta-minimizer' (with or without a time window). Also use when the user asks how close we are to RN1's or swisstony's compounding rate, or wants the failure-mode matrix updated. The skill is the executable wrapper around the goal contract — ideal mean |Δ| under 1%, target under 10%; anything else needs a named root cause and a tracked work item."
---

# Δ-Minimizer

Variance from a tracked copy-target's positions is alpha leaking. Per-position |Δ| = |our*share% − target_share%| of total market position. Average |Δ| = 0 ⇒ we ride their compounding rate (modulo absolute capital). Today we don't — and the dashboard surfaces per-market Δ but not a \_systemic* read on dispersion or its causes.

This skill is the loop that closes that gap.

## Goal contract

| State         | Mean \|Δ\| | Action                                                                  |
| ------------- | ---------- | ----------------------------------------------------------------------- |
| 🟢 ideal      | < 1%       | continue; surface what's working                                        |
| 🟡 acceptable | 1–10%      | classify outliers; file targeted bugs                                   |
| 🔴 broken     | > 10%      | mean is dominated by a systemic failure mode — find it, file it, fix it |

The goal is not to eliminate variance entirely — capital constraint guarantees we miss bets the target makes. The goal is **every non-zero |Δ| has a named cause we are working on**.

### VWAP-floor invariant (load-bearing)

|Δ| minimization is the headline metric, but it has one explicit exception: **never close |Δ| by paying worse VWAP than the target's average fill price.** A cancel-and-replace (or a fresh layer) that would worsen our VWAP vs the target's avg fill on this (token, side) by more than 0.5pp is classified `vwap_floor_held`, not recommended for action, and counted toward the goal-contract denominator as legitimate residual variance. Capital scarcity (`capital_constrained`) and one-sided books (`orderbook_one_side`) stay dominant explanations _before_ execution-quality regression. We do not chase. The headline goal is "|Δ| → 0 _given_ same-or-better VWAP than target." If the only path to |Δ|=0 is to lift offers past the target's entry, the headline goal has been met to the floor; further closure would be alpha leakage of a different shape.

## When to load

- User runs `/delta-minimizer` (with or without a window)
- User asks anything about delta, tracking error, copy-trade variance, why we under/over-perform a target
- `/loop /delta-minimizer 6h` (or any cadence) — recurring research mode
- User asks to update the failure-mode matrix or the scorecard
- Reviewing why mean |Δ| moved between two snapshots

## The failure-mode taxonomy (v0)

Every high-|Δ| market is bucketed into exactly one of these. The taxonomy is the load-bearing artifact: bugs are filed against the buckets, not against individual markets.

| Bucket                    | Detection signal                                                                                            | Action class                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `capital_constrained`     | target's mirrored size > our remaining bankroll for that target                                             | by-design (we don't have their bank)                               |
| `position_cap_reached`    | `poly_copy_trade_decisions.reason='position_cap_reached'` for that (target, market)                         | tune cap upward if persistent                                      |
| `already_resting_in_band` | `reason='already_resting'` AND new intent's price is within ±3pp of resting                                 | by-design (post-bug.5035 — same-band skip is intentional)          |
| `cancel_failed`           | `reason='cancel_failed'` (post-bug.5035 cancel-replace path threw)                                          | active bug if rate climbing                                        |
| `mirror.dropped`          | target fill in `poly_trader_fills` with no decision row in `poly_copy_trade_decisions` for the same fill_id | bug.5032 territory — file follow-up if seen                        |
| `latency_skipped`         | decision recorded, but target's market price moved ≥3pp between target fill and our place                   | spike — measure latency distribution                               |
| `liquidity_capped`        | order placed but `filled_size_usdc < size_usdc` and the orderbook on our side was thin                      | spike — escalation candidate                                       |
| `orderbook_one_side`      | our side of the binary has ~zero depth at target's price (neg-risk markets)                                 | research — known structural issue                                  |
| `vwap_floor_held`         | closing the gap requires paying ≥0.5pp worse VWAP than target's avg fill on this (token, side)              | by-design (VWAP-floor invariant)                                   |
| `unattributed`            | doesn't match any of the above                                                                              | **always file a `spike.NNNN`** so the bucket gets a name next loop |

`unattributed` is the safety valve. Anything that lands here means the taxonomy is incomplete and a human needs to look. The skill files the spike automatically and includes the market id + reason patterns observed.

## The loop

### Step 1 — Snapshot dispersion

Read the live |Δ| distribution off the dashboard's data source:

```bash
source .env.cogni
curl -sf -H "Authorization: Bearer $COGNI_API_KEY_PROD" \
  "https://poly.cognidao.org/api/v1/poly/wallet/execution" \
  | jq '.marketGroups | map(select(.status=="live") | .edgeGapPct) | map(select(. != null) | (. * 100) | fabs)'
```

Compute: `mean`, `median`, `p90`, `p99`, `count_under_1pct`, `count_under_10pct`. The histogram component (`MarketsDeltaDistribution.tsx`) renders these on the dashboard already; this step is the agent-readable mirror.

### Step 2 — Identify outliers

Top-K markets by |Δ| (default K=10). For each, capture: `groupKey`, `eventTitle`, `ourValueUsdc`, `targetValueUsdc`, `edgeGapPct`, `pnlUsd`. These are the rows the rest of the loop investigates.

### Step 3 — Classify each outlier

For each outlier market, run the detection signals from the taxonomy. The order matters — first match wins:

1. `mirror.dropped` first (most damaging — silent data loss).
2. `cancel_failed` (active bug class — never let this hide).
3. `position_cap_reached` (configurable, common cause).
4. `latency_skipped` (subtle, easy to mis-bucket).
5. `liquidity_capped` / `orderbook_one_side` (structural).
6. `already_resting_in_band` (by-design, last because it's a fallback explanation).
7. `capital_constrained` (the residual — explains everything else if no signal matched but our share is just smaller).
8. `unattributed` (must-file).

The decisions table is reachable via the operator API today **only** through the order-ledger view (`/api/v1/poly/copy-trade/orders`). The decisions table itself is not yet exposed; for now, classifications that need the decisions table fall back to `unattributed` with a note. **Filing `task` to expose `/api/v1/poly/research/decisions/<market_id>` is in scope of any first run that hits this gap.**

### Step 4 — Emit the scorecard

The scorecard format is locked. Every run posts the same shape so deltas-of-deltas are mechanical:

```markdown
## /delta-minimizer · <ISO-timestamp> · 🟢 IDEAL | 🟡 ACCEPTABLE | 🔴 BROKEN

| METRIC       | VALUE          | GOAL  |
| ------------ | -------------- | ----- |
| mean \|Δ\|   | X.X%           | < 1%  |
| median \|Δ\| | X.X%           | < 1%  |
| p90 \|Δ\|    | X.X%           | < 10% |
| markets <1%  | N / TOTAL (P%) | ≥ 80% |
| markets <10% | N / TOTAL (P%) | ≥ 95% |

FAILURE-MODE MATRIX

| BUCKET                  | COUNT | Σ\|Δ\| pp | Δ vs prev run | STATUS / WORK ITEM          |
| ----------------------- | ----- | --------- | ------------- | --------------------------- |
| mirror.dropped          | N     | X.X       | +/- N         | active bug.5032 / 🔴 active |
| cancel_failed           | N     | X.X       | +/- N         | post-bug.5035 / 🟡 watching |
| position_cap_reached    | N     | X.X       | +/- N         | task.NNNN tune / 🟡 active  |
| latency_skipped         | N     | X.X       | +/- N         | spike.NNNN / 🟡 measuring   |
| liquidity_capped        | N     | X.X       | +/- N         | structural / 🟢 known       |
| orderbook_one_side      | N     | X.X       | +/- N         | structural / 🟢 known       |
| already_resting_in_band | N     | X.X       | +/- N         | by-design / —               |
| capital_constrained     | N     | X.X       | +/- N         | by-design / —               |
| unattributed            | N     | X.X       | +/- N         | spike.NNNN filed / 🔴 new   |

TOP OUTLIERS

| MARKET             | OUR $ | TGT $ | \|Δ\| | BUCKET   |
| ------------------ | ----- | ----- | ----- | -------- |
| <eventTitle short> | $X    | $Y    | X.X%  | <bucket> |

...

NEXT ACTIONS <bullet list, max 3 — what changes in the codebase, with item refs>
```

The verdict in the heading:

- 🟢 IDEAL: mean < 1% AND no `unattributed` AND no 🔴 active buckets
- 🔴 BROKEN: mean > 10% OR any new `unattributed` OR a bucket trending sharply up
- 🟡 ACCEPTABLE: anything in between

### Step 5 — File follow-ups

For every `unattributed` outlier, file a spike via the operator API. Do not batch — one spike per distinct unattributed pattern is fine, but never let a market sit unattributed across two consecutive runs:

```bash
source .env.cogni
curl -sf -X POST "https://cognidao.org/api/v1/work/items" \
  -H "Authorization: Bearer $COGNI_API_KEY_PROD" \
  -H "content-type: application/json" \
  -d '{
    "type":"spike",
    "title":"poly: |Δ| outlier on <eventTitle> — unattributed",
    "node":"poly",
    "summary":"<market_id> currently |Δ|=<X>% with our $<Y> vs target $<Z>. Decision-table signals don't match any taxonomy bucket. Investigate."
  }'
```

For active buckets that are climbing, PATCH a heartbeat note onto the existing tracking item rather than filing a new one (anti-sprawl per the `/contribute-to-cogni` contract).

### Step 6 — Persist (markdown today; knowledge `entry_type='scorecard'` very soon)

The persistence target has been picked: per-node Doltgres `knowledge` table, `domain='poly_delta_minimizer'`, `entry_type='scorecard'`. The internal HTTP wrapper (`/api/v1/poly/knowledge/...` against `core__knowledge_write`) lands with PR #1133 / #1143 (knowledge-contribution-API) + PR #1175 (corpus-as-knowledge: `work_item_artifacts` join from scorecards → work items).

**Until that ships, persistence is markdown on disk** — write each tick's scorecard to `docs/research/<ISO-date>-delta-minimizer.md`. Format already matches the future row shape so the bulk importer (PR #1144) can lift the corpus mechanically; see `data-research` skill §"Persisting research as knowledge" for the field mapping.

```bash
# v0 — write to disk
SCORECARD_PATH="docs/research/$(date -u +%Y-%m-%dT%H%MZ)-delta-minimizer.md"
echo "$SCORECARD_MD" > "$SCORECARD_PATH"
git add "$SCORECARD_PATH" && git commit -m "research(delta-minimizer): scorecard $(date -u +%Y-%m-%dT%H%MZ)" || true

# v1 (post PR #1133) — write to knowledge plane
# curl -sS -X POST "https://poly.cognidao.org/api/v1/poly/knowledge/write" \
#   -H "Authorization: Bearer $COGNI_API_KEY_PROD" \
#   -d '{"domain":"poly_delta_minimizer","entryType":"scorecard","title":"...","content":"...","tags":["scorecard","ts:..."],"workItemRefs":["bug.5032","bug.5035"]}'
```

The Δ-vs-prev-run column comes from the prior scorecard. v0 reads it via `ls -t docs/research/*-delta-minimizer.md | head -2 | tail -1`. v1 reads via `core__knowledge_search` ordered by `created_at desc`.

**Strategy promotion (rules):** when a bucket's count is flat-or-shrinking across the last 3 scorecards AND the bucket is owned by an active work item, write a new `entry_type='rule'` markdown alongside the scorecard at `docs/research/rules/<bucket>.md`, citing the 3 supporting scorecards and the resolved work item. v1: same as `entry_type='rule'` knowledge row at `confidence_pct` 60+. Each promotion is a separate file (or row) with a `supersedes` link to the prior version — never overwrite, never delete.

**Findings (root-cause memos):** when an `unattributed` spike resolves into a fix, write `docs/research/findings/<spike_id>.md` citing the spike + the merged PR + the first scorecard where the bucket dropped to zero. v1 = `entry_type='finding'` knowledge row.

## Cost discipline

- One `/wallet/execution` GET per run (already cached server-side).
- One `/copy-trade/orders` GET per outlier classified (≤K = 10 calls).
- Operator-API writes are bounded by `unattributed` count — never auto-file more than 5 spikes per run without human confirmation.
- LLM cost: the loop is pure shell + jq + simple arithmetic. No LLM calls required for classification at v0; the failure-mode taxonomy is deterministic. Reserve LLM cycles for `unattributed` triage only.

## Anti-patterns

- **Don't compute |Δ| from upstream.** Read `wallet/execution` only — it's already aggregated server-side per `PAGE_LOAD_DB_ONLY` (data-research skill). Do not add a Polymarket Data API call to this loop.
- **Don't extend the taxonomy mid-run.** New buckets land in `unattributed` first, become named buckets after the spike triages and fixes the detection. Skipping that step makes the matrix unauditable.
- **Don't auto-tune caps or thresholds.** This skill _recommends_, never _enforces_. Cap changes go through code review.
- **Don't conflate green Δ with success.** `edgeGapPct` is signed; we filter to `|edgeGapPct|`. A market where we beat the target by 50% is +50% variance just like one where we lost by 50%. Both are tracking error.
- **Don't suppress `unattributed` to keep the scorecard 🟢.** That's how the failure-mode taxonomy goes stale.

## Verification

The scorecard from a successful run satisfies:

1. Total of all bucket counts = total live markets with non-null `edgeGapPct`.
2. `unattributed` count ⇒ exactly that many spikes filed in the operator API this run.
3. Mean / median / percentile agree with the dashboard histogram (`MarketsDeltaDistribution`) within 0.1pp.
4. Every `🔴 active` row in the matrix has a real, currently-open work item linked.

If any of those four fail, the run is invalid — fix and re-run rather than posting.

## Reference incidents and patterns

- **bug.5032** — mirror coordinator silently dropped 76% of target fills (fixed). The detection signal `mirror.dropped` exists because of this. Run on its first day post-merge to confirm count drops.
- **bug.5035** — cancel-then-place stale resting BUYs (fixed today, 2026-05-07). Pre-fix: `already_resting` bucket would dominate. Post-fix: `already_resting_in_band` (by-design) only.
- **task.0376** — single-node-scope CI gate. The histogram + this skill ship in one PR; the dashboard chart is poly-scoped, the skill is repo-tooling.

## Out of scope

- **Auto-tuning of trading thresholds.** Recommendations only.
- **Cross-target weighted aggregation.** v0 treats every active target's |Δ| equally. Capital-weighted is a vNext when more than one target is funded.
- **Backtesting.** This skill measures the _current_ dispersion; it is not a research-bench for "what if we'd raised the cap last week."
- **UI changes.** The histogram component (`MarketsDeltaDistribution`) is the only visualization; deeper drill-down lives on a future Research tab, not here.
