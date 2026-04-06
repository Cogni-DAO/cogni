# Handoff: task.0250 — Extract @cogni/graph-execution-host

## Prereqs

Phase 1b (`@cogni/node-shared`) must be merged to `integration/multi-node`. It provides `makeLogger`, `EVENT_NAMES`, content-scrubbing functions that the decorators import from `@/shared/`.

## What

Extract 5 pure decorator/router classes from `apps/operator/src/adapters/server/ai/` into `packages/graph-execution-host/`. Delete dead `BillingGraphExecutorDecorator`. The package is PURE_LIBRARY — no env, no process lifecycle, no `@/` imports.

## The 5 classes that move

| File                                  | Class                                     | Lines |
| ------------------------------------- | ----------------------------------------- | ----- |
| `aggregating-executor.ts`             | `NamespaceGraphRouter`                    | ~145  |
| `billing-enrichment.decorator.ts`     | `BillingEnrichmentGraphExecutorDecorator` | ~70   |
| `usage-commit.decorator.ts`           | `UsageCommitDecorator`                    | ~130  |
| `observability-executor.decorator.ts` | `ObservabilityGraphExecutorDecorator`     | ~340  |
| `preflight-credit-check.decorator.ts` | `PreflightCreditCheckDecorator`           | ~80   |

## What stays in app

Everything else: factory, execution-scope, all providers, InProcCompletionUnitAdapter, LiteLLM adapter, agent catalogs, MCP cache, Redis stream adapter, Tavily, thread persistence. These have env coupling, execution-scope coupling, or features-layer coupling.

## How to resolve `@/ports` imports (the key trick)

The decorators import `LangfusePort`, `ModelProviderResolverPort`, `PreflightCreditCheckFn` from `@/ports`. The package CAN'T import `@/ports`. Instead:

**The package defines its own minimal port interfaces.** TypeScript structural typing means the app's existing implementations satisfy them with zero wrapper code.

| Package-defined type      | Replaces                    | Why narrower                                     |
| ------------------------- | --------------------------- | ------------------------------------------------ |
| `LoggerPort` (4 methods)  | `pino.Logger`               | No pino dep                                      |
| `TracingPort` (3 methods) | `LangfusePort` (7+ methods) | Only what observability decorator calls          |
| `PlatformCreditChecker`   | `ModelProviderResolverPort` | Only `resolve(key).requiresPlatformCredits(ref)` |
| `BillingIdentity`         | `BillingContext`            | Same shape, different name                       |
| `PreflightCreditCheckFn`  | Same                        | Identical function type                          |
| `CommitUsageFactFn`       | Same                        | Identical function type                          |
| `GetTraceIdFn`            | `@opentelemetry/api` import | `() => string` callback replaces direct OTel dep |

## How to resolve `@/shared` imports

After Phase 1b, these all come from `@cogni/node-shared`:

- `makeLogger` (from `@/shared/observability`)
- `EVENT_NAMES` (from `@/shared/observability/events`)
- `scrubTraceInput`, `scrubTraceOutput`, `applyUserMaskingPreference`, `isValidOtelTraceId`, `truncateSessionId` (from `@/shared/ai/content-scrubbing`)

## Dead code to delete FIRST

`BillingGraphExecutorDecorator` (`billing-executor.decorator.ts`) is dead code — superseded by `UsageCommitDecorator` (task.0212). Never wired in `graph-executor.factory.ts`. Only imported by its own unit test.

Delete across all 4 apps:

- `src/adapters/server/ai/billing-executor.decorator.ts` (4 files)
- `tests/unit/adapters/server/ai/billing-executor-decorator.spec.ts` (4 files)

Also fix:

- `internal-runs-billing.stack.test.ts` describe string references dead class (4 files)
- `features/ai/public.server.ts:28` stale comment references dead class (4 files)
- `adapters/server/ai/AGENTS.md` ghost refs to non-existent `litellm.activity-usage.adapter.ts` and `litellm.usage-service.adapter.ts`

## Porting playbook (proven in Phase 1)

1. **Create package scaffold** — `packages/graph-execution-host/` with package.json, tsconfig.json, tsup.config.ts. Copy patterns from `packages/graph-execution-core/`.
2. **Create port interfaces** — `src/ports/` with 5 minimal interfaces.
3. **Copy decorators verbatim** — change only imports. `@/ports` → `@cogni/graph-execution-core` + `@cogni/ai-core` + local ports. `@/shared/*` → `@cogni/node-shared`. `pino` → `LoggerPort`. `@opentelemetry/api` → `GetTraceIdFn`.
4. **Build barrel** — `src/index.ts` re-exporting public surface.
5. **Wire monorepo** — root tsconfig reference, biome override, workspace dep.
6. **Port tests** — copy unit tests, adapt imports to package.
7. **Rewire consumers** — 4× barrel, 4× factory. Import from `@cogni/graph-execution-host`. Add `getTraceId` callback to observability config.
8. **Delete originals** — 5 source files × 4 apps + 4 test files × 4 apps = 36 files.
9. **Validate** — `pnpm check:fast`, then `pnpm check` once before commit.

## Gotchas from Phase 1

- **Missing deps**: Audit ALL `from "@cogni/*"` in the package source. Every one needs a `dependencies` entry in package.json AND a tsconfig `references` entry.
- **Barrel collisions**: Watch for name collisions when building barrel. Use selective re-exports.
- **Biome auto-sort**: Pre-commit hook reorders exports alphabetically.
- **Main workspace needs `packages:build`**: After merge, `pnpm packages:build` before tests pass.

## Observability decorator is the hard one

It has the most imports to rewire:

- `@opentelemetry/api` trace → `GetTraceIdFn` callback in config
- `node:crypto` randomUUID → global `crypto.randomUUID()`
- `LangfusePort` → `TracingPort` (rename + narrow)
- 5 content-scrubbing functions → `@cogni/node-shared`
- `EVENT_NAMES` → `@cogni/node-shared`
- `normalizeErrorToExecutionCode` → `@cogni/ai-core` (already there, just change import path)

Constructor signature changes:

```typescript
// Before:
constructor(inner, langfuse: LangfusePort | undefined, config, log: Logger, billingAccountId)
// After:
constructor(inner, tracing: TracingPort | undefined, config: { ...config, getTraceId?: GetTraceIdFn }, log: LoggerPort, billingAccountId)
```

The factory provides the OTel implementation:

```typescript
new ObservabilityGraphExecutorDecorator(
  preflighted,
  container.langfuse, // LangfuseAdapter satisfies TracingPort structurally
  {
    finalizationTimeoutMs: 15_000,
    getTraceId: () => trace.getActiveSpan()?.spanContext().traceId ?? "0000...",
  },
  container.log, // pino Logger satisfies LoggerPort structurally
  params.billing.billingAccountId
);
```

## Validation

```bash
pnpm check:fast     # during iteration
pnpm check          # once before commit
```

## Links

- Work item: `work/items/task.0250.extract-graph-execution-host-package.md`
- Packages spec: `docs/spec/packages-architecture.md`
- Graph execution spec: `docs/spec/graph-execution.md`
- Phase 1 playbook: `work/handoffs/task-0248-phase2-graph-execution.handoff.md`
