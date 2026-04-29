---
id: task.0422
type: task
title: "Poly data user-pnl-summary — agent's default wallet snapshot tool"
status: done
priority: 1
rank: 5
estimate: 2
summary: "Ship core__poly_data_user_pnl_summary as the poly-research agent's default first call when handed a wallet address. ONE tool returns 12-cell Unicode sparkline + curve metrics + chr.poly-wallet-research hard-filter verdict + score + confidence, 24h-cached via KnowledgeCapability. Replaces the old value/positions/activity-combo dance the agent used to do for snapshot requests."
outcome: "User asks the deployed poly-research graph 'research snapshot of this wallet please 0x…' and the agent calls core__poly_data_user_pnl_summary as its only tool. Response includes the sparkline verbatim in candidates[0].reasoning. Loki shows tool_call_start with toolName=core__poly_data_user_pnl_summary at the deployed SHA from the user's reqId."
spec_refs:
  - work/charters/POLY_WALLET_RESEARCH.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/poly-wallet-summary-tool
pr: https://github.com/Cogni-DAO/node-template/pull/1124
reviewer: self-review-pass-after-inline-fixes
revision: 1
blocked_by: []
deploy_verified: true
created: 2026-04-28
updated: 2026-04-28
labels: [poly, ai, ai-tools, langgraph, wallet-research, copy-trade-targets]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1120
---

# task.0422 — Poly data user-pnl-summary tool

## Why

Before this PR, asking the deployed poly-research agent for a wallet research snapshot triggered three separate tool calls (`value` + `positions` + `activity`) and produced a textual report with no curve, no verdict, no score. The chr.poly-wallet-research charter defines the curve as the **primary** signal — and the agent had no tool to compute or render it.

Local validation against Derek's two reference wallets (RN1 + swisstony) had already shown that one tool can replace the three-tool combo and emit a much richer snapshot: sparkline + metrics + pass/fail + score + confidence. This task ships that tool and rewrites the system prompt so the agent reaches for it as its DEFAULT first call.

## What shipped

| File                                                                   | Role                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `nodes/poly/packages/ai-tools/src/analysis/pnl-curve-metrics.ts`       | Pure reducer + sparkline + verdict. Numerically robust against empty/single/constant/NaN/Infinity input. |
| `nodes/poly/packages/ai-tools/tests/pnl-curve-metrics.test.ts`         | 12 unit tests covering every degenerate input class + known-good shapes.                                 |
| `nodes/poly/packages/ai-tools/src/tools/poly-data-user-pnl-summary.ts` | The new `core__poly_data_user_pnl_summary` tool. Reads cache → returns if fresh; else fetches + writes.  |
| `nodes/poly/packages/ai-tools/src/capabilities/poly-data.ts`           | `PolyDataCapability` extended with `getUserPnl`.                                                         |
| `nodes/poly/packages/ai-tools/src/index.ts`                            | Tool added to `POLY_TOOL_BUNDLE`.                                                                        |
| `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts`           | Capability impl backed by `PolymarketUserPnlClient`.                                                     |
| `nodes/poly/app/src/bootstrap/container.ts`                            | Wires the user-pnl client.                                                                               |
| `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts`                     | Binding takes `polyDataCapability` + `knowledgeCapability` for cache I/O.                                |
| `nodes/poly/graphs/src/graphs/poly-research/tools.ts`                  | Tool ID added to `POLY_RESEARCH_TOOL_IDS` (first after `_help`).                                         |
| `nodes/poly/graphs/src/graphs/poly-research/prompts.ts`                | System prompt rewritten with a decision tree naming `user_pnl_summary` as the default first call.        |

## Validation result

PR #1124 flighted to candidate-a (`buildSha: 61910837`); validation comment posted live: <https://github.com/Cogni-DAO/node-template/pull/1124#issuecomment-4340175187>.

```
PR TWEAK              | HUMAN | AI  | LOKI | OVERALL
USER-PNL-SUMMARY-TOOL | —     | 🟢  | 🟢   | 🟢 PASS
PROMPT-DEFAULT-FIRST  | —     | 🟢  | 🟢   | 🟢 PASS
```

Real exercise (`POST /api/v1/ai/chat` with `graphName=poly-research`, prompt `"research snapshot of this wallet please 0x204f72f35326db932158cba6adff0b9a1da95e14"`) returned a `PolyResearchReport` whose `candidates[0].reasoning` starts with the sparkline `▁▁▁▁▂▄▄▆▆▇██` and reports `$6.58M, R²=0.95, DD 19%`. Loki tier-1 confirmed `tool_call_start toolName=core__poly_data_user_pnl_summary` at `reqId=108c9b13-bf5c-4111-8f42-ed5a3f01e426`. **`deploy_verified: true`.**

