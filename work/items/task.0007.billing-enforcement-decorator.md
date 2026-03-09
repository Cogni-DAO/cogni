---
id: task.0007
type: task
title: "Billing enforcement decorator at GraphExecutorPort level"
status: done
priority: 1
estimate: 2
summary: Create BillingGraphExecutorDecorator (same pattern as ObservabilityGraphExecutorDecorator) that intercepts usage_report events from the stream and calls commitUsageFact(). Applied at factory level so ALL execution paths get billing automatically.
outcome: Any code path through GraphExecutorPort gets billing enforcement. RunEventRelay drops billing responsibility. bug.0005 is properly fixed by architecture, not by patching each call site.
spec_refs: graph-execution, unified-graph-launch
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch: fix/billing-enforcement-decorator
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-10
labels: [ai-graphs, billing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

## Requirements

- `BillingGraphExecutorDecorator` MUST implement `GraphExecutorPort` and intercept `usage_report` events from the stream, calling `commitUsageFact()` for each
- Decorator MUST use dependency injection for the billing function — adapters layer CANNOT import from features layer (architecture boundary)
- `RunEventRelay` MUST drop all billing responsibility (`handleBilling()`, `commitUsageFact` import, validation logic removed)
- After this change, the internal route handler's `for await` drain MUST produce `charge_receipts` with zero route-level changes (billing comes from the decorator)
- `GraphExecutorPort.runGraph()` JSDoc MUST document the caller-drain obligation: "Caller MUST consume `stream` to completion for billing side-effects to fire"
- A grep-based lint test MUST enforce that all `runGraph()` call sites consume the stream fully
- Per ONE_LEDGER_WRITER: billing path is still `commitUsageFact()` → `recordChargeReceipt()` only
- Per IDEMPOTENT_CHARGES: no change to idempotency key computation

## Allowed Changes

- `src/adapters/server/ai/billing-executor.decorator.ts` — NEW: `BillingGraphExecutorDecorator`
- `src/adapters/server/ai/index.ts` — barrel export for the new decorator
- `src/bootstrap/graph-executor.factory.ts` — wire decorator between observability and router; add `billingCommitFn` parameter
- `src/features/ai/services/ai_runtime.ts` — remove `handleBilling()` from `RunEventRelay`, remove `commitUsageFact` import
- `src/ports/graph-executor.port.ts` — add JSDoc on `runGraph()` documenting caller-drain obligation
- `src/app/_facades/ai/completion.server.ts` — create `commitFn` closure, pass to factory
- `src/app/api/internal/graphs/[graphId]/runs/route.ts` — create `commitFn` closure, pass to factory; remove inline billing from bug.0005 fix (now redundant)
- `src/types/` or `src/ports/` — define `BillingCommitFn` type if needed
- `tests/` — update RunEventRelay tests (no billing assertions), add decorator unit tests, add drain-enforcement grep test

## Problem

Billing enforcement lives in `RunEventRelay` (feature layer, `ai_runtime.ts`), which is only used by the UI chat path. Any code that calls `GraphExecutorPort.runGraph()` without wrapping in RunEventRelay gets zero billing — this is exactly what caused bug.0005 (scheduled runs bypass billing).

The pattern of "remember to wrap with billing" at every call site is error-prone. As new execution triggers are added (webhooks, API, Temporal workflows), each must independently discover and apply billing. This is the wrong level of abstraction.

## Design

Apply the **decorator pattern** at the `GraphExecutorPort` level — same approach already proven by `ObservabilityGraphExecutorDecorator`:

```
GraphExecutorPort
  └─ ObservabilityGraphExecutorDecorator (traces + Langfuse)
       └─ BillingGraphExecutorDecorator (intercepts usage_report → commitUsageFact)
            └─ NamespaceGraphRouter (routes by providerId)
                 └─ providers...
```

The `BillingGraphExecutorDecorator`:

1. Wraps the inner `GraphExecutorPort`
2. Calls `inner.runGraph(req)` to get the raw stream
3. Returns a **new stream** that transparently passes through all events but intercepts `usage_report` events and calls the injected `commitFn`
4. The consumer sees the same `AsyncIterable<AiEvent>` — billing is invisible

### Architecture: Dependency Injection for Layer Boundaries

The decorator lives in `src/adapters/server/ai/` and CANNOT import from `src/features/`. The billing function is injected at construction time:

```typescript
/** Type lives in @/types or @/ports (both importable by adapters + app) */
type BillingCommitFn = (fact: UsageFact, context: RunContext) => Promise<void>;

class BillingGraphExecutorDecorator implements GraphExecutorPort {
  constructor(
    private inner: GraphExecutorPort,
    private commitFn: BillingCommitFn,
    private log: Logger
  ) {}

  runGraph(req: GraphRunRequest): GraphRunResult {
    const result = this.inner.runGraph(req);
    return {
      stream: this.wrapStreamWithBilling(result.stream, req),
      final: result.final,
    };
  }

  private async *wrapStreamWithBilling(
    upstream: AsyncIterable<AiEvent>,
    req: GraphRunRequest
  ): AsyncIterable<AiEvent> {
    const context: RunContext = {
      runId: req.runId,
      attempt: 0, // P0: always 0
      ingressRequestId: req.ingressRequestId,
    };

    for await (const event of upstream) {
      if (event.type === "usage_report") {
        await this.commitFn(event.fact, context);
        continue; // Don't yield usage_report to consumer
      }
      yield event;
    }
  }
}
```

**Wiring**: The `app` layer (facade or route handler) creates the closure and passes it to the factory:

```typescript
// In completion.server.ts or internal route handler (app layer — CAN import features)
const billingCommitFn: BillingCommitFn = (fact, ctx) =>
  commitUsageFact(fact, ctx, accountService, log);

const executor = createGraphExecutor(executeStream, userId, billingCommitFn);
```

The factory passes it through to the decorator — factory itself never imports from features.

### RunEventRelay Impact

Once the decorator handles billing, `RunEventRelay` can drop its billing subscriber:

- Keep: pump-to-completion (BILLING_INDEPENDENT_OF_CLIENT), UI stream filtering, error protocol
- Remove: `handleBilling()`, `commitUsageFact` import, billing validation logic
- `RunEventRelay` becomes a pure UI stream adapter (which is what its name should imply)

### Caller-Drain Obligation

The decorator's billing only fires as the consumer iterates the stream. This is safe for P0 because both callers drain fully:

- UI path: `RunEventRelay.pump()` runs to completion regardless of UI disconnect
- Scheduled path: `for await (const _event of result.stream) {}` drains completely

A grep test enforces this: every `runGraph()` call site must be followed by either `RunEventRelay` or a full `for await` drain. This prevents future callers from silently skipping billing.

## Plan

- [ ] Define `BillingCommitFn` type in `src/types/` (importable by both adapters and app)
- [ ] Create `BillingGraphExecutorDecorator` in `src/adapters/server/ai/billing-executor.decorator.ts` — constructor takes `(inner, commitFn, log)`, no features imports
- [ ] Export from `src/adapters/server/ai/index.ts` barrel
- [ ] Update `createGraphExecutor()` factory signature: add `billingCommitFn: BillingCommitFn` parameter; wire decorator between observability wrapper and aggregator
- [ ] Update `completion.server.ts` facade: create `commitFn` closure binding `commitUsageFact` + `accountService` + `log`, pass to factory
- [ ] Update internal route handler: same `commitFn` closure creation, pass to factory; remove inline billing drain from bug.0005 fix
- [ ] Remove billing from `RunEventRelay`: delete `handleBilling()`, remove `commitUsageFact` import, remove schema validation for usage_report
- [ ] Add JSDoc on `GraphExecutorPort.runGraph()`: "Caller MUST consume `stream` to completion. Billing side-effects are triggered by stream iteration."
- [ ] Add grep test: `tests/stack/ai/stream-drain-enforcement.stack.test.ts` — grep for `.runGraph(` call sites, assert each is consumed by RunEventRelay or `for await`
- [ ] Add unit test: `BillingGraphExecutorDecorator` — mock inner executor emitting `usage_report`, verify `commitFn` called with correct args
- [ ] Update RunEventRelay tests: remove billing assertions, verify relay is UI-only
- [ ] Run `pnpm check` — no type errors
- [ ] Run `pnpm test` — all pass
- [ ] Run `pnpm test:stack:dev` — billing stack tests pass, scheduled runs still produce charge_receipts

## Validation

```bash
pnpm check                # lint + type + format
pnpm test                 # unit tests (decorator + relay)
pnpm test:stack:dev       # full stack tests (billing)
```

**Expected:** All pass. `RunEventRelay` no longer imports `commitUsageFact`. Scheduled runs still produce `charge_receipts` (via decorator, not inline fix).

## Review Checklist

- [ ] **Work Item:** `task.0007` linked in PR body
- [ ] **Spec:** ONE_LEDGER_WRITER, IDEMPOTENT_CHARGES, BILLING_INDEPENDENT_OF_CLIENT upheld
- [ ] **Architecture:** No `adapters → features` imports; decorator uses only DI'd `commitFn`
- [ ] **Tests:** decorator unit test, drain-enforcement grep test, updated relay tests
- [ ] **Reviewer:** assigned and approved
- [ ] **Scope:** No GraphProvider/routing changes (those are task.0006)

## PR / Links

- Handoff: [handoff](../handoffs/task.0007.handoff.md)

## Attribution

-
