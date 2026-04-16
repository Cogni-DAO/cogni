---
id: task.0179
type: task
title: "Extract packages/graph-execution-core — decouple execution ports from Next.js"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "Create packages/graph-execution-core with GraphExecutorPort, RunStreamPort, ExecutionContext. Move Message to ai-core. Kill LlmCaller from shared surface. Billing via injected resolver. Tracing via OTel propagation."
outcome: "scheduler-worker and future launchers import GraphExecutorPort/RunStreamPort from @cogni/graph-execution-core. GraphRunRequest is pure business input. No billing, tracing, or delivery-layer leakage on shared contracts."
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
credit:
blocked_by: []
created: 2026-03-13
updated: 2026-03-24
branch: claude/unified-graph-launch-mmXvl
pr: https://github.com/Cogni-DAO/node-template/pull/574
reviewer:
revision: 0
deploy_verified: false
labels:
  - ai-graphs
  - scheduler
  - architecture
external_refs:
---

# Extract `packages/graph-execution-core`

## Context

task.0176 checkpoint 2 (GraphRunWorkflow) is blocked: scheduler-worker cannot import `GraphExecutorPort` from `apps/operator/src/` — dep-cruiser enforces `PACKAGES_NO_SRC_IMPORTS`.

## Design (finalized 2026-03-14, after 3 rounds of architect review)

### Shared port signature

```typescript
// @cogni/graph-execution-core
interface GraphRunRequest {
  readonly runId: string;
  readonly graphId: GraphId;
  readonly messages: Message[];
  readonly model: string;
  readonly stateKey?: string;
  readonly toolIds?: readonly string[];
  readonly responseFormat?: { prompt?: string; schema: unknown };
  // NO abortSignal, NO caller, NO ingressRequestId
}

interface ExecutionContext {
  readonly actorUserId?: string;
  readonly sessionId?: string;
  readonly maskContent?: boolean;
  readonly requestId?: string;
  // NO billing fields, NO traceId, NO abortSignal
}

interface GraphExecutorPort {
  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult;
}
```

### Key design decisions

1. **GraphRunRequest = pure business input.** No billing, no tracing, no delivery-layer concerns.
2. **ExecutionContext = per-run cross-cutting metadata.** Tiny, typed, passed as second arg.
3. **requestId on ExecutionContext.** Launcher correlation ID is distinct from `runId` (durable execution identity) and `traceId` (OTel propagation).
4. **AbortSignal stays out of shared contracts.** Browser disconnect is delivery-layer concern, not durable run input; current app runtime carries abort via `ExecutionScope`, not `GraphRunRequest`/`ExecutionContext`.
5. **traceId via OTel context propagation.** Temporal SDK propagates via headers. Adapters use `getCurrentTraceId()`. Never on any shared interface.
6. **Billing stays out of shared contracts.** Current runtime wiring uses app-layer `runGraphWithScope()` + `AsyncLocalStorage<ExecutionScope>` so inner executors can read billing without polluting `@cogni/graph-execution-core`. Cleanup is deferred to task.0180.
7. **Factory is static, per-run context via `runGraph(req, ctx)`.** `createGraphExecutor(staticDeps)` is reused; `runGraphWithScope()` is the app-layer launcher wrapper for per-run scope.
8. **LlmCaller dies from shared surface.** Stays in `llm.port.ts` for direct `LlmService` calls only.
9. **Message → ai-core.** Clean LLM message type, no app baggage.

### Concern migration

| Field              | Current                               | New                                                                             |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------- |
| `billingAccountId` | `req.caller`                          | `ExecutionScope.billing.billingAccountId` via app-layer `runGraphWithScope()`   |
| `virtualKeyId`     | `req.caller`                          | `ExecutionScope.billing.virtualKeyId` via app-layer `runGraphWithScope()`       |
| `traceId`          | `req.caller`                          | `getCurrentTraceId()` from OTel context                                         |
| `requestId`        | `req.caller` / `req.ingressRequestId` | `ctx.requestId`                                                                 |
| `userId`           | `req.caller`                          | `ctx.actorUserId`                                                               |
| `sessionId`        | `req.caller`                          | `ctx.sessionId`                                                                 |
| `maskContent`      | `req.caller`                          | `ctx.maskContent`                                                               |
| `abortSignal`      | `req.abortSignal`                     | `ExecutionScope.abortSignal` in app-layer wrapper only — not on shared contract |

## Plan

- [x] **Checkpoint 1: Move Message to ai-core**
- [x] **Checkpoint 2: Create graph-execution-core package**
- [x] **Checkpoint 3: Port signature migration** (decorators, adapters, factory, facade)
- [x] **Checkpoint 4: Wire scheduler-worker dep**
- [x] **Checkpoint 5: Clean up** (AGENTS.md, spec pointers, task status)

See plan file for detailed checkpoint breakdown.

## Validation

```bash
pnpm check
pnpm dotenv -e .env.test -- vitest run --config apps/operator/vitest.stack.config.mts
```

Manual validation:

- Local chat/e2e run succeeds after `runGraphWithScope()` wiring
- Full stack suite passes on branch before merge
