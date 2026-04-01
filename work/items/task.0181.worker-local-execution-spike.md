---
id: task.0181
type: task
title: "Worker-local graph execution — move AI runtime out of Next.js"
status: needs_implement
priority: 1
rank: 20
estimate: 5
summary: Move graph execution from Next.js internal API into the shared scheduler-worker via a new @cogni/graph-execution-host package, eliminating per-node AI runtime bloat
outcome: Next.js image drops ~283 MB of AI deps; graph execution runs in-process in Temporal activities; N nodes share one execution worker instead of N copies of the AI stack
spec_refs:
  - spec.unified-graph-launch
  - packages-architecture-spec
  - services-architecture-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/worker-local-execution
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-03-18
updated: 2026-04-01
labels:
  - ai-graphs
  - scheduler
external_refs:
---

# Worker-local graph execution — move AI runtime out of Next.js

## Context

task.0176 (2026-03-18) explicitly deferred worker-local execution:

> Execution stays in `apps/operator` via the existing internal API route. If worker-local execution becomes necessary later, that's a separate task with its own package (`graph-execution-host` or similar).

The multi-node deployment model (docs/spec/node-formation.md) makes this critical now:

- **Each node** gets its own Next.js app container (forked from `apps/operator`)
- **All nodes share** one scheduler-worker, one Temporal cluster, one Redis
- Currently Codex SDK alone adds ~283 MB to the Next.js image (159 MB global install + 124 MB copied `node_modules/@openai/`) — that's >30% of the 900 MB virtual image, **duplicated per node**
- AI runtime deps (LangGraph, Codex, AI tools, MCP, dockerode) have no business in a web-serving container

## Design

### Outcome

Graph execution moves from the Next.js internal API into the shared scheduler-worker. N nodes share one AI runtime instead of N copies. Next.js becomes a thin web layer (auth, SSE from Redis, thread reads/writes).

### Approach

**Solution**: Extract execution-host logic into `@cogni/graph-execution-host` (pure library package), wire it in the scheduler-worker's bootstrap. Change `executeGraphActivity` from HTTP-to-internal-API → in-process executor call. Keep Redis stream publishing (invariant `STREAM_PUBLISH_IN_EXECUTION_LAYER` moves to worker). Strip AI deps from Next.js Dockerfile.

**Reuses**:

- Existing `@cogni/graph-execution-core` ports/types (unchanged)
- Existing decorator classes (`BillingEnrichmentGraphExecutorDecorator`, `UsageCommitDecorator`, `PreflightCreditCheckDecorator`, `ObservabilityGraphExecutorDecorator`) — move to package as-is
- Existing `NamespaceGraphRouter`, `LangGraphInProcProvider`, `InProcCompletionUnitAdapter` — move to package
- Existing `createScopedGraphExecutor` factory pattern — adapt for worker context
- Existing `@cogni/langgraph-graphs`, `@cogni/ai-core`, `@cogni/ai-tools` packages (unchanged)
- Existing `RedisRunStreamAdapter` for stream publishing (unchanged)

**Rejected alternatives**:

1. **New standalone execution service**: Adds another Docker image, another compose service, another health endpoint. The scheduler-worker already runs Temporal activities with DB/Redis access — absorbing execution there avoids a new moving part.
2. **Separate Temporal task queue + execution-worker**: Proper for horizontal scaling but premature — we don't have load data justifying a second worker process. If needed later, the `@cogni/graph-execution-host` package makes this a one-PR extraction (new service, same package).
3. **Keep in Next.js, just slim the Docker image**: Doesn't solve the N-nodes-×-AI-runtime problem. The execution code path still couples availability to the web process.

### Architecture

