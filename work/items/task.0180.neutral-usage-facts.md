---
id: task.0180
type: task
title: "Split inner executor from per-run wrapper — neutralize usage facts"
status: done
priority: 1
rank: 10
estimate: 2
summary: "Split static executor construction from per-run wrapper composition. Providers emit neutral usage_report events, a billing-aware wrapper enriches them upstream, and launchers stop building ad hoc scoped executors."
outcome: "Bootstrap owns per-run composition, launchers stop building scoped executor wrappers, inner providers emit neutral usage facts, and billing validation happens after wrapper enrichment. AsyncLocalStorage still carries tenant-scoped billing identity for provider behavior that is not part of usage fact emission."
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
created: 2026-03-16
updated: 2026-03-18
branch: fix/graph-cleanup
labels:
  - ai-graphs
  - architecture
---

# Split Inner Executor From Per-Run Wrapper

## Context

task.0179 introduced `AsyncLocalStorage<ExecutionScope>` to carry billing context to static inner providers that emit `usage_report` events with `billingAccountId` + `virtualKeyId`. It also left app launchers responsible for composing scoped wrappers around the executor. Both are the same boundary problem: billing identity and per-run composition leak outside bootstrap.

## Requirements

- Providers emit `usage_report` events without `billingAccountId` or `virtualKeyId`
- A per-run billing enrichment decorator (in the wrapper layer) intercepts `usage_report` events and adds billing fields before they reach the observability/billing decorators
- `ExecutionScope` ALS can be reduced to `abortSignal?` only (or removed entirely if abort is also addressed)

## Design

### Outcome

Graph execution keeps the shared port surface clean while the app runtime still records correctly-attributed billing. Bootstrap owns per-run composition, launchers stop building scoped executors, and inner providers no longer attach billing identity to usage facts.

### Approach

**Solution**: Split the current launch path into a static inner executor plus a per-run wrapper layer, then neutralize `usage_report` facts inside the inner executor.

- The inner executor remains the reusable provider/router stack.
- Providers emit neutral `usage_report` facts with run/usage identity only.
- A new billing enrichment decorator, created per run in bootstrap, injects `billingAccountId` and `virtualKeyId` before the existing billing validator / receipt writer sees the event.
- `runGraphWithScope()` becomes the bootstrap-owned per-run composition entrypoint. Launchers call it directly and do not construct scoped executors themselves.
- `createAiRuntime()` returns to a simple executor dependency; it should not accept `BillingContext` or `runGraphWithScope()` directly.
- AsyncLocalStorage stays in place for runtime concerns that still depend on tenant-scoped identity or abort propagation; this task does not remove it wholesale.

**Reuses**:

- Existing `GraphExecutorPort` contract in `@cogni/graph-execution-core`
- Existing `BillingGraphExecutorDecorator`, `PreflightCreditCheckDecorator`, and `ObservabilityGraphExecutorDecorator`
- Existing bootstrap entrypoint in `apps/operator/src/bootstrap/graph-executor.factory.ts`

**Rejected**:

- Keep ALS billing as-is: simplest short-term, but it leaves a hidden runtime precondition and spreads scope wiring into features/facades.
- Move billing identity back onto shared execution contracts: rejected because it pollutes `@cogni/graph-execution-core` with app-local billing concerns.
- Push billing resolution into every provider: rejected because it duplicates app concerns across adapter code and makes scheduler/app wiring diverge again.
- Remove AsyncLocalStorage entirely as part of this task: rejected as hidden extra scope. ALS should only change as much as needed to stop carrying billing identity.

### Invariants

- [x] NO_BILLING_LEAKAGE: `@cogni/graph-execution-core` remains free of billing types and billing identity.
- [x] NO_LAUNCHER_WRAPPERS: Facades and routes do not construct ad hoc scoped executors; bootstrap owns per-run wrapper composition.
- [x] BILLING_IDENTITY_OUTSIDE_INNER_EXECUTOR: Providers and stream translators emit neutral usage facts; billing identity is attached in the per-run wrapper/decorator layer. (spec: graph-execution-spec)
- [ ] EXECUTION_SCOPE_NOT_FOR_BILLING: AsyncLocalStorage still carries `billingAccountId` for tenant-scoped provider behavior (thread/session derivation, gateway session keys). This task removes billing from usage fact emission and wrapper composition but does not fully purge billing identity from ALS.
- [x] UNIFIED_GRAPH_EXECUTOR: All launchers still execute through `GraphExecutorPort.runGraph()`. (spec: graph-execution-spec)
- [x] SIMPLE_SOLUTION: Reuse the existing decorator stack instead of inventing a second execution abstraction.
- [x] ARCHITECTURE_ALIGNMENT: Feature code depends on ports, not bootstrap billing primitives. (spec: architecture-spec)

### Files

- Create: `apps/operator/src/adapters/server/ai/billing-enrichment.decorator.ts` — add billing identity to neutral `usage_report` events in the wrapper layer.
- Modify: `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — emit neutral usage facts.
- Modify: `apps/operator/src/adapters/server/ai/langgraph/dev/stream-translator.ts` — emit neutral usage facts.
- Modify: `apps/operator/src/adapters/server/sandbox/sandbox-graph.provider.ts` — emit neutral usage facts.
- Note: `apps/operator/src/adapters/server/ai/execution-scope.ts` is unchanged here; ALS still carries tenant-scoped identity for provider behavior outside usage fact emission.
- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — split static inner executor creation from per-run wrapper composition in `runGraphWithScope()`, and make bootstrap the only owner of wrapper composition.
- Modify: `apps/operator/src/features/ai/services/ai_runtime.ts` — collapse runtime deps back to an executor-only interface.
- Modify: `apps/operator/src/app/_facades/ai/completion.server.ts` — stop passing billing/scope launch primitives into the feature layer.
- Modify: `apps/operator/src/app/_facades/review/dispatch.server.ts` — remove inline scoped-executor wrapper.
- Modify: `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — use the new launcher composition shape.
- Test: `apps/operator/tests/unit/adapters/server/ai/*.test.ts` and `apps/operator/tests/unit/features/ai/services/ai-runtime-relay.test.ts` — cover neutral usage facts, enrichment, and simplified runtime deps.

## Implementation Notes

- Build `createInnerGraphExecutor(...)` for static provider/router construction.
- Keep per-run decorator composition in bootstrap; do not invent a second public port.
- Land the wrapper split first, then neutralize usage facts, then simplify feature/facade wiring.
- Do not turn this into a full ALS deletion task unless implementation proves abort handling no longer needs it.

## Validation

- [x] `pnpm check`
- [x] targeted unit tests around graph execution decorators and ai runtime
- [ ] targeted stack validation for chat + internal scheduled runs
      Stack services are not up during closeout, so this remains a manual follow-up.

## Allowed Changes

- `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts`
- `apps/operator/src/adapters/server/ai/langgraph/dev/stream-translator.ts`
- `apps/operator/src/adapters/server/sandbox/sandbox-graph.provider.ts`
- `apps/operator/src/bootstrap/graph-executor.factory.ts`
- `apps/operator/src/features/ai/services/ai_runtime.ts`
- `apps/operator/src/app/_facades/ai/completion.server.ts`
- `apps/operator/src/app/_facades/review/dispatch.server.ts`
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts`
- `apps/operator/src/adapters/server/ai/preflight-credit-check.decorator.ts`
- `apps/operator/src/adapters/server/ai/observability-executor.decorator.ts`
- `apps/operator/src/features/ai/services/billing.ts`
- `packages/ai-core/src/usage/usage.ts`
- New: billing enrichment decorator
- Tests
