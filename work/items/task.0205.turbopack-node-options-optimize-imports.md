---
id: task.0205
type: task
status: needs_triage
title: "Add NODE_OPTIONS tuning + optimizePackageImports for workspace packages"
priority: 1
rank: 5
estimate: 1
summary: "Set NODE_OPTIONS max-old-space-size for dev scripts and add experimental.optimizePackageImports for @cogni/* workspace packages."
outcome: "Dev server has explicit memory ceiling; workspace barrel imports optimized by Turbopack."
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

# NODE_OPTIONS Tuning + optimizePackageImports

## Context

Per spike.0203: quick config-only wins for dev-server memory.

## Plan

1. **NODE_OPTIONS**: Add `NODE_OPTIONS="--max-old-space-size=8192"` to dev scripts in `package.json` or `.env.local.example` with documentation.

2. **optimizePackageImports**: Add to `apps/web/next.config.ts`:

   ```ts
   experimental: {
     optimizePackageImports: [
       "@cogni/ai-core",
       "@cogni/db-client",
       "@cogni/graph-execution-core",
       "@cogni/ids",
       "@cogni/langgraph-graphs",
     ],
   },
   ```

3. **Test**: Verify build still succeeds and no import resolution errors.

## Validation

```bash
pnpm check:fast
pnpm build
```
