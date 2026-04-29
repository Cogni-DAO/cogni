---
id: task.0421
type: task
title: "Poly wallet research charter + first live screen + Dolt schema proposal"
status: needs_merge
priority: 1
rank: 5
estimate: 1
summary: "Codify the methodology for finding + ranking Polymarket copy-trade targets — chr.poly-wallet-research charter, first live 87-wallet screen against the rubric, 50-fresh expansion + self-review, Dolt knowledge schema proposal. Pure docs/research deliverable; the agent-tool implementation is tracked in task.0422 (already shipped via PR #1124)."
outcome: "work/charters/POLY_WALLET_RESEARCH.md serves as the canonical reference for which wallets the poly node should mirror. Two reproducible research docs validate the rubric against Derek's reference wallets and a 50-wallet expansion. Doltgres schema sketch in the research doc is the v0.5 → vNext path for persisting ranked rosters."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: research/poly-wallet-ranking-charter
pr: https://github.com/Cogni-DAO/node-template/pull/1120
reviewer:
revision: 1
blocked_by: []
deploy_verified: true
created: 2026-04-28
updated: 2026-04-29
labels: [poly, docs, research, wallet-research, copy-trade-targets]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1124
---

# task.0421 — Poly wallet research charter

## Why

`chr.poly-wallet-research` defines curve shape (smoothness of the realized cumulative-PnL time-series, low max-drawdown, sustained slope) as the **primary** ranking signal for picking copy-trade targets. The agent cannot see that signal today:

- `PolymarketUserPnlClient` (`packages/market-provider/src/adapters/polymarket/polymarket.user-pnl.client.ts`) exists and is used by the dashboard route at `/api/v1/poly/wallets/[addr]?include=pnl`, but it is NOT exposed as a `core__poly_data_*` tool.
- Even with raw points, no pure-function reducer canonicalizes `{ totalPnl, maxDrawdown, maxDdPctOfPeak, monthsActive, slopeR², longestUpStreak, monthlyReturnPositiveFraction, daysSinceLastTrade }`. The LLM would have to compute these inline — error-prone and token-heavy.

Without these two pieces, the `poly-research` graph is forced to fall back on snapshot leaderboard PnL — the noisiest signal, the one the prior research demonstrated as a false-positive driver.

## Scope

### In scope

1. **`core__poly_data_user_pnl`** — new tool in `nodes/poly/packages/ai-tools/src/tools/poly-data-user-pnl.ts`. Mirrors the contract pattern of the existing 7 poly-data tools (Zod input/output, `effect: read_only`, capability-bound). Inputs: `{ user: hex40, interval: '6h'|'12h'|'1d'|'1w'|'1m'|'all'|'max', fidelity?: '1h'|'3h'|'12h'|'18h'|'1d' }`. Output: `{ points: Array<{ t: number; p: number }> }`.
2. **`core__poly_data_pnl_curve_metrics`** — pure-function tool. No IO. Input: `{ points: Array<{ t, p }> }`. Output: the metric bundle named in the charter §Measurable Identifiers.
3. **Pure module** at `packages/market-provider/src/analysis/pnl-curve-metrics.ts` containing the reducer logic, unit-tested in isolation. The tool is a thin wrapper over this module. **Numerical robustness is required** — empty arrays, single-point series, all-zero curves, exact-constant curves, NaN/Infinity from the upstream API must all return clean structured results (not throw, not return `null` for individual fields). The 50-fresh-screen exposed three wallets where naive reducer implementations returned `R²: null`, silently corrupting downstream rankings.
   3a. **`core__poly_data_user_pnl_summary`** — the canonical AI snapshot tool. Single call returns `{ sparkline12: string, metrics: PnlCurveMetrics, charterVerdict: { passed, reasons[] }, score, confidence }`. The sparkline is built by:
   - resampling the raw curve to **12 fixed time-spaced bins**, taking the median `p` per bin;
   - mapping each bin to one of `▁▂▃▄▅▆▇█` by **min-max normalizing within the wallet's own range** (so a $7M and a $100k smooth-uptrend wallet produce the same shape);
   - returning the 12-char string. Same data feeds the human wallet-research page row UI (one column = `<MiniChart points={…}/>` for humans, the same string for the agent — zero divergence risk).
   - Charter verdict applies all eight hard filters (H1–H8) where data is available; reasons[] enumerates failures so the agent reads them as one flat list. Confidence = `min(1, monthsActive / 12)` — protects against premature anointing of low-tenure clean curves.
