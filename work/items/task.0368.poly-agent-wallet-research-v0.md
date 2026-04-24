---
id: task.0368
type: task
title: "Poly agent wallet research v0 — Data-API tools + poly-research graph"
status: needs_implement
priority: 1
rank: 4
estimate: 3
summary: "Empower the deployed poly agent to autonomously research, profile, and score Polymarket wallets beyond the top-500 leaderboard. Ships 8 hand-rolled Data-API tools + a new `poly-research` LangGraph peer graph that composes them into a structured ranking report for copy-trade target selection."
outcome: "Running `POST /api/v1/agent/execute` with `graph=poly-research` returns a typed `PolyResearchReport` containing candidate wallets (proxyWallet, stats, reasoning, evidenceUrls) ranked by consistency. Discovery strategy uses per-market `/holders` + `/trades` harvesting to surface hidden-gem wallets the top-500 leaderboard misses."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/task-0368-poly-agent-wallet-research
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-24
updated: 2026-04-25
labels:
  [poly, ai, langgraph, ai-tools, data-api, wallet-research, copy-trade-targets]
external_refs:
---

# task.0368 — Poly agent wallet research v0

## Why hand-roll (not MCP, not autogen)

Logged here so the next agent doesn't re-litigate:

- **Rejected upstream Polymarket MCP** (PR #997 closed 2026-04-24): all 25 tools are market-centric; zero wallet-profile / leaderboard / handle-resolution tools. The core reason we wanted it.
- **Rejected OpenAPI autogen** (LangChain `OpenAPIToolkit`, Speakeasy, `mcp-openapi-proxy`): Polymarket has no official OpenAPI spec. Even if it did, tool-per-endpoint dumps lose the curation (tuned descriptions, pagination conventions, Zod envelopes) that are the actual value.
- **Rejected LangChain `RequestsToolkit`**: too raw. Agent hallucinates URLs; no stable context envelope against schema drift.
- **Rejected Composio / Arcade / Toolhouse**: no Polymarket coverage; SaaS dependency.

For a **core-domain** API with ~8 endpoints we iterate on, hand-rolled thin wrappers win: ~1 day of work yields Zod envelopes, tuned descriptions, pagination conventions, billing/metering via `ai-tools` patterns.

## Architecture decision (per `third-party-integrator` skill matrix)

- **App Capability** pattern. Not Port/Adapter (no business logic, no test isolation burden — it's public read-only HTTP). Not MCP (graph-internal tools).
- Extends **existing** `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts` (don't duplicate). Add Zod schemas + new methods; all responses routed through `.safeParse()` at the adapter boundary (stable context envelope per skill §4).
- Extends **existing** `walletCapability` on `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — one capability keeps related Data-API methods co-located (aligns with `task.0346` which also extends it).
- `PolyTraderWalletPort` stays untouched. That's signing/trading (business-critical, must fake in CI). This is research (advisory, read-only).

## Graph topology — peer subgraph, not poly-brain extension

New `poly-research` LangGraph graph as a **peer** to poly-brain, not as 8 new tools bolted onto poly-brain.

Why:

- Research is long-horizon (many tool calls, iterate-paginate-aggregate). Burns poly-brain's trading context with non-trading tokens.
- Research produces a **cacheable artifact** (structured report) → clean subgraph boundary; task.0334 later persists it to Dolt.
- Different system prompts. Research = patient + skeptical + loves tables. Trading = decisive + risk-aware.
- In v1, poly-brain invokes `poly-research` via a single `core__poly_research` tool call and gets back the digest — never re-does the discovery work.

## Tool surface — CLI-flavored primitives (per Karpathy/Steinberger research)

Raw JSON out. Paginated small. **No `analyze_wallet` / `find_profitable_traders` fat verbs** — those bake our hypothesis into code and rob the agent of agency.

| Tool ID (new)                      | Wraps (`data-api.polymarket.com`)                          |
| ---------------------------------- | ---------------------------------------------------------- |
| `core__poly_data_positions`        | `/positions?user=&market=&sizeThreshold=` (limit/offset)   |
| `core__poly_data_activity`         | `/activity?user=&type=&start=&end=` (limit/offset)         |
| `core__poly_data_value`            | `/value?user=` — cheap filter before heavier calls         |
| `core__poly_data_holders`          | `/holders?market=` — hidden-gem discovery core             |
| `core__poly_data_trades_market`    | `/trades?market=&takerOnly=` — counterparty harvesting     |
| `core__poly_data_traded_events`    | `/traded-events?user=` — category-specialization analysis  |
| `core__poly_data_resolve_username` | Gamma `/public-search?profile=true` — handle → proxyWallet |
| `core__poly_data_help`             | Meta-tool: endpoint catalog + example discovery sequences  |

Existing `core__wallet_top_traders` (wraps `/leaderboard`) is reused as-is — it joins the `poly-research` toolset.

## Discovery strategy (prompt-only in v0)

Encoded in the `poly-research` system prompt, not a planner node:

1. Seed by category via existing `core__market_list` / Gamma `/events?tag_slug=sports|politics|crypto`.
2. Harvest `/holders` on 50–200 markets in the category; union wallets; count cross-market appearances.
3. Also harvest `/trades` counterparties on high-volume markets.
4. Cheap-filter with `/value?user=` to drop sub-$1k wallets.
5. Profile survivors: `/positions` (unrealized) + `/activity` (realized-PnL reconstruction).
6. Rank by consistency: ≥N resolved markets, win-rate ≥60%, positive PnL across ≥3 events. Filters lucky one-shotters.
7. Cross-check against `/leaderboard?orderBy=PNL&offset=0..1000` — if absent, genuine hidden gem.

A planner-node split is v1 (see Out of Scope).

## Output contract — `PolyResearchReport` Zod

Lives at `packages/node-contracts/src/poly.research-report.v1.contract.ts`:

```ts
const PolyResearchReport = z.object({
  query: z.string(),
  methodology: z.string(),
  candidates: z.array(
    z.object({
      proxyWallet: PolyAddressSchema,
      userName: z.string().nullable(),
      rank: z.number().int().positive(),
      confidence: z.enum(["low", "medium", "high"]),
      stats: z.object({
        totalPnl: z.number(),
        winRate: z.number().nullable(),
        sampleSize: z.number().int().nonnegative(),
        categoryFocus: z.array(z.string()).optional(),
      }),
      reasoning: z.string(),
      evidenceUrls: z.array(z.string().url()),
    })
  ),
  caveats: z.array(z.string()),
  recommendation: z
    .enum(["mirror-high-confidence", "monitor", "reject"])
    .nullable(),
});
```

Graph emits via LangGraph structured output on the final message.

## Final Design — per-tool input / output / invariants

**Shared invariants** (apply to all 8 tools):

- `TOOL_ID_NAMESPACED` — tool ID is `core__poly_data_*`
- `EFFECT_READ_ONLY` — `effect: "read_only"` in contract
- `REDACTION_ALLOWLIST` — `allowlist` declared on every contract
- `ZOD_ENVELOPE_AT_BOUNDARY` — every client method parses raw fetch JSON through a Zod schema before returning
- `NO_LANGCHAIN_IMPORT` — tools are pure; no `@langchain/*` imports
- `USER_PARAM_IS_PROXY_WALLET` — where `user` is an input, it is validated as `0x[a-fA-F0-9]{40}`; tool description documents the proxy-vs-EOA gotcha
- `PAGINATION_CONSISTENT` — paginated outputs expose `{ count, hasMore }` derived from comparing `items.length` to `limit`
- `TIMEOUT_BOUNDED` — client inherits existing `DEFAULT_TIMEOUT_MS = 5000` via `fetchJson`; no unbounded fetches
- `NO_NEW_PORT` — research methods live on an ai-tools capability, NOT a new Port file in `nodes/poly/app/src/ports/`

**Capability location** (refinement vs original task body): one shared `PolyDataCapability` interface in `packages/ai-tools/src/capabilities/poly-data.ts` (the `capabilities/` dir already exists — uses the same shared-capability pattern as other cross-tool capabilities). NOT extending `walletCapability` (leaderboard-focused, declared per-tool). Runtime impl: a single factory at `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts` wrapping `PolymarketDataApiClient`.

**`/activity` vs `/trades`** — existing `listUserActivity` in `polymarket.data-api.client.ts` mislabels these endpoints (delegates to `listUserTrades` which hits `/trades`). That's a separate bug (task.0346's territory). This task adds a new `listActivity` method that actually hits `/activity` with its own `ActivityEventSchema`; the existing `listUserActivity` is NOT modified here.

### Per-tool table

| Tool ID                            | Input (Zod)                                                                                                                                                         | Output (Zod)                                                                                                             | Endpoint                                   | Tool-specific notes                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------- |
| `core__poly_data_positions`        | `{ user: PolyAddress, market?: string, sizeThreshold?: number≥0, limit?: int 1–200 =50, offset?: int≥0 =0 }`                                                        | `{ user, positions: PolymarketUserPosition[], count, hasMore }` (reuses existing `PolymarketUserPositionSchema`)         | `GET /positions`                           | Empty when `user` is EOA not proxy                                        |
| `core__poly_data_activity`         | `{ user, type?: enum(TRADE\|SPLIT\|MERGE\|REDEEM\|REWARD\|CONVERSION), side?: enum(BUY\|SELL), start?: int, end?: int, limit?: int 1–500 =100, offset?: int≥0 =0 }` | `{ user, events: ActivityEvent[], count, hasMore }` (new `ActivityEventSchema`, `.passthrough()`)                        | `GET /activity`                            | Lifecycle events; distinct from `/trades`                                 |
| `core__poly_data_value`            | `{ user, market?: string }`                                                                                                                                         | `{ user, valueUsdc: number, computedAt: string }` (new `UserValueSchema`)                                                | `GET /value`                               | Cheap pre-filter; excludes realized PnL                                   |
| `core__poly_data_holders`          | `{ market: string, limit?: int 1–100 =20 }`                                                                                                                         | `{ market, holders: Array<{ proxyWallet, size, outcome, userName: string \| null }>, count }` (new `MarketHolderSchema`) | `GET /holders`                             | `market` = conditionId (hex). Snapshot only                               |
| `core__poly_data_trades_market`    | `{ market: string, takerOnly?: boolean =false, limit?: int 1–500 =100, offset?: int≥0 =0 }`                                                                         | `{ market, trades: MarketTrade[], count, hasMore }` (new `MarketTradeSchema` — taker + maker addrs)                      | `GET /trades` (no `user`)                  | For counterparty harvesting, not user history                             |
| `core__poly_data_traded_events`    | `{ user, limit?: int 1–100 =20, offset?: int≥0 =0 }`                                                                                                                | `{ user, events: Array<{ eventId, eventSlug, title, numTrades, firstTradeAt, lastTradeAt }>, count, hasMore }`           | `GET /traded-events?user=`                 | Feeds category-focus analysis                                             |
| `core__poly_data_resolve_username` | `{ query: string (min 2 chars), limit?: int 1–20 =5 }`                                                                                                              | `{ profiles: Array<{ userName, proxyWallet, verified: boolean }>, count }`                                               | Gamma `GET /public-search?q=&profile=true` | Different host (`gamma-api.polymarket.com`); handle-to-address resolution |
| `core__poly_data_help`             | `{ topic?: enum(endpoints\|strategy\|gotchas) }`                                                                                                                    | `{ endpoints: Array<{ name, path, params, notes }>, discoveryStrategy: string, gotchas: string[] }`                      | **none (static)**                          | `NO_IO` — pure data; topic filter narrows the returned section            |

### Shared `PolyDataCapability` interface (Phase 2 artifact)

```ts
export interface PolyDataCapability {
  getPositions(p: {
    user: string;
    market?: string;
    sizeThreshold?: number;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataPositionsOutput>;
  listActivity(p: {
    user: string;
    type?: ActivityType;
    side?: "BUY" | "SELL";
    start?: number;
    end?: number;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataActivityOutput>;
  getValue(p: { user: string; market?: string }): Promise<PolyDataValueOutput>;
  getHolders(p: {
    market: string;
    limit?: number;
  }): Promise<PolyDataHoldersOutput>;
  listMarketTrades(p: {
    market: string;
    takerOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataMarketTradesOutput>;
  listTradedEvents(p: {
    user: string;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataTradedEventsOutput>;
  resolveUsername(p: {
    query: string;
    limit?: number;
  }): Promise<PolyDataResolveUsernameOutput>;
}
```

`core__poly_data_help` does not consume the capability — it returns a static-constants object defined in the tool module itself.

## Rate-limit & gotchas (capture in `core__poly_data_help` + client JSDoc)

- Data API is Cloudflare-throttled ~60 rpm per IP (throttled silently, not 429'd). V0 accepts the limit and observes; no client-side token bucket.
- `user` param must be **proxyWallet (Safe)**, NOT signing EOA — top cause of empty `/positions`. Document in every tool's description.
- `/leaderboard` is capped at offset=1000 — this is the core reason we need holders-based discovery.
- Gamma `/public-search?profile=true` is the handle → address resolver (different host from Data API).
- Sources referenced: `docs.polymarket.com`, shaunlebron data-api gist, `polymarket-apis` PyPI lib.

## Requirements

- **TOOL_ID_NAMESPACED** (existing invariant): each tool ID is `core__poly_data_*`.
- **EFFECT_TYPED**: all 8 new tools have `effect: "read_only"` in their contract.
- **ZOD_ENVELOPE_AT_BOUNDARY**: every new `polymarket.data-api.client.ts` method parses raw fetch response through `.safeParse()` before returning. Unexpected shapes throw a typed `VALIDATION_FAILED`-style error with structured log.
- **NO_NEW_PORT**: research capability is a shared `PolyDataCapability` in `packages/ai-tools/src/capabilities/poly-data.ts` (following the existing shared-capability pattern); no new file in `nodes/poly/app/src/ports/`. See the "Final Design — Capability location" refinement.
- **NO_LANGCHAIN_IMPORT_IN_TOOLS**: matches existing `ai-tools/tools/` pattern.
- **SINGLE_CONTRACT_SOURCE**: tool I/O types come from the contract file, never re-declared in the tool module.
- **GRAPH_PEER_NOT_NESTED**: `poly-research` is registered as a peer graph, not a subgraph invoked from poly-brain. v1 wires poly-brain → poly-research as a tool; not v0.
- **NO_DB_WRITE**: v0 is ephemeral — no Postgres / Doltgres writes. Report returned in HTTP response only.

## Allowed Changes

- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts` — **extend**, not replace
- `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` — new Zod response schemas
- `packages/ai-tools/src/tools/poly-data-*.ts` — **8 new tool files**
- `packages/ai-tools/src/tools/index.ts` — re-exports
- `packages/ai-tools/src/capabilities/poly-data.ts` — **new** shared `PolyDataCapability` interface
- `packages/ai-tools/src/capabilities/index.ts` — re-export (create if missing)
- `packages/ai-tools/src/index.ts` — re-export capability + tool names
- `packages/ai-tools/tests/poly-data-*.test.ts` — unit tests per tool
- `packages/node-contracts/src/poly.research-report.v1.contract.ts` — output contract
- `packages/node-contracts/src/index.ts` — re-export
- `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts` — **new** factory implementing `PolyDataCapability` via the Data-API client
- `nodes/poly/app/src/bootstrap/container.ts` — wire the new capability; reuse existing `PolymarketDataApiClient` singleton if present
- `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — **unchanged**
- `nodes/poly/graphs/src/graphs/poly-research/` — new dir: `graph.ts`, `prompts.ts`, `tools.ts`, `output-schema.ts`
- `nodes/poly/graphs/src/graphs/index.ts` (or equivalent registry) — register `poly-research`

**Out of bounds:** `PolyTraderWalletPort`, copy-trade tables, mirror-coordinator, anything under `nodes/poly/app/src/adapters/server/poly-trader/`, poly-brain's tool bundle (v1 job).

## Plan — 5 phases

Each phase ends green (`pnpm check:fast` clean + the phase's specific gate passes). Phase N+1 does not begin until phase N is green.

### Phase 1 — Data-API client + Zod schemas

**Milestone:** the `PolymarketDataApiClient` can reach every new endpoint and all responses parse through a Zod schema before returning.

**Invariants touched:** `ZOD_ENVELOPE_AT_BOUNDARY`, `TIMEOUT_BOUNDED`, `PACKAGES_NO_ENV`.

- [ ] Add Zod schemas in `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts`:
  - [ ] `ActivityEventSchema` + `ActivityEventTypeSchema` + `ActivityEventsResponseSchema` (`.passthrough()` — /activity shape is richer than /trades)
  - [ ] `UserValueResponseSchema` (`{ user, value }` → surfaced as `valueUsdc` in tool output)
  - [ ] `MarketHolderSchema` + `MarketHoldersResponseSchema`
  - [ ] `MarketTradeSchema` + `MarketTradesResponseSchema` (includes taker + maker addresses, distinct from `PolymarketUserTradeSchema`)
  - [ ] `TradedEventSchema` + `TradedEventsResponseSchema`
  - [ ] `GammaProfileSchema` + `GammaPublicSearchResponseSchema`
- [ ] Extend `packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`:
  - [ ] `listActivity(wallet, params)` → `GET /activity` (NOT a delegate of `listUserTrades`; new method)
  - [ ] `getValue(wallet, params)` → `GET /value`
  - [ ] `getHolders(market, params)` → `GET /holders`
  - [ ] `listMarketTrades(market, params)` → `GET /trades` (no `user` param — market-level)
  - [ ] `listTradedEvents(wallet, params)` → `GET /traded-events`
  - [ ] `resolveUsername(query, params)` — accepts `baseUrl` override for Gamma host OR new `gammaBaseUrl` config field; hits `/public-search?profile=true`
  - [ ] Every new method routes raw JSON through `Schema.parse()` at the boundary (matches existing pattern)
- [ ] Unit tests in `packages/market-provider/tests/polymarket.data-api.client.*.test.ts` (one file per method or one combined file — match existing test layout):
  - [ ] Happy path (canned JSON fixture passed via injected `fetch`)
  - [ ] Zod rejection path (malformed JSON → throws)
  - [ ] Timeout path (verify `AbortSignal` behavior) — only need one representative test
- [ ] Export all new schemas + types via `packages/market-provider/src/adapters/polymarket/index.ts`

**Gate:** `pnpm --filter @cogni/market-provider test` + `pnpm check:fast` green.

### Phase 2 — `@cogni/ai-tools` tool surface (8 tools)

**Milestone:** all 8 `core__poly_data_*` tools exist, have contracts + stub implementations + unit tests, and are exported from the package index.

**Invariants touched:** `TOOL_ID_NAMESPACED`, `EFFECT_READ_ONLY`, `REDACTION_ALLOWLIST`, `NO_LANGCHAIN_IMPORT`, `USER_PARAM_IS_PROXY_WALLET`, `PAGINATION_CONSISTENT`, `NO_NEW_PORT`.

- [ ] Create shared capability interface: `packages/ai-tools/src/capabilities/poly-data.ts`
  - [ ] `PolyDataCapability` interface with 7 methods (see "Shared capability interface" table above; `core__poly_data_help` needs nothing)
  - [ ] Export capability output types (`PolyDataPositionsOutput`, etc.) — tool modules import from here
  - [ ] Re-export from `packages/ai-tools/src/capabilities/index.ts` (create if missing)
- [ ] Create 8 new tool files in `packages/ai-tools/src/tools/` — pattern-clone `wallet-top-traders.ts`:
  - [ ] `poly-data-positions.ts` — `core__poly_data_positions`
  - [ ] `poly-data-activity.ts` — `core__poly_data_activity`
  - [ ] `poly-data-value.ts` — `core__poly_data_value`
  - [ ] `poly-data-holders.ts` — `core__poly_data_holders`
  - [ ] `poly-data-trades-market.ts` — `core__poly_data_trades_market`
  - [ ] `poly-data-traded-events.ts` — `core__poly_data_traded_events`
  - [ ] `poly-data-resolve-username.ts` — `core__poly_data_resolve_username`
  - [ ] `poly-data-help.ts` — `core__poly_data_help` (static data; no capability call)
- [ ] Each tool file exports: Zod input/output schemas, `*_NAME` const, `*Contract`, `create*Implementation(deps)`, `*StubImplementation`, `*BoundTool` — exactly matching `wallet-top-traders.ts` shape
- [ ] Every tool with a `user` input carries the proxy-vs-EOA gotcha in its `description` string (`USER_PARAM_IS_PROXY_WALLET`)
- [ ] Every paginated tool computes `hasMore = items.length >= limit` before returning (`PAGINATION_CONSISTENT`)
- [ ] Re-export from `packages/ai-tools/src/tools/index.ts` and `packages/ai-tools/src/index.ts`
- [ ] Unit tests in `packages/ai-tools/tests/poly-data-*.test.ts` (one per tool):
  - [ ] Invoke tool with stub capability; assert output parses against `outputSchema`
  - [ ] Invalid `user` address (non-hex) → tool input Zod rejects before capability called
  - [ ] For `core__poly_data_help`: assert static payload renders without any IO call

**Gate:** `pnpm --filter @cogni/ai-tools test` + `pnpm check:fast` green.

### Phase 3 — Poly-node capability impl + container wiring

**Milestone:** the deployed poly-node has a concrete `PolyDataCapability` wired into the bootstrap container, ready for any graph to consume.

**Invariants touched:** `NO_NEW_PORT`, `PACKAGES_NO_ENV`.

- [ ] Create `nodes/poly/app/src/bootstrap/capabilities/poly-research.ts`:
  - [ ] `createPolyResearchCapability(deps: { dataApiClient: PolymarketDataApiClient })` factory
  - [ ] Implements every `PolyDataCapability` method as a thin shape-mapper over the client (add `count` + `hasMore` derivation; map snake_case → camelCase where needed)
- [ ] Wire in `nodes/poly/app/src/bootstrap/container.ts`:
  - [ ] Reuse existing `PolymarketDataApiClient` singleton if present, else instantiate once
  - [ ] Bind capability into whatever registry `ai-tools` consumes (mirror how `walletCapability` is currently wired)
- [ ] Extend any existing integration test that exercises container construction to assert the new capability is non-undefined

**Gate:** `pnpm --filter @cogni/poly-app test` + `pnpm typecheck:poly` + `pnpm check:fast` green. Container boots without error in `pnpm dev:stack`.

### Phase 4 — Report contract + `poly-research` LangGraph graph

**Milestone:** `POST /api/v1/agent/execute` with `graph=poly-research` routes to a new ReAct graph whose tool bundle is the Phase 2 tools + (`core__wallet_top_traders`, `core__market_list`, `core__web_search`), and whose final-message output parses as `PolyResearchReport`.

**Invariants touched:** `GRAPH_PEER_NOT_NESTED`, `NO_DB_WRITE`, `SINGLE_CONTRACT_SOURCE`.

- [ ] Create `packages/node-contracts/src/poly.research-report.v1.contract.ts`:
  - [ ] `PolyResearchReportSchema` (Zod exactly per "Output contract" section above)
  - [ ] `PolyAddressSchema` re-used if already exported; otherwise import from existing shared location
- [ ] Re-export from `packages/node-contracts/src/index.ts`
- [ ] Create `nodes/poly/graphs/src/graphs/poly-research/`:
  - [ ] `prompts.ts` — system prompt encoding the 7-step discovery strategy
  - [ ] `tools.ts` — `POLY_RESEARCH_TOOL_IDS` array
  - [ ] `output-schema.ts` — re-exports `PolyResearchReportSchema` from node-contracts for graph use
  - [ ] `graph.ts` — `createPolyResearchGraph(opts: CreateReactAgentGraphOptions)` ReAct factory with structured output on final message (mirror `createPolyBrainGraph` shape; add `responseFormat: PolyResearchReportSchema`)
- [ ] Register the graph in whatever `poly-graphs` registry index currently lists `poly-brain`
- [ ] Component test in `nodes/poly/graphs/tests/poly-research.component.test.ts`:
  - [ ] Fixture-backed capability (canned responses for holders, positions, activity)
  - [ ] Canned LLM tool-use sequence (use the existing `FakeListChatModel` or whatever pattern poly-brain tests use)
  - [ ] Assert final message parses as `PolyResearchReport` with ≥1 candidate
  - [ ] Assert graph executes all expected tool calls in order (discovery strategy adherence)
- [ ] `core__poly_research` tool shim NOT added in this task — that's v1 (poly-brain-calls-poly-research integration)

**Gate:** `pnpm --filter @cogni/poly-graphs test` + `pnpm check` (full, not just fast) green.

### Phase 5 — Finalize

**Milestone:** docs pass, work item at `needs_closeout`, PR open.

- [ ] `pnpm check:docs` clean
- [ ] Verify the Validation block exercise + observability lines are still accurate; update if any endpoint/host/graph name drifted during implementation
- [ ] Update `work/items/_index.md` via `pnpm -s run work:index`
- [ ] `status: needs_closeout` + `updated:` date
- [ ] Commit + push
- [ ] `/closeout` — validation block verbatim in PR body; PR targeting `main`
- [ ] After merge + flight: exercise on candidate-a per Validation; flip `deploy_verified: true` via PR comment

## Validation

**exercise:**

```bash
# Against deployed candidate-a after flight:
curl -X POST https://poly-test.cognidao.org/api/v1/agent/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "graph": "poly-research",
    "input": "Research the top consistently-profitable sports-betting wallets on Polymarket with >60% win rate over the last 30d. Focus on wallets NOT in the global top-500 leaderboard."
  }'
```

**Expected:** HTTP 200 with a `PolyResearchReport`:

- ≥3 `candidates[]`
- Every `proxyWallet` is a valid 0x… address
- `methodology` references the holders+trades harvesting strategy
- `evidenceUrls[]` resolve on polymarket.com (at least one profile URL per candidate)
- `caveats[]` is non-empty

**observability:**

```
{service="poly-node-app", buildSha="<flighted-sha>"}
  |~ "core__poly_data_holders|core__poly_data_activity"
  | json
```

**Expected:** Loki returns ≥5 tool-invocation log lines from that single agent run at the deployed SHA, proving the discovery strategy ran against real Data-API endpoints.

Then flip `deploy_verified: true` via PR comment per AGENTS.md.

## Out of Scope (v1/v2 — file separate tasks after v0 validates)

**v1:**

- `fields` projection on tools (optional allowlist param for token-cost tuning).
- poly-brain invokes `poly-research` as a `core__poly_research` tool.
- In-memory 5-min cache on capability methods.
- Planner-node split inside `poly-research` (replace prompt-only strategy).

**v2 (largely covered by [task.0334](task.0334.poly-niche-research-engine.md)):**

- Dolt persistence: `poly_wallet_research` / `poly_niche_research` tables.
- Scheduled scout cron + rolling re-rank.
- EDO events feed + Brier-calibrated confidence.
- Auto-promote high-confidence candidates to `poly_copy_trade_targets` (with human gate).
- Subgraph backend for wallets with >10k fills.

## Related work

- **Replaces:** PR #997 (closed — upstream Polymarket MCP, wrong tool subset).
- **Unblocks:** [task.0334](task.0334.poly-niche-research-engine.md) — its required tools (`polymarket_top_traders_by_category`, `polymarket_wallet_trades`, etc.) are this task's `core__poly_data_*` family renamed.
- **Complements:** [task.0346](task.0346.poly-wallet-stats-data-api-first.md) — same client, different consumer (UI vs agent). Coordinate on any shared schema changes in `polymarket.data-api.types.ts`.
- **Downstream consumer:** [proj.poly-copy-trading](../projects/proj.poly-copy-trading.md) — research output feeds copy-trade target selection.

## Review Checklist

- [ ] **Work Item:** `task.0368` linked in PR body
- [ ] **Spec:** N/A (no new spec invariants; extension of existing client + capability patterns)
- [ ] **Tests:** unit per tool + one component-level graph test with fixtured Data-API responses
- [ ] **Reviewer:** assigned and approved
- [ ] **Rate-limit discipline:** agent does not hammer Data API in test fixtures; `/holders` harvesting capped at ≤200 markets per run by prompt instruction
- [ ] **Security:** no credentials / keys in tool output; all fetches read-only; no mutations

## PR / Links

-

## Attribution

-
