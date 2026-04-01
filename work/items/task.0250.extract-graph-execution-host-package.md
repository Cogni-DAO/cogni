---
id: task.0250
type: task
title: "Extract @cogni/graph-execution-host package"
status: needs_implement
priority: 1
rank: 21
estimate: 3
summary: Move graph executor factory, providers, decorators, and MCP cache from apps/operator into a shared PURE_LIBRARY package
outcome: "@cogni/graph-execution-host exports all execution components; apps/operator imports from package instead of local adapters; no behavior change"
spec_refs:
  - packages-architecture-spec
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/worker-local-execution
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels:
  - ai-graphs
  - packages
external_refs:
---

# Extract @cogni/graph-execution-host package

## Context

Parent: task.0181. Step 1 of 3 in moving AI runtime out of Next.js.

Move graph execution components from `apps/operator/src/adapters/server/ai/` and `apps/operator/src/bootstrap/graph-executor.factory.ts` into `packages/graph-execution-host/`. This is a **move, not rewrite** — copy existing working logic verbatim and change only the import paths.

After this task, `apps/operator` imports from `@cogni/graph-execution-host` instead of local adapter paths. No behavior change. The internal API route still works. This enables task.0248 (scheduler-worker wiring).

## Requirements

- Package satisfies `PURE_LIBRARY` (no env vars, no ports, no process lifecycle)
- All providers take injected deps via constructor (no `serverEnv()` calls inside package)
- All decorators take injected deps via constructor (no `getContainer()` calls inside package)
- `apps/operator/src/bootstrap/` rewired to import from `@cogni/graph-execution-host`
- Dependency-cruiser passes (no `@/` imports in package, no `src/` imports)
- `pnpm check` passes with no behavior change

## Files

**Create: `packages/graph-execution-host/`**
- `src/index.ts` — public barrel export
- `src/factory.ts` — `createGraphExecutor`, `createScopedGraphExecutor` (adapted from `graph-executor.factory.ts`)
- `src/providers/inproc.provider.ts` — from `adapters/server/ai/langgraph/inproc.provider.ts`
- `src/providers/dev.provider.ts` — from `adapters/server/ai/langgraph/dev.provider.ts`
- `src/providers/sandbox.provider.ts` — lazy sandbox (from `graph-executor.factory.ts`)
- `src/providers/namespace-router.ts` — from `adapters/server/ai/langgraph/namespace-router.ts`
- `src/decorators/billing-enrichment.decorator.ts`
- `src/decorators/usage-commit.decorator.ts`
- `src/decorators/preflight-credit-check.decorator.ts`
- `src/decorators/observability-executor.decorator.ts`
- `src/execution-scope.ts` — AsyncLocalStorage scope
- `src/mcp-cache.ts` — MCP connection cache with error detection
- `package.json` — deps: `@cogni/graph-execution-core`, `@cogni/ai-core`, `@cogni/langgraph-graphs`, `@cogni/ai-tools`
- `tsconfig.json`, `tsup.config.ts`

**Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts`**
- Replace local adapter imports with `@cogni/graph-execution-host` imports
- Keep as thin wiring layer (reads `serverEnv()`, passes to package factory)

**Modify: `apps/operator/src/adapters/server/` barrel exports**
- Re-export from `@cogni/graph-execution-host` where needed for backward compat during migration

## Validation

```bash
pnpm check
```

**Expected:** All checks pass. No behavior change. Internal API route still works.
