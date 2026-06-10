---
name: agent-infrastructure-expert
description: Authoritative map of Cogni's AI-agent infrastructure — the substrate that turns a LangGraph graph into a billed, observed, durably-orchestrated, deployable production agent. Use when designing/debugging the graph execution path (InProc vs LangGraph Server), the build-ship-run topology (what's in the app image, how the Temporal worker reaches a graph), evals, or deciding which of the ~14 agent specs is authoritative. Routes graph-authoring mechanics to agent-development.md and tool-authoring to tools-authoring.md; this skill owns the infrastructure altitude above them. Triggers — "how does a graph actually run in prod", "agent CI/CD", "does a new graph rebuild the worker", "InProc vs Server", "GraphExecutorPort", "where do evals stand", "which agent spec is canonical", "graph execution topology".
---

# Agent Infrastructure Expert

You own the **infrastructure altitude** of Cogni agents: how a LangGraph graph becomes a production-grade, billed, observable, durably-orchestrated, deployed agent. Graph *authoring* (factory/prompts/tools/catalog) is one tier below you — route it to `agent-development.md`. You answer: where does it run, what ships it, how is it billed/observed, and is the eval gate real.

## Mental Model — Four Planes

| Plane | What it does | Canonical doc | Built? |
| --- | --- | --- | --- |
| **Author** | Write the graph: pure factory, prompts, `toolIds`, catalog entry, `cogni-exec.ts` entrypoint | [`langgraph-patterns.md`](../../../docs/spec/langgraph-patterns.md) + [`agent-development.md`](../../../docs/guides/agent-development.md) | ✅ |
| **Execute** | Run it behind one `GraphExecutorPort` — billing, credit-preflight, observability, ALS, tool-allowlist decorators, all applied once | [`graph-execution.md`](../../../docs/spec/graph-execution.md) | ✅ |
| **Orchestrate + Ship** | Temporal triggers it durably; the graph rides the **node app image** and runs **in-proc**; the worker reaches it over HTTP | [`unified-graph-launch.md`](../../../docs/spec/unified-graph-launch.md) + [`temporal-patterns.md`](../../../docs/spec/temporal-patterns.md) | ✅ |
| **Evaluate** | Score graphs after deploy; gate promotion on quality | [`proj.ai-evals-pipeline.md`](../../../work/projects/proj.ai-evals-pipeline.md) + [`ai-evals.md`](../../../docs/spec/ai-evals.md) | 🔴 **designed, 0% built** |

## Build → Ship → Run Topology (the load-bearing fact)

There is **no separate graph artifact, and the graph package never reaches the Temporal worker.** Verified from code + catalog:

1. **Graph code ships inside the node app image.** `nodes/<node>/app` depends on `@cogni/<node>-graphs` → `@cogni/langgraph-graphs` (`workspace:*`); Next.js bundles them at build. Adding a graph = affected-only rebuild of the **app** target(s) in `pr-build.yml`. **No graph image. New graph ⇒ app rebuild only — never a worker rebuild** (`scheduler-worker` is its own `type: service` catalog target with its own deploy branches and *zero* graph deps).
2. **The Temporal worker holds no graph code, no DB creds, no LLM keys** (`SHARED_COMPUTE_HOLDS_NO_DB_CREDS`, task.0280). It is a lean durable dispatcher.
3. **The app IS the executor.** Worker activity → `POST {nodeUrl}/api/internal/graphs/:graphId/runs` (bearer `SCHEDULER_API_TOKEN`, `Idempotency-Key`, `nodeId`→URL via `COGNI_NODE_ENDPOINTS`) → the node app runs the graph in-proc via `createScopedGraphExecutor().runGraph()` and pumps events to Redis→SSE (`EXECUTION_VIA_SERVICE_API`, `STREAM_PUBLISH_IN_EXECUTION_LAYER`).

```
Temporal (schedule/webhook) → GraphRunWorkflow ─HTTP─► node app /api/internal/graphs/:id/runs
   orchestrate (no graph code)                          execute in-proc (graph in image) → Redis → SSE
```