```
BEFORE (N copies of AI runtime):
  Node A: [Next.js + AI stack (900MB)] ──HTTP──┐
  Node B: [Next.js + AI stack (900MB)] ──HTTP──┤
  Node C: [Next.js + AI stack (900MB)] ──HTTP──┤
                                                ├─→ [Scheduler-Worker (slim)]
                                                │     └─ executeGraphActivity: fetch(nodeUrl)
                                                └─→ [Temporal] [Redis] [Postgres]

AFTER (1 shared AI runtime):
  Node A: [Next.js thin (~400MB)] ─SSE/Redis──┐
  Node B: [Next.js thin (~400MB)] ─SSE/Redis──┤
  Node C: [Next.js thin (~400MB)] ─SSE/Redis──┤
                                               ├─→ [Scheduler-Worker + AI stack]
                                               │     └─ executeGraphActivity: in-process
                                               │     └─ @cogni/graph-execution-host
                                               └─→ [Temporal] [Redis] [Postgres]
```

### Key Design Decisions

**1. Package shape: `@cogni/graph-execution-host`**

A `PURE_LIBRARY` package (no process lifecycle). Contains:

- Graph executor factory (`createGraphExecutor`, `createScopedGraphExecutor`)
- All providers (InProc, Sandbox, Dev — constructors take injected deps)
- All decorators (billing, usage, preflight, observability)
- MCP connection cache
- Execution scope (`runInScope` + AsyncLocalStorage)

Does NOT contain:

- DB adapters (injected from service bootstrap)
- Redis adapter (injected)
- Environment config (service owns its env)
- Process lifecycle (no ports, no health checks)

**2. Scheduler-worker absorbs execution**

`executeGraphActivity` changes from:

```ts
// BEFORE: HTTP hop to Next.js
const response = await fetch(`${appBaseUrl}/api/internal/graphs/${graphId}/runs`, { ... });
```

to:

```ts
// AFTER: in-process via injected executor
const result = executor.runGraph(request, context);
for await (const event of result.stream) {
  await runStream.publish(runId, event);
}
```

The activity still handles: idempotency (via `execution_requests` table), billing context resolution, Redis stream publishing, thread persistence. These move from the Next.js route into the activity.

**3. Multi-node DB access**

The scheduler-worker already connects to the shared Postgres. In the current single-host model, all nodes share one Postgres instance. The execution activity receives `tenantId` (billing account) and `executionGrantId` in its input — these are sufficient to scope all DB operations.

For future multi-DB-per-node: the `@cogni/graph-execution-host` factory takes a DB client as constructor arg. The service can resolve the right client per-node at activity invocation time. This is a future concern, not part of this task.

**4. Next.js keeps: SSE, thread reads, auth**

The Next.js app retains:

- Chat completion API route (starts Temporal workflow, subscribes to Redis stream for SSE)
- Thread/conversation read endpoints
- Auth, session management, dashboard
- All UI/frontend code

The Next.js app loses:

- `/api/internal/graphs/[graphId]/runs` route (dead code after migration)
- `graph-executor.factory.ts` (moved to package)
- All AI adapter imports (`@cogni/langgraph-graphs`, `@cogni/ai-tools`, Codex SDK, etc.)
- `@openai/codex` and `@openai/codex-sdk` from Dockerfile

### Invariant Changes

| Invariant                           | Before                                      | After                                              |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `EXECUTION_VIA_SERVICE_API`         | Worker calls Next.js internal API           | **Retired** — worker executes in-process           |
| `STREAM_PUBLISH_IN_EXECUTION_LAYER` | Next.js route publishes to Redis            | Worker activity publishes to Redis (same contract) |
| `ONE_RUN_EXECUTION_PATH`            | Unchanged — all runs via `GraphRunWorkflow` | Unchanged                                          |
| `SSE_FROM_REDIS_NOT_MEMORY`         | Unchanged — Next.js reads Redis for SSE     | Unchanged                                          |

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] PURE_LIBRARY: `@cogni/graph-execution-host` has no process lifecycle, no env vars, no ports (spec: packages-architecture)
- [ ] NO_SRC_IMPORTS: Package never imports `@/` or `src/` paths (spec: packages-architecture)
- [ ] ONE_RUN_EXECUTION_PATH: All graph execution still flows through `GraphRunWorkflow` in Temporal (spec: unified-graph-launch)
- [ ] STREAM_PUBLISH_IN_EXECUTION_LAYER: Execution activity publishes all events to Redis stream (spec: unified-graph-launch)
- [ ] SSE_FROM_REDIS_NOT_MEMORY: Next.js SSE endpoint unchanged — reads Redis (spec: unified-graph-launch)
- [ ] IDEMPOTENT_RUN_START: Idempotency enforcement moves to activity but same dedup logic (spec: unified-graph-launch)
- [ ] SERVICE_ISOLATION: Scheduler-worker imports only `@cogni/*` packages, never `src/` (spec: services-architecture)
- [ ] SIMPLE_SOLUTION: Leverages existing decorator/provider code; moves, doesn't rewrite
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal pattern — ports in package, wiring in service bootstrap (spec: architecture)