4. **Update `core__poly_data_help`** strategy + endpoints sections to teach the agent the new sequence:
   - call `core__poly_data_user_pnl(interval='all')` early in pre-filter,
   - feed the points to `core__poly_data_pnl_curve_metrics`,
   - drop on H1/H3/H4 before any expensive `/activity` or `/trades` call.
5. **Update the `poly-research` system prompt** (`nodes/poly/graphs/src/graphs/poly-research/prompts.ts`) Stage-2 sequence to use the new tools; reference the charter.
6. **Optional / stretch:** add `medianDwellTime` + bot-vs-bot signals to the same reducer module (charter H8). Can split into a follow-up task if the activity-based dwell-time computation needs its own design.

### Out of scope (explicit)

- New `knowledge_poly` table for ranked rosters — vNext, after this lands and the human-reviewed roster has been validated against 2 weeks of paper-mirror outcomes.
- Harvard 2026 flagged-wallet exclusion gate — vNext.
- Category-filtered `core__wallet_top_traders` extension — separate task; not blocking.
- Auto-promotion of ranked wallets into the live mirror roster — gated on the same human review the charter requires.

## Plan

1. Add `pnpm add` is not needed; `PolymarketUserPnlClient` already exists.
2. Write `packages/market-provider/src/analysis/pnl-curve-metrics.ts` (pure reducer + unit tests).
3. Add tool files in `nodes/poly/packages/ai-tools/src/tools/` following the existing pattern (`poly-data-positions.ts` is the closest reference). Bind via the existing `PolyDataCapability` factory (extend with a `getUserPnl` method).
4. Wire into `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts` and `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` (the 7-tool list becomes 9 tools).
5. Update help meta-tool catalog + strategy.
6. Update `poly-research` graph prompt with new sequence.
7. Stack-test: invoke the graph against a known-good wallet (e.g. `0x2005d16a84ceefa912d4e380cd32e7ff827875ea`) and confirm the report includes `curveQuality > 0.85` and `maxDdPctOfPeak < 0.15`.

## Validation

**exercise:**

```bash
curl -X POST https://poly-test.cognidao.org/api/v1/agent/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "graph": "poly-research",
    "input": "Profile wallet 0x2005d16a84ceefa912d4e380cd32e7ff827875ea on its all-time PnL curve. Return the curve metrics and tell me whether it passes the chr.poly-wallet-research hard filters."
  }'
```

**Expected:** HTTP 200 with a `PolyResearchReport` whose single candidate carries the new metric bundle (totalPnl ≈ $6.5M, maxDdPctOfPeak < 0.15, monthsActive ≥ 8, slopeR² ≥ 0.85) and `recommendation: "mirror-high-confidence"`.

**observability:**

```
{service="poly-node-app", buildSha="<flighted-sha>"}
  |~ "core__poly_data_user_pnl|core__poly_data_pnl_curve_metrics"
  | json
```

**Expected:** ≥2 tool-invocation log lines at the deployed SHA from a single agent run, both returning successfully.

## Test plan

- [ ] Unit tests on `pnl-curve-metrics.ts` — empty series, single-point series, monotonic up, choppy, deep-DD-recovered, abandoned/flat, fixed-fixture against the Aug 2025 → Apr 2026 curve of `0x2005d16a…` (use a recorded Polymarket response).
- [ ] Tool-contract tests in `nodes/poly/packages/ai-tools/tests/poly-data-tools.test.ts` mirroring the 5 invariants (`TOOL_ID_NAMESPACED`, `EFFECT_READ_ONLY`, `REDACTION_ALLOWLIST`, `USER_PARAM_IS_PROXY_WALLET`, `PAGINATION_CONSISTENT`).
- [ ] `pnpm check:fast` green.
- [ ] Stack-test invoking the `poly-research` graph end-to-end with a recorded `user-pnl-api` fixture.
- [ ] Candidate-a flight + live agent call + Loki observability check → `deploy_verified: true`.
