---
id: task.0250
type: task
title: "Extract @cogni/graph-execution-host package"
status: done
priority: 1
rank: 21
estimate: 3
summary: "Extract 5 pure decorator/router classes from 4 duplicate app copies into @cogni/graph-execution-host. Delete dead BillingGraphExecutorDecorator. Package defines its own minimal port interfaces via structural typing."
outcome: "Decorators + router in shared package; 44 files deleted from apps; ~4,300 lines eliminated; no behavior change"
spec_refs:
  - packages-architecture-spec
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/task-0250-graph-execution-host
pr: https://github.com/Cogni-DAO/node-template/pull/698
reviewer:
revision: 1
blocked_by:
  - "Phase 1b: @cogni/node-shared extraction (makeLogger, EVENT_NAMES, content-scrubbing)"
deploy_verified: false
created: 2026-04-01
updated: 2026-04-03
labels:
  - ai-graphs
  - packages
external_refs:
---

# Extract @cogni/graph-execution-host package

## Context

4 apps (operator, node-template, poly, resy) each contain identical copies of 36 AI execution files in `src/adapters/server/ai/` (~6K lines each = ~20K duplicated lines). This task extracts the 5 pure decorator/router classes into a shared PURE_LIBRARY package. Also deletes the dead `BillingGraphExecutorDecorator` (superseded by `UsageCommitDecorator`, never wired in factory).

Part of task.0248 Phase 2. Enables future worker-local execution (task.0181).

## Design (approved 2026-04-02)

### What moves to package (5 classes, ~900 lines)

| Source file                           | Class                                     | Why extractable                     |
| ------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `billing-enrichment.decorator.ts`     | `BillingEnrichmentGraphExecutorDecorator` | Pure DI, no @/shared deps           |
| `usage-commit.decorator.ts`           | `UsageCommitDecorator`                    | Pure DI, injected commit fn         |
| `observability-executor.decorator.ts` | `ObservabilityGraphExecutorDecorator`     | Pure DI after OTel/Logger injection |
| `preflight-credit-check.decorator.ts` | `PreflightCreditCheckDecorator`           | Pure DI, injected check fn          |
| `aggregating-executor.ts`             | `NamespaceGraphRouter`                    | Pure routing, no state              |

### What stays in app

- `graph-executor.factory.ts` — reads `serverEnv()`, manages MCP cache singleton, composition root
- `execution-scope.ts` — used only by providers (NOT by decorators), ALS_NOT_SHARED invariant preserved
- All providers (LangGraph InProc/Dev, sandbox, platform, codex, openai-compatible)
- `InProcCompletionUnitAdapter` — features-layer completion function coupling
- All other adapters (LiteLLM, Redis, Tavily, thread persistence)
- Agent catalog infrastructure

### Dead code to delete

- `BillingGraphExecutorDecorator` — superseded by `UsageCommitDecorator` (task.0212), never wired in factory
- Its unit tests (4 files) and stack test describe string updates (4 files)
- Ghost AGENTS.md refs to non-existent `litellm.activity-usage.adapter.ts` and `litellm.usage-service.adapter.ts`
- Stale comment in `features/ai/public.server.ts` referencing dead class

### Key design decisions

1. **Package-defined port interfaces via structural typing** — the package defines minimal interfaces (`TracingPort`, `PlatformCreditChecker`, `LoggerPort`, etc.) that the app's existing implementations satisfy structurally. No need to extract app-local ports to shared packages.

2. **No `pino` dep** — `LoggerPort` with 4 methods (debug/info/warn/error) structurally compatible with pino Logger.

3. **No `@opentelemetry/api` dep** — `GetTraceIdFn = () => string` callback injected via decorator config. App provides: `() => trace.getActiveSpan()?.spanContext().traceId ?? "0000..."`.

4. **`crypto.randomUUID()` via global** — available since Node 19, repo targets Node 22. No `node:crypto` import.

5. **`PlatformCreditChecker` replaces `ModelProviderResolverPort`** — narrowed to `resolve(key).requiresPlatformCredits(ref)` which is all the decorator calls.

6. **`TracingPort` replaces `LangfusePort`** — narrowed to 3 methods the decorator actually uses. `LangfuseAdapter` satisfies it structurally.

7. **All event types from `@cogni/ai-core`** — `AiEvent`, `UsageFact`, `UsageReportEvent`, schemas are canonical there.

### Package structure

