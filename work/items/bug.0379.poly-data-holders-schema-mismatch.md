---
id: bug.0379
type: bug
title: "core__poly_data_holders schema is wrong — real /holders response is grouped per outcome token"
status: needs_implement
priority: 1
rank: 5
estimate: 1
summary: "task.0386's `core__poly_data_holders` tool wraps `https://data-api.polymarket.com/holders?market=<conditionId>` but `MarketHoldersResponseSchema` expects a flat array of holders. The real response is `[{ token: string, holders: [{ proxyWallet, asset, name, pseudonym, amount, outcomeIndex, profileImage, displayUsernamePublic, verified, ... }] }]` — grouped per outcome token. safeParse correctly catches it and emits `PolyDataApiValidationError(VALIDATION_FAILED, /holders)`. Caller-visible: 500 Internal Server Error from poly-research graph. Surfaced live on candidate-a 2026-04-25 (PR #1033 sub-matrix probe, runId 1c7bd3dc). Same root cause as the `/traded-events` regression already purged — schema sourced from a gist, not live-curled."
outcome: "`MarketHoldersResponseSchema` (and `MarketHolderSchema`) match the live Polymarket `/holders` shape. `getHolders` capability either returns the per-outcome grouping (`{ market, outcomes: [{ token, holders: [...] }], count }`) OR flattens with `outcomeIndex` preserved on each holder. Tool description + agent prompt updated to match. Live probe on candidate-a returns 200 with real holder data; zero `ai.tool_call.error` events for `core__poly_data_holders`."
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
labels: [poly, ai-tools, data-api, schema, task-0368-followup]
external_refs:
---

# core\_\_poly_data_holders schema mismatch

## Why

`packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` declares:

```ts
export const MarketHolderSchema = z.object({
  proxyWallet: PolyAddressSchema,
  size: z.coerce.number(),
  outcome: z.string(),
  userName: z.string().nullable(),
  ...
}).passthrough();

export const MarketHoldersResponseSchema = z.array(MarketHolderSchema);
```

The real `https://data-api.polymarket.com/holders?market=0xbd6aec…3ba2&limit=2` response (verified live 2026-04-25):

```json
[
  {
    "token": "28005153828654920128085880371664285797494691659131839762220310297656589209075",
    "holders": [
      { "proxyWallet": "0x9f138019d5481fdc5c59b93b0ae4b9b817cce0fd", "asset": "...", "name": "Bienville", "pseudonym": "Beloved-Mister", "amount": 15470.85, "outcomeIndex": 1, "displayUsernamePublic": true, "profileImage": "", "profileImageOptimized": "", "verified": false, "bio": "" },
      { "proxyWallet": "0x91eb764b126aa6c07436552454ea3b716fc19325", ... }
    ]
  },
  { "token": "81097479775162715196637378793566627239866006005224332789549325479718903885768", "holders": [ ... ] }
]
```

Outer array is **per-outcome token**, holders nested inside. Field set is also different: `proxyWallet`/`asset`/`name`/`pseudonym`/`amount`/`outcomeIndex`/`displayUsernamePublic`/`verified`/`bio`/`profileImage*` — not `size`/`outcome`/`userName`.

## Live evidence (PR #1033 candidate-a probe, sha `f7ff381a`)

```
runId 1c7bd3dc-5233-49b7-acfe-31306e5e3ea9
event=ai.tool_call.error
  tool=core__poly_data_holders
  errorCode=execution
  safeMessage="Polymarket Data API response validation failed (/holders): 0.proxyWallet: Required; 1.proxyWallet: Required"
  → 500 to caller
```

The new typed `PolyDataApiValidationError` boundary (also from task.0386) is the only reason this surfaced as a clean `VALIDATION_FAILED` instead of an opaque ZodError dumped to the user — exactly the boundary it was designed for.

## Allowed Changes

- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` — rewrite `MarketHolderSchema` (per-holder fields) + `MarketHoldersResponseSchema` (per-outcome wrapper).
- `packages/ai-tools/src/capabilities/poly-data.ts` — adjust `PolyDataHoldersOutput` shape (decision: per-outcome grouping or flatten with `outcomeIndex` preserved).
- `packages/ai-tools/src/tools/poly-data-holders.ts` — output contract + tool description.
- `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts` — `getHolders` factory mapping.
- `nodes/poly/graphs/src/graphs/poly-research/prompts.ts` — update tool description if shape decision changes downstream usage.
- `packages/market-provider/tests/polymarket-data-api.test.ts` + `packages/ai-tools/tests/poly-data-tools.test.ts` — fixtures based on the live response above (saved verbatim from a real `/holders` call so we never re-write a schema from prose).

## Validation

- `exercise:` Send `Call core__poly_data_holders for market=<live-conditionId> with limit=5. Return raw JSON, no commentary.` to deployed `poly-research` graph on candidate-a. Expect HTTP 200 with real `proxyWallet`s back.
- `observability:` Loki query at flighted buildSha for `event=~"ai.tool_call.*"` filtered by `tool="core__poly_data_holders"` — must show only `event="ai.tool_call"` (success) entries; zero `.error` entries for this tool.

## Out of Scope

- `core__poly_data_resolve_username` — separate bug, separate root cause.
- General audit of every Polymarket schema in the package — PR #1033 sub-matrix already proved 6/8 tools work; only this one + resolve_username are broken.

## Related

- Surfaced in PR #1033 sub-matrix: https://github.com/Cogni-DAO/node-template/pull/1033#issuecomment-4320409131
- Sibling: bug.0380 (`core__poly_data_resolve_username` wrong endpoint).
- Lineage: `core__poly_data_traded_events` purge (task.0386 commit `f7ff381a9`) — same gist-sourced-without-live-curl root cause.

## PR / Links

-

## Attribution

-
