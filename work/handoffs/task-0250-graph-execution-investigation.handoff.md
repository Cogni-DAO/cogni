# Investigation: Graph Execution Package Split + Worker-Local Execution

## Your Mission

Critically analyze whether `EXECUTION_VIA_SERVICE_API` (worker delegates graph execution to Next.js via HTTP) should continue to exist, and design the correct package decomposition for graph execution code. Your deliverable is a concrete recommendation with enumerated packages, file lists, and a dependency graph.

## Background

Today's architecture: N Next.js node apps each contain the full AI execution stack (~36 identical files, ~6K lines each = ~20K duplicated). The scheduler-worker triggers graph runs via HTTP to `POST /api/internal/graphs/{graphId}/runs`. This means:

- Every node container ships ~283 MB of AI deps (LangGraph, Codex SDK, MCP, dockerode) that only exist to serve the internal API route
- Scheduled runs make an HTTP round-trip: Temporal activity → HTTP → Next.js → executor → Redis
- N nodes = N copies of identical execution code + N copies of AI dependencies

The invariant `EXECUTION_VIA_SERVICE_API` was an intentional deferral (task.0176, 2026-03-18) — not a permanent architectural decision. task.0181 already envisions retiring it.

## What You Need to Decide

### Question 1: Should `EXECUTION_VIA_SERVICE_API` be retired?

Read these files and trace the execution flow:

- `docs/spec/unified-graph-launch.md` — invariants 6 and 8
- `docs/spec/scheduler.md` — invariant 6
- `services/scheduler-worker/AGENTS.md` — execution model
- `packages/temporal-workflows/src/workflows/graph-run.workflow.ts` — the workflow
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — the internal API route
- `apps/operator/src/bootstrap/graph-executor.factory.ts` — factory wiring
- `work/items/task.0181.worker-local-execution-spike.md` — the existing plan to retire it

Evaluate:

- What does the HTTP hop cost? (latency, failure modes, connection limits, cold starts)
- Can the worker achieve per-node isolation without running inside each node's process?
- Does the worker need access to node-specific state (env, DB, credentials) or just execution config?
- What does `STREAM_PUBLISH_IN_EXECUTION_LAYER` mean if execution moves to the worker?

### Question 2: What is the correct package decomposition?

The Phase 2 design review found that the current extraction set mixes three categories:

**Category A — Pure decorators + router (~800 lines each, 6 files)**
No env, no singletons, deps injected via constructor. PURE_LIBRARY clean today (after port types are extracted).

- `BillingEnrichmentGraphExecutorDecorator`
- `UsageCommitDecorator`
- `PreflightCreditCheckDecorator`
- `ObservabilityGraphExecutorDecorator`
- `NamespaceGraphRouter`
- `BillingGraphExecutorDecorator` (possibly dead — factory uses UsageCommit instead; verify)

**Category B — Providers + adapters (~1,200 lines each, ~8 files)**
Constructors are clean but some call `makeLogger()` internally. Depend on `@/shared` utilities (needs `@cogni/node-shared`).

- `InProcCompletionUnitAdapter`
- `LangGraphInProcProvider`
- `LangGraphDevProvider` (+ client, thread store, stream-translator)
- `SandboxGraphProvider`

**Category C — Composition root + env-coupled code (~500 lines, 2 files)**
Calls `serverEnv()`, manages module singletons, imports from `./container`. NEVER belongs in a PURE_LIBRARY package.

- `graph-executor.factory.ts`
- `platform.provider.ts`

**Prerequisite: Port interfaces**
Decorators depend on types that are currently app-local in `src/ports/`:

- `LangfusePort` (in `ports/ai-telemetry.port.ts`)
- `ModelProviderResolverPort` (in `ports/model-provider-resolver.port.ts`)
- `PreflightCreditCheckFn` (in `ports/billing-context.ts`)
- `BillingContext`, `LlmService` (in `ports/billing-context.ts`, `ports/llm.port.ts`)
- `AccountService` (in `ports/accounts.port.ts`)

These need a home before any extraction. Options:

1. `@cogni/node-ports` — new package, just the port interfaces
2. Fold into existing `@cogni/graph-execution-core` — it already has executor types
3. Fold into `@cogni/node-core` — it already has domain types

**Additional dependency: `execution-scope.ts`**
Uses AsyncLocalStorage. Declares invariant `ALS_NOT_SHARED`. Used by `InProcCompletionUnitAdapter` and providers. If it stays app-local, the providers can't extract. Decide: revise the invariant or keep providers app-local.

### Question 3: One package or multiple?

Enumerate the options:

**Option A: One `@cogni/graph-execution-host`**
Everything extractable (Categories A + B) in one package. Factory stays in bootstrap.

- Pro: Simple, one dep to add
- Con: Category B deps (makeLogger, content-scrubbing) may not be in packages yet

**Option B: Narrow `@cogni/graph-execution-decorators`**
Only Category A (decorators + router). Providers stay app-local until Phase 3 absorbs them.

- Pro: Extractable today once port types have a home
- Con: Only ~2,400 lines deduped (the decorators × 3 node copies)

**Option C: Fold into existing `@cogni/graph-execution-core`**
That package currently has only types. Add implementations (decorators) there.

- Pro: No new package, capability package pattern (port + domain + adapters together)
- Con: `graph-execution-core` becomes the biggest package; "core" implies types-only

**Option D: Two packages**
`@cogni/graph-execution-core` gets port types + decorators (pure). New `@cogni/graph-execution-host` gets providers + execution-scope (the runtime pieces that need the worker). Factory stays in bootstrap.

- Pro: Clean separation of compile-time (core) vs runtime (host)
- Con: Two new packages, more wiring

### Question 4: What about per-node isolation?

If the worker runs graph execution for multiple nodes:

- How does it know which node's config to use? (LiteLLM routing, model access, billing accounts)
- Does `execution-scope.ts` (AsyncLocalStorage) provide sufficient isolation?
- Does the worker need per-node credential access, or does LiteLLM handle routing?
- Read `docs/spec/multi-node-tenancy.md` and `apps/operator/src/bootstrap/graph-executor.factory.ts` to understand how node identity flows through execution today.

## Deliverable

Write your findings as a design update to `work/items/task.0250.extract-graph-execution-host-package.md`. Include:

1. **Verdict on `EXECUTION_VIA_SERVICE_API`** — retire, keep, or conditional
2. **Recommended package decomposition** — which option (A/B/C/D/other), with file-level specifics
3. **Port type placement** — where the 6 port interfaces should live
4. **execution-scope.ts decision** — revise invariant or keep app-local
5. **BillingGraphExecutorDecorator** — dead code or not (grep the factory, check all 4 apps)
6. **Prerequisite sequence** — what must happen before implementation starts
7. **Node isolation model** — how the worker handles multi-node execution

## Files to Read

Start here (in order):

1. `docs/spec/unified-graph-launch.md` — the governing spec
2. `docs/spec/scheduler.md` — scheduler invariants
3. `work/items/task.0181.worker-local-execution-spike.md` — the retirement plan
4. `work/items/task.0250.extract-graph-execution-host-package.md` — current design + review findings
5. `apps/operator/src/bootstrap/graph-executor.factory.ts` — the composition root
6. `apps/operator/src/adapters/server/ai/` — all execution files
7. `services/scheduler-worker/` — the potential consumer
8. `docs/spec/multi-node-tenancy.md` — node isolation model
9. `packages/graph-execution-core/` — existing shared types
10. `docs/spec/packages-architecture.md` — package rules
