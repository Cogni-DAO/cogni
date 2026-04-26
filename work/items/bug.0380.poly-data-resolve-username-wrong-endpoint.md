---
id: bug.0380
type: bug
title: "core__poly_data_resolve_username silently returns empty — Gamma /public-search?profile=true does not serve profiles"
status: needs_implement
priority: 1
rank: 6
estimate: 1
summary: "task.0386's `core__poly_data_resolve_username` wraps `https://gamma-api.polymarket.com/public-search?q=<x>&profile=true`, but that endpoint actually returns `{ events: [...], pagination: {...} }` for ALL queries — there is no `profiles` key, and the `profile=true` flag does nothing. Verified live 2026-04-25 against `trump`, `elon`, `polymarket`, `polytrader` → all returned 0 profile hits. Tool's `GammaPublicSearchResponseSchema` accepts the response because `profiles` is `.optional().default([])`, so the tool silently returns `{ profiles: [], count: 0 }` for every query. The agent thinks it called a working tool; the tool has never resolved a single username. Polymarket's Gamma `openapi.json` only documents follows/spotlights — no public profile-search endpoint exists. Same gist-sourced-not-live-curled pattern as `/traded-events` (purged) and `/holders` (bug.0379)."
outcome: "Either (a) `core__poly_data_resolve_username` is purged end-to-end like `core__poly_data_traded_events` was, OR (b) replaced with a real handle→wallet resolver (likely a Gamma endpoint we have not yet found, or an off-Polymarket source). Decision documented inline. If purged: tool file, capability method, types schema, index exports, tests, graph tool bundle, prompt mention, and stub bindings in all 4 apps removed. If replaced: live-curl evidence of the new endpoint pasted into the work item, response schema rewritten from a real captured response, and a follow-up live probe at flighted buildSha returns ≥1 real profile for a known-handle query."
spec_refs: []
assignees: []
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, ai-tools, gamma-api, schema, task-0368-followup]
external_refs:
---

# core\_\_poly_data_resolve_username — wrong endpoint, silent fail

## Why

Tool wraps:

```
GET https://gamma-api.polymarket.com/public-search?q=<query>&profile=true&limit=<n>
```

Live probe results 2026-04-25 (no auth — public endpoint):

| query        | HTTP | response shape                         | profile hits |
| ------------ | ---- | -------------------------------------- | ------------ |
| `polytrader` | 200  | `{ events: [...], pagination: {...} }` | 0            |
| `trump`      | 200  | `{ events: [...], pagination: {...} }` | 0            |
| `elon`       | 200  | `{ events: [...], pagination: {...} }` | 0            |
| `polymarket` | 200  | `{ events: [...], pagination: {...} }` | 0            |
| `kalshi`     | 200  | `{ events: [...], pagination: {...} }` | 0            |

**Pattern:** the endpoint serves event/market search, not profile search. The `profile=true` flag has no observable effect. There is no `profiles` key in any response.

`GammaPublicSearchResponseSchema` in `polymarket.data-api.types.ts`:

```ts
export const GammaPublicSearchResponseSchema = z.object({
  profiles: z.array(GammaProfileSchema).optional().default([]),
  ...
}).passthrough();
```

Because `profiles` is `.optional().default([])`, parsing succeeds with an empty array. Tool returns `{ profiles: [], count: 0 }`. Agent has no way to know the call did nothing.

Gamma `openapi.json` (`https://gamma-api.polymarket.com/openapi.json`) only documents:

- `/follows*` (social graph)
- `/spotlights*` (curated content)
- `/v1/account/*` and `/v1/data/*` follow endpoints

There is **no public profile-search endpoint documented**. The endpoint we wrap exists (HTTP 200) but serves a different shape. Closest comparable: shaunlebron's gist (which the original task.0386 design referenced) appears to have invented this, identical to the `/traded-events` mistake.

## Live evidence (PR #1033 candidate-a probe, sha `f7ff381a`)

```
runId a4fcf7fd-aedf-4571-83ed-bdda3190abd5
event=ai.tool_call (success — no .error)
  tool=core__poly_data_resolve_username
  query="polytrader"
  → returned {profiles: [], count: 0}
```

No Loki error. Tool reported success. Behavior is silent-fail.

## Decision matrix

**Option A — purge.** Same surgery as `core__poly_data_traded_events` (task.0386 commit `f7ff381a9`):

- Delete `packages/ai-tools/src/tools/poly-data-resolve-username.ts`
- Remove from capability interface, types schemas, index exports, catalog, tests, graph tool bundle, prompts, and the 4 stub bindings (poly/operator/resy/node-template).
- Net `~−250` LOC across ~10 files.

**Option B — replace.** Find a real handle→wallet resolver. Candidates to research:

- A different Gamma endpoint (none documented in openapi.json).
- Polymarket's web-app GraphQL (private, may break).
- Off-Polymarket: third-party indexer (e.g. Dune, Polygonscan) — out of scope for an in-graph tool.

If a real endpoint is found, capture a live response verbatim, rewrite the schema from that fixture, add a unit test that parses the fixture, and update the tool description to reflect the actual capability.

**Recommendation: Option A** unless a real endpoint surfaces in <30 minutes of research. Tool has zero working users; the agent prompt already gracefully degrades when the resolver returns empty (it asks the user for the proxyWallet directly).

## Allowed Changes

If A:

- Delete `packages/ai-tools/src/tools/poly-data-resolve-username.ts`
- `packages/ai-tools/src/{index.ts, catalog.ts, capabilities/poly-data.ts, capabilities/index.ts}` — remove exports + `resolveUsername` capability method
- `packages/market-provider/src/adapters/polymarket/{polymarket.data-api.client.ts, polymarket.data-api.types.ts, index.ts}` — remove `resolveUsername` method, `GammaProfile*` schemas
- `packages/ai-tools/tests/poly-data-tools.test.ts`, `packages/market-provider/tests/polymarket-data-api.test.ts` — remove related cases
- `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts` — remove `resolveUsername` factory
- `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` + 3 stub bindings (operator/resy/node-template) — remove
- `nodes/poly/graphs/src/graphs/poly-research/{prompts.ts, tools.ts}` + `tests/poly-research.test.ts` — remove
- `packages/ai-tools/AGENTS.md`, `packages/market-provider/AGENTS.md` — strike from tool list

## Validation

- `exercise:` Confirm tool no longer appears in `core__poly_data_help` endpoint catalog or in the `poly-research` toolset; agent prompt no longer references it.
- `observability:` Loki at flighted buildSha — zero log lines mentioning `core__poly_data_resolve_username` after deploy. Sub-matrix probe re-run: tool name not present in `poly_data_help` output.

## Out of Scope

- `/holders` schema fix — separate sibling bug.0379.
- Building a custom handle→wallet indexer — separate spike if Option B becomes attractive later.

## Related

- Surfaced in PR #1033 sub-matrix: https://github.com/Cogni-DAO/node-template/pull/1033#issuecomment-4320409131
- Sibling: bug.0379 (`/holders` schema mismatch).
- Lineage: `core__poly_data_traded_events` purge (task.0386 commit `f7ff381a9`).
- Skill update capturing the post-mortem pattern: `docs/skill-validate-candidate-thoroughness` branch (sub-matrix sweep section).

## PR / Links

-

## Attribution

-