**Known seam (the architecture's one B-grade edge):** the worker activity is a synchronous `await fetch()` that blocks for the *entire* graph and reads the decision body. So the expensive, long-running, least-idempotent unit (the LLM graph) executes **outside Temporal's durability**. App crash mid-graph ⇒ Temporal re-runs the whole graph (re-burns tokens); a multi-minute sync HTTP call is exposed to ingress/LB idle timeouts. This is deliberate and documented (graphs return *recomputable* decision artifacts; material writes happen in post-graph Activities; resume/checkpoint is a named P1 deferral). **Fine for short governance/PR-review graphs; harden to async-start→signal (or a LangGraph checkpointer) before any minutes-long agent rides it.**

## InProc ↔ LangGraph Server Alignment Scorecard

`langgraph-patterns.md` states the north-star: *"Custom InProc executor must model as closely to LangGraph Server's I/O as possible."* Where they stand today:

| Dimension | InProc (live, P0) | LangGraph Server (designed) | Aligned? |
| --- | --- | --- | --- |
| `GraphExecutorPort` | ✅ | ✅ | 🟢 same port |
| `providerId` / graphId | `langgraph` / `langgraph:<name>` | `langgraph` / `langgraph:<name>` | 🟢 backend swaps via env, not id |
| Output vocabulary | ai-core `AiEvent` | ai-core `AiEvent` | 🟢 nothing vendor-specific crosses |
| Tool events | full (`tool_call_*`) | P0: text/usage/done/error only | 🟡 InProc richer |
| `stateKey` / threads | **ignored** — no persistence | required; UUIDv5 tenant-scoped checkpoints | 🔴 divergent |
| Resume / time-travel | none (graph loss = full re-run) | native checkpointer (Redis) | 🔴 divergent |
| Billing path | stream `usage_report` → `commitUsageFact()` | async reconciliation via LiteLLM `end_user`/spend-logs | 🔴 different mechanism |
| LLM routing | `CogniCompletionAdapter` (ALS `completionFn`) | LiteLLM proxy, per-user virtual key | 🟡 different |
| Deployment | **the only live path** — bundled in app image | **not deployed** (no catalog target, no `LANGGRAPH_SERVER_URL` in any env) | 🔴 Server is paper |

**Takeaway:** InProc is production; Server is a spec with a compose file and no running instance. The alignment goal is real but the two paths diverge most exactly where durability lives (threads/resume/billing) — the same seam as above. Don't claim Server parity in any design without checking it's actually deployed.

## What's Built vs Designed-Only (don't assume)

| Capability | Status |
| --- | --- |
| InProc execution, billing, observability, credit preflight | 🟢 built |
| Temporal orchestration + HTTP-delegated graph runs | 🟢 built |
| Node-sovereign graph packages (`@cogni/<node>-graphs`) | 🟢 built |
| LangGraph Server executor | 🔴 spec + compose only, not deployed |
| **Evals — datasets, LLM-judge, CI gate, canary gate** | 🔴 **0/8; `evals/` dir does not exist; nothing gates promotion** |
| UI graph picker | 🟡 `AVAILABLE_GRAPHS` hardcoded in `ChatComposerExtras.tsx`, not from `/api/v1/ai/agents` |

## Canonical Doc Map (curation is the point — ~14 agent docs exist; lead people here)

**Read in this order; everything else is a leaf:**
1. [`graph-execution.md`](../../../docs/spec/graph-execution.md) — **the authoritative spec.** GraphExecutorPort, decorator stack, routing, catalog, ALS. Start here for execution invariants.
2. [`langgraph-patterns.md`](../../../docs/spec/langgraph-patterns.md) — package boundaries, InProc data flow, anti-patterns, tool allowlist.
3. [`unified-graph-launch.md`](../../../docs/spec/unified-graph-launch.md) — the run topology (Temporal → app → Redis → SSE). **Note: uses stale `apps/operator` paths; real path is `nodes/operator/app`.**
4. [`temporal-patterns.md`](../../../docs/spec/temporal-patterns.md) — durability boundary, webhook→workflow→graph→write pattern.
5. [`langgraph-server.md`](../../../docs/spec/langgraph-server.md) — the alternate executor (designed, not live).
6. [`ai-pipeline-e2e.md`](../../../docs/spec/ai-pipeline-e2e.md) — auth→execution→billing→security E2E reference.

**Adjacent, narrower:** `agent-discovery.md` (catalog listing), `agent-registry.md` (identity/on-chain), `ai-setup.md` (correlation IDs), `sandboxed-agents.md` (container executor), `node-baas-architecture.md` (node owns `packages/graphs`).
**Authoring tier (one level down):** [`agent-development.md`](../../../docs/guides/agent-development.md) (mechanics), [`agent-design.md`](../../../docs/guides/agent-design.md) (KPIs/paradigm), [`tools-authoring.md`](../../../docs/guides/tools-authoring.md).

## Operating Rules

- **Recall before designing.** This space is dense and partly stale — read the canonical few above before proposing anything; refine in place over adding a parallel doc (the sprawl is already the problem).
- **One executor.** All AI execution flows through `GraphExecutorPort.runGraph()`. No bypass paths. Billing/observability/credit are decorators applied once in the app bootstrap — never re-implement them in the worker.
- **`NO_LANGCHAIN_IN_SRC`.** `@langchain/*` only in `packages/langgraph-graphs/**`. App `src/**` must not import graph packages (dependency-cruiser enforced for the Server boundary).
- **Writes behind Temporal.** Graphs return recomputable decision artifacts; material/external writes live in post-graph Activities with business-key idempotency.
- **Don't overstate the eval gate.** Nothing currently scores or blocks on graph quality. Treat "eval gate" as a roadmap item, not a control.

## DRY, Drift & Consolidation — agent/langgraph cluster (verified 2026-06-09)

This cluster is the repo's worst doc-sprawl offender. Findings are evidence-backed, not impressions. **CICD docs are out of scope and on HOLD until the pipeline is green** — no edits to `ci-cd.md` / `cd-pipeline-*` / `legacy-cicd-to-remove.md`.

1. **Invariant duplication — `graph-execution.md` is SSOT; others must link, not redefine.** `GraphExecutorPort` and `AiEvent` are re-described across **all four** of graph-execution / langgraph-patterns / langgraph-server / unified-graph-launch; `PACKAGES_NO_SRC_IMPORTS` across three; `NO_LANGCHAIN_IN_SRC` across two. graph-execution already claims authority yet the others restate. → each restated invariant collapses to a one-line link.
2. **Speculative executor specs (premature abstraction — 4 draft docs for code that doesn't exist).** `claude-sdk-adapter` (*not implemented*), `n8n-adapter` (*P2, not yet*), `multi-provider-llm` (*future*), `completions-api` (*proposed*). → collapse to one "Future Executors" stub under graph-execution until one actually ships.
3. **`ai-evals.md` status lie + proj overlap.** `status: active` with a full evals charter (evals/ structure, golden format, CI gate) for a pipeline that is **0/8 built**; also fuses "AI Architecture" + "Evals". → roadmap content belongs to `proj.ai-evals-pipeline.md`; keep ai-evals arch-only or fold arch into graph-execution.
4. **Path drift.** `apps/operator` (real: `nodes/<node>/app`) in `unified-graph-launch.md`, `ai-pipeline-e2e.md`, `multi-provider-llm.md`. `../LANGGRAPH_SERVER.md` (real: `docs/spec/langgraph-server.md`) in `langgraph-patterns.md`.
5. **`agent-development.md` is operator-centric + missing ship/run.** Lead node-local `packages/graphs`; add the one Build→Ship→Run paragraph from above.
6. **Paradigm → operator knowledge Dolt.** `agent-design.md` (KPIs/paradigm) is "why we think", not a runbook. Rule that stops the next bloom: **guide = executable runbook; paradigm = knowledge entry.**

**Target shape:** ~6 core specs (graph-execution as the single invariant SSOT, + langgraph-patterns, langgraph-server, temporal-patterns, unified-graph-launch, ai-pipeline-e2e) and 3 guides (agent-development, tools-authoring, langgraph-server). Everything else links up or merges; nothing restates invariants.
