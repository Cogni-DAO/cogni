---
id: task.0180
type: task
title: "Emit neutral usage facts from providers — remove billing identity from inner executor"
status: needs_implement
priority: 1
rank: 10
estimate: 2
summary: "Providers emit usage_report events without billingAccountId/virtualKeyId. A billing-aware decorator enriches events with billing identity upstream. Removes the need for AsyncLocalStorage billing scope in the static inner executor."
outcome: "Inner providers (InProc, LangGraph, Sandbox) emit neutral usage facts. Billing identity added by a decorator in the per-run wrapper layer. ExecutionScope ALS can be removed or reduced to abortSignal only."
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
created: 2026-03-16
updated: 2026-03-17
branch: fix/graph-cleanup
labels:
  - ai-graphs
  - architecture
---

# Emit Neutral Usage Facts from Providers

## Context

task.0179 introduced `AsyncLocalStorage<ExecutionScope>` to carry billing context to static inner providers that emit `usage_report` events with `billingAccountId` + `virtualKeyId`. This is a known boundary smell — providers in the pure execution layer shouldn't know about billing identity.

## Requirements

- Providers emit `usage_report` events without `billingAccountId` or `virtualKeyId`
- A per-run billing enrichment decorator (in the wrapper layer) intercepts `usage_report` events and adds billing fields before they reach the observability/billing decorators
- `ExecutionScope` ALS can be reduced to `abortSignal?` only (or removed entirely if abort is also addressed)

## Design

### Outcome

Graph execution keeps the shared port surface clean while the app runtime still records correctly-attributed billing. Launchers stop hand-carrying billing scope through feature code, and inner providers no longer depend on AsyncLocalStorage for billing identity.

### Approach

**Solution**: Split the current launch path into a static inner executor plus a per-run wrapper layer.

- The inner executor remains the reusable provider/router stack.
- Providers emit neutral `usage_report` facts with run/usage identity only.
- A new billing enrichment decorator, created per run in bootstrap, injects `billingAccountId` and `virtualKeyId` before the existing billing validator / receipt writer sees the event.
- `runGraphWithScope()` becomes the app-local launcher that composes per-run decorators and only carries truly run-local runtime context.
- `createAiRuntime()` returns to a simple executor dependency; it should not accept `BillingContext` or `runGraphWithScope()` directly.

**Reuses**:

- Existing `GraphExecutorPort` contract in `@cogni/graph-execution-core`
- Existing `BillingGraphExecutorDecorator`, `PreflightCreditCheckDecorator`, and `ObservabilityGraphExecutorDecorator`
- Existing bootstrap entrypoint in `apps/web/src/bootstrap/graph-executor.factory.ts`

**Rejected**:

- Keep ALS billing as-is: simplest short-term, but it leaves a hidden runtime precondition and spreads scope wiring into features/facades.
- Move billing identity back onto shared execution contracts: rejected because it pollutes `@cogni/graph-execution-core` with app-local billing concerns.
- Push billing resolution into every provider: rejected because it duplicates app concerns across adapter code and makes scheduler/app wiring diverge again.

### Invariants

- [ ] NO_BILLING_LEAKAGE: `@cogni/graph-execution-core` remains free of billing types and billing identity.
- [ ] BILLING_IDENTITY_OUTSIDE_INNER_EXECUTOR: Providers and stream translators emit neutral usage facts; billing identity is attached in the per-run wrapper/decorator layer. (spec: graph-execution-spec)
- [ ] EXECUTION_SCOPE_NOT_FOR_BILLING: AsyncLocalStorage must not be required to carry `billingAccountId` / `virtualKeyId`; if `ExecutionScope` survives, it is only for non-serializable runtime concerns such as `abortSignal`.
- [ ] UNIFIED_GRAPH_EXECUTOR: All launchers still execute through `GraphExecutorPort.runGraph()`. (spec: graph-execution-spec)
- [ ] SIMPLE_SOLUTION: Reuse the existing decorator stack instead of inventing a second execution abstraction.
- [ ] ARCHITECTURE_ALIGNMENT: Feature code depends on ports, not bootstrap billing primitives. (spec: architecture-spec)

### Files

- Create: `apps/web/src/adapters/server/ai/billing-enrichment.decorator.ts` — add billing identity to neutral `usage_report` events in the wrapper layer.
- Modify: `apps/web/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — emit neutral usage facts.
- Modify: `apps/web/src/adapters/server/ai/langgraph/dev/stream-translator.ts` — emit neutral usage facts.
- Modify: `apps/web/src/adapters/server/sandbox/sandbox-graph.provider.ts` — emit neutral usage facts.
- Modify: `apps/web/src/adapters/server/ai/execution-scope.ts` — remove billing from ALS scope or reduce scope to abort-only runtime data.
- Modify: `apps/web/src/bootstrap/graph-executor.factory.ts` — split static inner executor creation from per-run wrapper composition in `runGraphWithScope()`.
- Modify: `apps/web/src/features/ai/services/ai_runtime.ts` — collapse runtime deps back to an executor-only interface.
- Modify: `apps/web/src/app/_facades/ai/completion.server.ts` — stop passing billing/scope launch primitives into the feature layer.
- Modify: `apps/web/src/app/_facades/review/dispatch.server.ts` — remove inline scoped-executor wrapper.
- Modify: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — use the new launcher composition shape.
- Test: `apps/web/tests/unit/adapters/server/ai/*.test.ts` and `apps/web/tests/unit/features/ai/services/ai-runtime-relay.test.ts` — cover neutral usage facts, enrichment, and simplified runtime deps.

## Implementation Notes

- Build `createInnerGraphExecutor(...)` for static provider/router construction.
- Keep per-run decorator composition in bootstrap; do not invent a second public port.
- Land the neutral usage fact change first, then remove billing from `ExecutionScope`, then simplify feature/facade wiring.

## Validation

- `pnpm check`
- targeted unit tests around graph execution decorators and ai runtime
- targeted stack validation for chat + internal scheduled runs once implementation lands

## Allowed Changes

- `apps/web/src/adapters/server/ai/inproc-completion-unit.adapter.ts`
- `apps/web/src/adapters/server/ai/langgraph/dev/stream-translator.ts`
- `apps/web/src/adapters/server/sandbox/sandbox-graph.provider.ts`
- `apps/web/src/adapters/server/ai/execution-scope.ts`
- `apps/web/src/bootstrap/graph-executor.factory.ts`
- `apps/web/src/features/ai/services/ai_runtime.ts`
- `apps/web/src/app/_facades/ai/completion.server.ts`
- `apps/web/src/app/_facades/review/dispatch.server.ts`
- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts`
- New: billing enrichment decorator
- Tests
