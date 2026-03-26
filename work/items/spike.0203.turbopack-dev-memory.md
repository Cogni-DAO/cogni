---
id: spike.0203
type: spike
status: done
title: "Research: Turbopack dev-mode memory bloat"
priority: 0
rank: 1
estimate: 1
summary: "Research spike identifying root causes of 6GB RSS in Next.js Turbopack dev server and proposing mitigation options."
outcome: "Research document with 6 mitigation options, 3 follow-up tasks, and measurement plan."
spec_refs:
project:
assignees: derekg1729
credit:
pr:
reviewer:
branch: feat/byo-ai-per-tenant
revision: 0
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [turbopack, memory, dx]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# Research: Turbopack Dev-Mode Memory Bloat

## Summary

Completed research spike on why the Next.js 16.1.7 Turbopack dev server balloons to 6 GB RSS.

## Key Findings

1. **container.ts mega-import** -- 42/46 routes transitively import the entire DI container (Temporal, drizzle, viem, ioredis, langfuse, etc.) via `wrapRouteHandlerWithLogging`. This is the primary duplication vector.
2. **Incomplete serverExternalPackages** -- only 8 packages externalized; heavy server deps like `@temporalio/client`, `ioredis`, `drizzle-orm`, `viem` are bundled and duplicated per-route.
3. **Barrel export \* chains** -- `@/shared/index.ts` and `@/shared/observability` pull prom-client + pino into every consumer.
4. **No optimizePackageImports** -- workspace packages not optimized for barrel tree-shaking.

## Follow-up Tasks

- task.0204: Break container.ts import coupling + expand serverExternalPackages
- task.0205: NODE_OPTIONS tuning + optimizePackageImports config
- task.0206: Incremental barrel import narrowing (tech debt)

## Validation

Research document: [docs/research/turbopack-dev-memory.md](../../docs/research/turbopack-dev-memory.md)
