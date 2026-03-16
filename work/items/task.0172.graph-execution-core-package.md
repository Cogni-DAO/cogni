---
id: task.0172
type: task
title: "Extract packages/graph-execution-core — decouple execution ports from Next.js"
status: needs_closeout
priority: 0
rank: 1
estimate: 3
summary: "Create packages/graph-execution-core with GraphExecutorPort, RunStreamPort, ExecutionContext. Move Message to ai-core. Kill LlmCaller from shared surface. Billing via injected resolver. Tracing via OTel propagation."
outcome: "scheduler-worker and future launchers import GraphExecutorPort/RunStreamPort from @cogni/graph-execution-core. GraphRunRequest is pure business input. No billing, tracing, or delivery-layer leakage on shared contracts."
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by: []
created: 2026-03-13
updated: 2026-03-14
branch: claude/unified-graph-launch-mmXvl
labels:
  - ai-graphs
  - scheduler
  - architecture
---

# Extract `packages/graph-execution-core`

## Context

task.0169 checkpoint 2 (GraphRunWorkflow) is blocked: scheduler-worker cannot import `GraphExecutorPort` from `apps/web/src/` — dep-cruiser enforces `PACKAGES_NO_SRC_IMPORTS`.

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
  // NO requestId (HTTP edge correlation — stays in app-layer logs/interceptors)
  // NO abortSignal (browser disconnect ≠ durable run cancellation;
  //   Temporal uses Context.current().cancellationSignal)
}

interface GraphExecutorPort {
  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult;
}
```

### Key design decisions

1. **GraphRunRequest = pure business input.** No billing, no tracing, no delivery-layer concerns.
2. **ExecutionContext = per-run cross-cutting metadata.** Tiny, typed, passed as second arg.
3. **AbortSignal on ExecutionContext, not GraphRunRequest.** It's HTTP/delivery leakage, not durable run input.
4. **requestId on ExecutionContext, not collapsed into runId.** Different axes: observability correlation vs durable execution identity.
5. **traceId via OTel context propagation.** Temporal SDK propagates via headers. Adapters use `getCurrentTraceId()`. Never on any shared interface.
6. **Billing via injected BillingResolver.** `(actorUserId) => { billingAccountId, virtualKeyId }`. Injected at factory construction (static dep). Resolved per-run from `ctx.actorUserId`.
7. **Factory is static, per-run context via runGraph(req, ctx).** `createGraphExecutor(staticDeps)` once, not per-request.
8. **LlmCaller dies from shared surface.** Stays in `llm.port.ts` for direct `LlmService` calls only.
9. **Message → ai-core.** Clean LLM message type, no app baggage.

### Concern migration

| Field              | Current                               | New                                                                                     |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `billingAccountId` | `req.caller`                          | `BillingResolver.resolve(ctx.actorUserId)` — app layer only                             |
| `virtualKeyId`     | `req.caller`                          | Same resolver                                                                           |
| `traceId`          | `req.caller`                          | `getCurrentTraceId()` from OTel context                                                 |
| `requestId`        | `req.caller` / `req.ingressRequestId` | App-layer logs/interceptors only — not on any shared type                               |
| `userId`           | `req.caller`                          | `ctx.actorUserId`                                                                       |
| `sessionId`        | `req.caller`                          | `ctx.sessionId`                                                                         |
| `maskContent`      | `req.caller`                          | `ctx.maskContent`                                                                       |
| `abortSignal`      | `req.abortSignal`                     | App-layer decorator scope — not on shared contract (Temporal uses its own cancellation) |

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
pnpm test
```
