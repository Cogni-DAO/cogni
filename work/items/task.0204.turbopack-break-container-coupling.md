---
id: task.0204
type: task
status: needs_triage
title: "Break container.ts import coupling in wrapRouteHandlerWithLogging + expand serverExternalPackages"
priority: 0
rank: 1
estimate: 2
summary: "Eliminate the transitive import of container.ts from all 42 API routes by making the import dynamic in wrapRouteHandlerWithLogging, and expand serverExternalPackages to cover heavy server-only deps."
outcome: "Dev server RSS below 3GB when navigating all routes. No static import path from route.ts to container.ts."
spec_refs:
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
labels: [turbopack, memory, dx]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# Break container.ts Import Coupling + Expand serverExternalPackages

## Context

Per spike.0203: the single biggest memory contributor is that `wrapRouteHandlerWithLogging` statically imports `getContainer` from `@/bootstrap/container`, causing Turbopack to bundle the entire adapter/infra dependency tree into all 42 routes.

## Plan

1. **Make container import dynamic** in `apps/web/src/bootstrap/http/wrapRouteHandlerWithLogging.ts`:
   - Change `import { getContainer } from "@/bootstrap/container"` to a dynamic `import()` inside the handler function body.
   - Alternatively, inject the config (unhandledErrorPolicy) as a parameter instead of reaching into the container.

2. **Expand serverExternalPackages** in `apps/web/next.config.ts`:
   - Add: `@temporalio/client`, `@grpc/grpc-js`, `ioredis`, `drizzle-orm`, `postgres`, `viem`, `langfuse`, `prom-client`, `posthog-node`, `next-auth`

3. **Measure**: Log `process.memoryUsage().rss` after visiting all 46 routes in dev mode. Target: < 3 GB.

## Validation

```bash
pnpm check:fast   # no regressions
pnpm dev           # measure RSS manually
```