### Files

<!-- Scope by sub-task. See task.0250, task.0251, task.0252 below. -->

**Create: `packages/graph-execution-host/`**

- `src/factory.ts` — `createGraphExecutor`, `createScopedGraphExecutor` (from `bootstrap/graph-executor.factory.ts`)
- `src/providers/` — InProc, Sandbox, Dev providers (from `adapters/server/ai/langgraph/`)
- `src/decorators/` — All 4 decorators (from `adapters/server/ai/`)
- `src/execution-scope.ts` — AsyncLocalStorage scope (from `adapters/server/ai/execution-scope`)
- `src/mcp-cache.ts` — MCP connection cache (from `bootstrap/graph-executor.factory.ts`)
- `src/index.ts` — public exports
- `package.json`, `tsconfig.json`, `tsup.config.ts`

**Modify: `services/scheduler-worker/`**

- `src/bootstrap/container.ts` — add execution deps (graph executor, Redis, DB adapters for execution_requests + threads)
- `src/activities/index.ts` — `executeGraphActivity` → in-process execution + Redis publish + thread persistence
- `package.json` — add `@cogni/graph-execution-host`, `@cogni/ai-tools`, `@cogni/langgraph-graphs`
- `Dockerfile` — add AI runtime deps (Codex SDK, etc.)

**Modify: `apps/operator/`**

- Remove `src/bootstrap/graph-executor.factory.ts`
- Remove `src/app/api/internal/graphs/[graphId]/runs/route.ts`
- Remove AI adapter barrel exports (langgraph, sandbox providers, decorators)
- `Dockerfile` — strip Codex SDK install + copy layers
- `package.json` — remove unused AI runtime deps

**Test:**

- `services/scheduler-worker/src/activities/__tests__/execute-graph.test.ts` — unit test in-process execution
- Existing stack tests (`sandbox-llm-roundtrip-billing.stack.test.ts` etc.) validate end-to-end unchanged

## Decomposition

This is a 3-PR sequence:

1. **task.0250**: Extract `@cogni/graph-execution-host` package (move providers, decorators, factory from `apps/operator` into package). Both Next.js and worker can import it. No behavior change yet.
2. **task.0251**: Wire execution in scheduler-worker. Change `executeGraphActivity` to in-process. Add idempotency + Redis publish + thread persistence to activity.
3. **task.0252**: Strip AI deps from Next.js. Remove internal API route, remove Codex SDK from Dockerfile, verify image size drop.

## Validation

**Per-task validation:** `pnpm check:fast` during iteration, `pnpm check` once before commit.

**End-to-end after task.0252:**

```bash
# Verify Next.js image slimmed
docker build -t cogni-template-local:latest . && docker images cogni-template-local:latest

# Verify execution still works via Temporal
pnpm dev:stack:test
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/sandbox-llm-roundtrip-billing.stack.test.ts
```

**Expected:** Next.js image drops ~283 MB (virtual). All graph execution stack tests pass via scheduler-worker path.

## Review Checklist

- [ ] **Work Item:** task.0181 linked in PR body
- [ ] **Spec:** Update `docs/spec/unified-graph-launch.md` — retire `EXECUTION_VIA_SERVICE_API`, update `STREAM_PUBLISH_IN_EXECUTION_LAYER` to reference worker
- [ ] **Tests:** Stack tests pass end-to-end through worker path
- [ ] **Reviewer:** assigned and approved

## PR / Links

- task.0250: Extract `@cogni/graph-execution-host` package
- task.0251: Wire execution in scheduler-worker
- task.0252: Strip AI deps from Next.js

## Attribution

-
