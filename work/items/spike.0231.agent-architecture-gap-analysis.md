---
id: spike.0231
type: spike
title: "Agent architecture gap analysis — Dify OSS benchmark + top-team practices"
status: needs_design
priority: 2
rank: 1
estimate: 1
summary: Research spike comparing cogni-template agent architecture against Dify OSS and top 0.1% production agent teams. Identifies 4 high-value changes.
outcome: Prioritized backlog of architectural improvements with designs ready for implementation
spec_refs:
assignees: derekg1729
credit:
project:
branch: design/0231-agent-architecture-gaps
pr:
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [architecture, agents, research, langgraph]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
---

# Agent Architecture Gap Analysis

## Context

Benchmarked cogni-template's agent architecture against [Dify](https://github.com/langgenius/dify) (50k+ stars, production LLM platform) and practices observed in top production agent teams (Cursor, Vercel v0, Cognition).

Dify was chosen as the gold standard for comparison because it has a mature, battle-tested agent execution engine with workflow composition, multi-tool support, and MCP integration.

## Method

Full code-level analysis of both codebases:
- Dify: `api/core/agent/`, `api/core/workflow/`, `api/core/tools/`, `api/core/mcp/`, `api/core/memory/`
- Cogni: `packages/langgraph-graphs/`, `packages/ai-tools/`, `packages/ai-core/`, `apps/web/src/adapters/server/ai/`

## Where Cogni-Template Is Ahead

| Dimension | Cogni | Dify |
|---|---|---|
| Type safety | End-to-end TS contracts, Zod at tool boundaries | Python dicts, runtime TypedDicts |
| Tool pipeline | Policy → validation → exec → redaction → billing | Flat `tool_engine.invoke()` |
| Architecture | Hexagonal ports/adapters, DI container | Monolithic services, no inversion |
| Billing | First-class decorator stack (preflight → usage → billing) | Bolt-on quota layers |
| Execution isolation | AsyncLocalStorage per-run, no shared mutable state | Thread-local + global state |
| Streaming | Redis Streams with replay (XRANGE → XREAD), typed AiEvent | Redis pub/sub fire-and-forget |

## Where Dify Has Capabilities We Lack

| Capability | Dify | Cogni | Gap Severity |
|---|---|---|---|
| Token-aware memory | TokenBufferMemory truncates by count + 500 msg limit | 200 msg hard cap, no token counting | **High** |
| Workflow-as-tool | Any workflow exposed as callable tool, call_depth tracked | No cross-graph delegation | **High** |
| Agent strategies | CoT, ReAct, Function Call, Plugin-defined | ReAct only | Low (LangGraph handles FC internally) |
| Dynamic tools | DB-backed, runtime registration | Static TOOL_CATALOG | Medium |
| RAG | Built-in knowledge base + vector store | None | Medium (use-case dependent) |
| Human-in-loop | HumanInputNode pauses workflow | No pause/resume | Medium |
| Visual workflows | Full DAG editor | Code-only | Low (code-first is valid) |

## What Top Teams Do That Neither Does Well

1. **Eval-driven development** — every agent change ships with eval suite; quality measured, not assumed
2. **Model routing with fallback** — try primary model → fallback on rate limit/timeout → queue and retry
3. **Semantic caching** — near-identical prompts hit cache, 30-60% cost reduction
4. **Output guardrails** — PII detection, hallucinated URL filtering, prompt injection defense on output
5. **Trace-driven debugging** — full replay of failed runs with every LLM call and tool invocation visible

## Recommended Changes (Priority Order)

Four changes, ~400 LOC total, each PR-sized:

### 1. Token-aware context management (`task.0232`)

**Problem:** 200-message hard cap in `thread-persistence.adapter.ts` is a time bomb. Long conversations either crash (context overflow) or silently lose critical context.

**Solution:** Count tokens per message via LiteLLM's token counting endpoint or tiktoken. Truncate oldest messages (preserving system prompt) to stay under `model_context_window - reserve`. Reserve = tool schemas + system prompt + response buffer.

**Where:** `thread-persistence.adapter.ts` loadThread(), ~100 LOC.

**Why now:** Low effort, prevents production failures, thread persistence layer is the right seam.

### 2. Graph-as-tool cross-agent delegation (`task.0233`)

**Problem:** No graph can call another graph. Browser can't delegate to Research. Brain can't invoke PR Review. The research graph does internal supervisor→researcher delegation, but that pattern is locked inside one graph.

**Solution:** `GraphTool` adapter — takes a catalog entry, wraps it as a `BoundTool` that invokes the graph via `GraphExecutorPort`. Add `call_depth` tracking (Dify's pattern: `WORKFLOW_CALL_MAX_DEPTH`) to prevent infinite recursion. Register in `TOOL_CATALOG`.

**Where:** New file `packages/ai-tools/src/tools/graph-tool.ts`, updates to `catalog.ts`, ~150 LOC.

**Dify reference:** `api/core/tools/workflow_as_tool/tool.py` lines 34-150 — `WorkflowTool` wraps workflows as tools with `call_depth` tracking.

**Why now:** Architecture already supports this — `ToolContract` + `GraphExecutorPort` + catalog. Unlocks compositional agents.

### 3. Eval framework (`task.0234`)

**Problem:** No way to measure if an agent change makes things better or worse. Shipping blind.

**Solution:** Eval harness in `tests/evals/`. Define cases as `{ input, expectedOutput, scorer }`. Scorer = LLM-as-judge or string/semantic match. Run as `pnpm test:eval`. Store results for comparison. Start with 20 cases for Brain and Research.

**Where:** New test config + eval runner, ~150 LOC scaffold.

**Why now:** Separates "demo" from "production." Every agent change after this gets measurable. Integrates with existing Vitest infra.

### 4. LLM fallback/retry in completion adapter (`task.0235`)

**Problem:** `CogniCompletionAdapter` calls LiteLLM once. Rate limit → error. Timeout → error. No retry, no fallback.

**Solution:** Retry with exponential backoff on transient errors (429, 503, timeout). Optional `configurable.fallbackModel` for model-level fallback. Can also configure at LiteLLM proxy level for zero app-code changes.

**Where:** `packages/langgraph-graphs/src/runtime/cogni/completion-adapter.ts`, ~50 LOC.

**Why now:** Cheapest reliability win. 99.5% uptime vs 95%.

## What NOT to Build

- **Visual workflow builder** — code-first is a strength
- **Plugin system** — premature, 6 tools
- **Dynamic tool registration** — static catalog fine until external users create tools
- **RAG** — build when use case demands, not speculatively
- **Multiple agent strategies** — LangGraph handles FC natively; CoT rarely wins in practice
