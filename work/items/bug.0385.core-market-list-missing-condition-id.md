---
id: bug.0385
type: bug
title: "core__market_list drops Polymarket conditionId → /holders + /trades unreachable to the agent"
status: needs_triage
priority: 2
rank: 10
estimate: 1
summary: "`core__market_list` returns `id` as the internal Cogni identifier (`prediction-market:polymarket:<gammaId>`), not the Polymarket `conditionId` (hex). That breaks every `core__poly_data_*` tool that requires a `conditionId` (holders, trades_market) — the agent has no other in-band path from category → conditionId, so it hallucinates market strings that the Data API rejects with HTTP 400."
outcome: "`core__market_list` returns each market's `conditionId` when provider=polymarket, so the `poly-research` graph can execute its original `/holders`-based hidden-gem discovery path (task.0386 Phase 6 strategy, step 2)."
spec_refs: []
assignees: [derekg1729]
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-24
updated: 2026-04-24
labels: [poly, ai-tools, market-list, data-api, task-0368-followup]
external_refs:
---

# bug.0385 — core\_\_market_list drops Polymarket conditionId

## What happened

task.0386 deployed 8 `core__poly_data_*` research tools to candidate-a. First real exercise (run `b2dee07f-5bb5-4548-bee2-c88556c7dc58`, build 322baf950) hit Recursion-Limit-25 because the agent called `core__poly_data_holders` 17+ times, each returning `Polymarket Data API error: 400 Bad Request (/holders)`.

Probing the live `/holders` endpoint directly with a real conditionId returns HTTP 200 `[]`. The agent wasn't using a real conditionId — it was using whatever token the `core__market_list` tool gave it.

## Root cause

`packages/ai-tools/src/tools/market-list.ts` → `MarketItemSchema.id` is populated from `NormalizedMarket.id`, which the normalizer constructs as:

```ts
id: `prediction-market:polymarket:${raw.id}`; // polymarket.normalizer.ts:51
```

`raw.conditionId` lives on `NormalizedMarket.attributes.conditionId` (normalizer.ts:65) but `MarketItemSchema` does not surface `attributes` — so the agent never sees the real Polymarket conditionId. Every `/holders?market=…` call in the discovery loop is dead on arrival.

## Impact

- `core__poly_data_holders` unreachable from agent-driven discovery → "hidden gem" discovery path (task.0386 step 2) non-functional.
- `core__poly_data_trades_market` same issue (requires conditionId).
- Wasted model turns + recursion-limit crashes on any research prompt that follows the default discovery sequence.

task.0386 shipped with a prompt workaround that steers the agent toward `core__wallet_top_traders`-first discovery, sidestepping this bug. That restores a functional v0 research path but loses the market-centric discovery advantage.

## Proposed fix

1. Extend `MarketItemSchema` with an optional `providerIds?: { conditionId?: string; negRisk?: boolean; … }` field (or inline `conditionId`, guarded by `provider === "polymarket"`).
2. Populate from `NormalizedMarket.attributes` in `createMarketListImplementation`.
3. Update the tool description so the agent knows the conditionId is a **hex string**, not the Cogni `id`.
4. Once merged, revert the task.0386 prompt to its original `/holders`-first discovery sequence (or keep both paths).

## Scope

- `packages/ai-tools/src/tools/market-list.ts` — schema + impl
- `packages/ai-tools/tests/market-list.test.ts` (if exists) — fixture update
- Optional: a second iteration of `nodes/poly/graphs/src/graphs/poly-research/prompts.ts` to re-enable `/holders` harvesting

## Validation

**exercise:**

```bash
# After fix, with the candidate-a build that ships the conditionId surface:
BASE=https://poly-test.cognidao.org
API_KEY=<machine-agent bearer>
curl -s -X POST $BASE/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"model":"gpt-4o-mini","graph_name":"poly-brain","messages":[{"role":"user","content":"Call core__market_list with provider=polymarket limit=1 and return the raw JSON."}]}' \
  | jq -r '.choices[0].message.content'
```

**Expected:** the returned market object includes a `conditionId` (hex 0x…) alongside the existing `id` (Cogni prefix).

**observability:**

```
{service_name="app"} |= "core__market_list" | json | conditionId != ""
```

## Attribution

- Discovered during task.0386 deploy-verification run, 2026-04-24, pod `poly-node-app-75984f5964-w9kdv`.