## Validation

**exercise:**

```bash
curl -X POST https://poly-test.cognidao.org/api/v1/ai/chat \
  -H "Authorization: Bearer $POLY_AGENT_KEY" -H 'Content-Type: application/json' \
  -d '{"message":"research snapshot of this wallet please 0x204f72f35326db932158cba6adff0b9a1da95e14","modelRef":{"providerKey":"platform","modelId":"gpt-4o-mini"},"graphName":"langgraph:poly-research"}'
```

**Expected:** SSE stream containing exactly one `tool-input-start` for `core__poly_data_user_pnl_summary`, then a final `PolyResearchReport` whose `candidates[0].reasoning` starts with a 12-char Unicode-block sparkline and quotes the wallet's curve metrics ($6.5M-ish PnL, R²≈0.95, DD≈19%).

**observability:**

```
{namespace="cogni-candidate-a", pod=~"poly-node-app-.*"} |= "core__poly_data_user_pnl_summary"
```

**Expected:** ≥1 `msg=tool_call_start` line at the deployed SHA carrying the caller's `reqId`.

## Known limitations

- **Pure reducer is duplicated.** The `analysis/pnl-curve-metrics.ts` module is a v0 copy of `packages/market-provider/src/analysis/pnl-curve-metrics.ts` (PR #1120). The duplication keeps this PR single-domain (poly-bucket only, single-node-scope CI gate). Once #1120 merges, the poly-internal copy collapses into a re-import. Tracked in the module header.
- **`fromCache: boolean`** is in the tool output but NOT in the `PolyResearchReport` contract — internal-only signal, not surfaced to the agent's response. Adding it to the report contract would touch `packages/node-contracts` (operator-bucket) and re-trigger cross-domain.
- **H5 (category) + H8 (bot-vs-bot)** still need `core__poly_data_activity` — the new tool's `verdict.passed: true` is necessary but not sufficient. The system prompt's decision tree explicitly tells the agent to chase `_activity` for borderline / category-sensitive cases.

## Follow-ups

- Once PR #1120 merges → small PR collapsing the poly-internal `pnl-curve-metrics.ts` into a re-import from `@cogni/market-provider/analysis`.
- Doltgres `poly_wallet_rankings` table (charter v0.5 → vNext) — file when re-running the screen weekly produces enough query patterns to justify a dedicated table.
- Category-filtered `core__wallet_top_traders` extension — improves discovery sweeps now that the per-wallet snapshot tool is fast.

## Review feedback (resolved)

Inline fixes landed in commit `4af7846c7` after self-review:

- **`effect: "read_only"` was wrong** — the tool writes to the knowledge store on cache-miss; corrected to `"state_change"` (per `packages/ai-core/src/tooling/types.ts`). Today's runtime ignores `effect` but future policy plumbing will read it.
- **Header `EFFECT_READ_WRITE` invariant was non-existent** — aligned to `EFFECT_STATE_CHANGE`.
- **Stale `task.0419` reference in module Links:** — the ID was consumed by an unrelated merged PR; updated to `task.0422`.
- **Misleading `user` input description** — claimed wrong addresses return `degenerate=true`, but the Zod regex actually rejects pre-execute. Rewritten to describe the realistic EOA-vs-Safe-proxy failure mode (which IS observable end-to-end).

Non-blocking observations deferred to follow-up PRs:

- Cache-miss-write `try/catch` swallows errors silently (no log) — observability gap. Consider a `console.warn` or structured-log call on write failure.
- Cache id `poly-wallet-summary:<wallet>` does not include `charterVersion`. A deploy that bumps the charter version with the same wallet ID can still serve a stale verdict for up to 24h. Mitigation: append `CHARTER_VERSION` to the cache id, or invalidate on version skew at read.
- Cache read at L165–183 parses cached JSON and casts to the output type without re-validating through `PolyDataUserPnlSummaryOutputSchema.safeParse()`. A corrupted but JSON-valid row would leak through with the wrong shape.
- No tests for the tool itself (only the pure reducer). Coverage gap on cache-hit / cache-miss / forceRefresh / fromCache paths.
- `confidencePct: Math.round(confidence * 100)` could panic on NaN if `summarize()` ever regresses on numerical robustness. Guard with `Number.isFinite`.
