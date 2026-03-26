---
id: task.0206
type: task
status: needs_triage
title: "Incremental barrel import narrowing in ports/ and shared/observability"
priority: 1
rank: 10
estimate: 3
summary: "Replace export * chains in @/shared and broad barrel imports from @/ports with direct module imports to reduce Turbopack module duplication."
outcome: "No export * in @/shared/index.ts. Routes import only the observability sub-modules they need. Dependency-cruiser rules updated if needed."
spec_refs: architecture-spec
project:
assignees: derekg1729
credit:
pr:
reviewer:
branch:
revision: 0
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [turbopack, memory, dx, tech-debt]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# Incremental Barrel Import Narrowing

## Context

Per spike.0203: `@/shared/index.ts` uses `export *` cascading 5 sub-modules, and `@/shared/observability` re-exports prom-client + pino into all consumers. This is a secondary contributor to Turbopack module duplication.

## Plan

1. **Replace `export *` in `@/shared/index.ts`** with named exports (or remove the barrel and have consumers import from specific sub-modules).

2. **Split `@/shared/observability` imports**:
   - Routes that only need `RequestContext` / `createRequestContext` should import from `@/shared/observability/context`.
   - Only the metrics endpoint and the route wrapper should import from `@/shared/observability/server`.

3. **Evaluate relaxing dep-cruiser `@/ports` entry-point rule**: Currently `@/ports` must use `index.ts`. If barrel elimination is blocked by this, add a carve-out for direct port file imports with `type` keyword.

4. **Gated on task.0204**: Only pursue this if memory is still > 3 GB after the container coupling fix.

## Validation

```bash
pnpm check   # full static checks including dep-cruiser
```