```
packages/graph-execution-host/
├── package.json               # deps: ai-core, graph-execution-core, node-shared
├── tsconfig.json              # composite, refs to dep packages
├── tsup.config.ts             # ESM, neutral platform
├── vitest.config.ts
├── AGENTS.md
├── src/
│   ├── index.ts               # barrel
│   ├── ports/
│   │   ├── logger.port.ts              # LoggerPort (4 methods, pino-compatible)
│   │   ├── tracing.port.ts             # TracingPort + CreateTraceWithIOParams + GetTraceIdFn
│   │   ├── billing-identity.ts         # BillingIdentity { billingAccountId, virtualKeyId }
│   │   ├── commit-usage-fact.ts        # CommitUsageFactFn type
│   │   └── preflight-credit-check.ts   # PreflightCreditCheckFn + PlatformCreditChecker
│   ├── decorators/
│   │   ├── billing-enrichment.decorator.ts
│   │   ├── usage-commit.decorator.ts
│   │   ├── observability-executor.decorator.ts
│   │   └── preflight-credit-check.decorator.ts
│   └── routing/
│       └── namespace-graph-router.ts
└── tests/
    ├── _helpers/usage-fact-builders.ts
    ├── billing-enrichment.decorator.spec.ts
    ├── usage-commit.decorator.spec.ts
    ├── preflight-credit-check.decorator.spec.ts
    └── namespace-graph-router.spec.ts
```

### Dependencies

```
@cogni/graph-execution-host
  ├── @cogni/graph-execution-core  (GraphExecutorPort, ExecutionContext, GraphRunRequest, etc.)
  ├── @cogni/ai-core               (AiEvent, UsageFact, UsageFactSchemas, AiExecutionErrorCode, normalizeErrorToExecutionCode, ModelRef)
  └── @cogni/node-shared           (makeLogger, EVENT_NAMES, scrubTraceInput, scrubTraceOutput, etc.)
```

## Plan

### Step 1: Dead code deletion

- [ ] Delete `billing-executor.decorator.ts` from all 4 apps (4 files)
- [ ] Delete `billing-executor-decorator.spec.ts` unit tests from all 4 apps (4 files)
- [ ] Update `internal-runs-billing.stack.test.ts` describe string in all 4 apps
- [ ] Update stale comment in `features/ai/public.server.ts` in all 4 apps
- [ ] Remove ghost AGENTS.md refs to non-existent files
- [ ] `pnpm check:fast`

### Step 2: Package scaffold

- [ ] Create `packages/graph-execution-host/` with package.json, tsconfig.json, tsup.config.ts, vitest.config.ts
- [ ] Add `"@cogni/graph-execution-host": "workspace:*"` to root package.json
- [ ] Add `{ "path": "./packages/graph-execution-host" }` to root tsconfig.json references
- [ ] Add tsup/vitest configs to `biome/base.json` noDefaultExport override
- [ ] `pnpm install`
- [ ] `pnpm packages:build` — verify scaffold compiles

### Step 3: Port interfaces + decorators + router

- [ ] Create 5 port files in `src/ports/`
- [ ] Copy 4 decorators, change imports:
  - `@/ports` → `@cogni/graph-execution-core` + `@cogni/ai-core` + local ports
  - `@/shared/observability` → `@cogni/node-shared`
  - `@/shared/ai/content-scrubbing` → `@cogni/node-shared`
  - `pino` Logger → local `LoggerPort`
  - `@opentelemetry/api` trace → `GetTraceIdFn` in config
- [ ] Copy `aggregating-executor.ts` → `routing/namespace-graph-router.ts`, change imports
- [ ] Build barrel `src/index.ts`
- [ ] `pnpm packages:build` — verify clean compile

### Step 4: Package tests

- [ ] Create `tests/_helpers/usage-fact-builders.ts`
- [ ] Port 4 test files from app tests, adapt to package imports
- [ ] `pnpm test` in package

### Step 5: Rewire consumers (all 4 apps)

- [ ] Update `adapters/server/index.ts` — remove extracted exports (4 files)
- [ ] Update `bootstrap/graph-executor.factory.ts` — import from `@cogni/graph-execution-host`, add `getTraceId` to observability config (4 files)
- [ ] Update `CommitUsageFactFn` type import in factory (4 files)

### Step 6: Delete originals

- [ ] Delete 5 source files × 4 apps = 20 files
- [ ] Delete 4 test files × 4 apps = 16 files

### Step 7: Validate

- [ ] `pnpm check:fast` during iteration
- [ ] Verify: `grep -r "@/" packages/graph-execution-host/src/` returns empty
- [ ] Verify: `grep -r "from.*pino" packages/graph-execution-host/src/` returns empty
- [ ] Verify: `grep -r "opentelemetry" packages/graph-execution-host/src/` returns empty
- [ ] `pnpm check` once before commit

## File change summary

| Action             | Count | What                                                                       |
| ------------------ | ----- | -------------------------------------------------------------------------- |
| Create             | ~18   | Package scaffold + port interfaces + decorators + tests                    |
| Delete (dead code) | 8     | BillingGraphExecutorDecorator source (4) + unit tests (4)                  |
| Delete (migrated)  | 36    | 5 source files × 4 apps (20) + 4 test files × 4 apps (16)                  |
| Modify             | ~16   | 4× barrel, 4× factory, 4× public.server.ts comment, 4× stack test describe |
| Modify (infra)     | 3     | root package.json, root tsconfig.json, biome/base.json                     |

**Net**: -44 files deleted, +18 created = **-26 files**, ~4,300 lines eliminated.

## Validation

```bash
pnpm check:fast     # during iteration
pnpm check          # once before commit
```
