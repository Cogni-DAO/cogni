---
id: task.0206
type: task
status: needs_triage
title: "Incremental barrel import narrowing in ports/ and shared/observability"
priority: 2
rank: 20
estimate: 3
summary: "Replace export * chains in @/shared and broad barrel imports from @/ports with direct module imports to reduce Turbopack module duplication. Gated on task.0204 measurement."
outcome: "No export * in @/shared/index.ts. Routes import only the observability sub-modules they need. Dependency-cruiser rules updated if needed."
spec_refs:
  - docs/spec/architecture.md
project:
assignees: derekg1729
credit:
pr:
reviewer:
branch:
revision: 1
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [turbopack, memory, dx, tech-debt]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# Incremental Barrel Import Narrowing

## Context

Secondary contributor to Turbopack dev memory. `@/shared/observability` barrel
re-exports prom-client metrics (~1MB) into every route that uses the logging wrapper.
`@/ports/index.ts` re-exports runtime error classes from 5+ port files.

**Gated on task.0204**: Only pursue this if RSS is still > 3GB after the container
coupling fix. The container graph (~40MB per route) is ~40× larger than the
observability barrel (~1MB per route), so this is a secondary optimization.

## Design sketch (if needed)

1. **Replace `export *` in `@/shared/index.ts`** with named exports
2. **Split `@/shared/observability` barrel**: routes needing only `RequestContext` /
   `createRequestContext` import from `@/shared/observability/context`. Only the
   metrics endpoint and route wrapper import from `@/shared/observability/server`.
3. **Dep-cruiser rule change**: Current rules enforce `@/ports/index.ts` as the entry
   point. Relaxing this for `type`-only imports from individual port files would
   require a dep-cruiser rule update with an exemption pattern.

## Gate

- [ ] task.0204 shipped and measured
- [ ] RSS still > 3GB after task.0204 → proceed
- [ ] RSS < 3GB → deprioritize to P3 tech debt

## Validation

```bash
pnpm check   # full static checks including dep-cruiser
```
