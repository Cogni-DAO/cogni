---
id: task.0204
type: task
status: needs_merge
title: "Turbopack dev memory: break container coupling + expand serverExternalPackages"
priority: 0
rank: 1
estimate: 2
summary: "Eliminate the transitive import of container.ts from all 36 API routes by making the import dynamic in wrapRouteHandlerWithLogging and http/index.ts, and expand serverExternalPackages to cover heavy server-only deps."
outcome: "Dev server RSS below 3GB when navigating all routes. No static import path from route.ts → container.ts."
spec_refs:
  - docs/research/turbopack-dev-memory.md
project:
assignees: derekg1729
credit:
pr: https://github.com/Cogni-DAO/node-template/pull/635
reviewer:
branch: fix/turbopack-dev-memory
revision: 1
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [turbopack, memory, dx]
external_refs:
  - docs/research/turbopack-dev-memory.md
---

# Turbopack Dev Memory: Break Container Coupling + Expand serverExternalPackages

## Context

Next.js 16.1.7 Turbopack dev server balloons to 6GB RSS. Heap snapshot confirmed
524MB in duplicate module strings — Turbopack creates per-route module copies for
every static import chain.

**Root cause**: 36 of 46 routes import `wrapRouteHandlerWithLogging` which statically
imports `getContainer` from `@/bootstrap/container` — the DI composition root that
pulls in @temporalio/client (~12MB), drizzle-orm (~8MB), viem (~6MB), ioredis (~3MB),
langfuse (~2MB), and 15+ adapter modules. 36 routes × ~40MB transitive graph =
catastrophic duplication.

**Verified**: The wrapper only needs 3 lightweight values from container:
`config.unhandledErrorPolicy`, `log`, `clock`. The `http/index.ts` barrel adds
`config.rateLimitBypass` and `config.DEPLOY_ENVIRONMENT` (also lightweight).

## Design

### Outcome

Dev server RSS drops from ~6GB to ~2-3GB by eliminating per-route duplication of the
entire DI composition root and preventing Turbopack from bundling heavy server-only packages.

### Approach

**Solution**: Two changes, both minimal and zero-risk.

**Change 1 — Dynamic import of container in http bootstrap (primary fix)**

Replace static `import { getContainer }` with `await import()` inside the handler
function body. Both files in the http bootstrap layer are already async at the point
of use, so this is a trivial refactor.

`wrapRouteHandlerWithLogging.ts` — current (line 21, 125):

```ts
import { getContainer } from "@/bootstrap/container";
// ...inside handler:
const container = getContainer();
```

Proposed:

```ts
// No top-level import of container
// ...inside handler:
const { getContainer } = await import("@/bootstrap/container");
const container = getContainer();
```

`http/index.ts` — current (line 16, 58):

```ts
import { getContainer } from "@/bootstrap/container";
// ...inside lazy init:
const container = getContainer();
```

Proposed:

```ts
// No top-level import of container
// ...inside lazy init (already async):
const { getContainer } = await import("@/bootstrap/container");
const container = getContainer();
```

**Why this works**: Turbopack traces static imports at module graph resolution time to
build per-route bundles. Dynamic `import()` is deferred — Turbopack's lazy bundling
only resolves it when actually requested at runtime, not at compile time. This breaks
the 36× fan-out without any behavioral change (container is already lazy-initialized
at first request, not at import time).

**Why not inject config as parameters**: Would require changing the signature of
`wrapRouteHandlerWithLogging` and updating all 36 call sites. The dynamic import
approach changes 2 files, zero call sites.

**Change 2 — Expand serverExternalPackages (config-only)**

Add heavy server-only deps that shouldn't be bundled by Turbopack at all:

```ts
serverExternalPackages: [
  // existing
  "dockerode", "ssh2", "cpu-features",
  "pino", "pino-pretty",
  "tigerbeetle-node", "@cogni/financial-ledger",
  // new — heavy server-only deps
  "@temporalio/client",
  "@grpc/grpc-js",
  "ioredis",
  "drizzle-orm",
  "postgres",
  "viem",
  "langfuse",
  "prom-client",
  "posthog-node",
],
```

This provides defense-in-depth: even for routes that DO eventually need container
(via the dynamic import), these packages won't be bundled/duplicated by Turbopack.
They'll be resolved as Node.js requires at runtime instead.

**Reuses**: Existing `serverExternalPackages` pattern already proven for dockerode/ssh2/pino.

**Rejected alternatives**:

- **Inject config as parameters**: Touches 36 call sites for no benefit over dynamic import
- **Route consolidation (catch-all handlers)**: High effort, breaks Next.js conventions, risky
- **NODE_OPTIONS tuning**: Symptom management, doesn't reduce actual memory — pruned (was task.0205)
- **optimizePackageImports**: Known broken for pnpm workspace symlinks (vercel/next.js#75148) — pruned

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_STATIC_CONTAINER_IN_HTTP: No static `import ... from "@/bootstrap/container"` in `bootstrap/http/` files. All container access must use dynamic `import()` inside async function bodies.
- [ ] SERVER_EXTERNAL_COMPLETE: All packages >1MB that are server-only must be in `serverExternalPackages`
- [ ] ZERO_CALL_SITE_CHANGES: Route handler files (route.ts) must not change — the fix is internal to the wrapper
- [ ] BEHAVIORAL_PARITY: Container lazy-init timing unchanged — first request triggers init, not module import (already true, design preserves it)
- [ ] DEP_CRUISER_GREEN: `.dependency-cruiser.cjs` rules must pass — `bootstrap/http/` can import `bootstrap/container` (allowed by existing rules)
- [ ] SIMPLE_SOLUTION: Two files changed + one config expansion. No new abstractions.
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layering — bootstrap layer still wires adapters to ports (spec: architecture)

### Files

- Modify: `apps/web/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — replace static container import with dynamic import() inside handler body
- Modify: `apps/web/src/bootstrap/http/index.ts` — replace static container import with dynamic import() inside lazy init block
- Modify: `apps/web/next.config.ts` — expand serverExternalPackages list
- Test: `pnpm check:fast` — type + lint + unit tests (no new test files needed; existing route tests cover wrapper behavior)

### Measurement

After shipping, measure dev-server RSS:

1. Start `pnpm dev`
2. Visit all 46 routes (or a representative subset)
3. Check `process.memoryUsage().rss` via inspector or Activity Monitor
4. **Target**: RSS < 3GB (down from 6GB)
5. If RSS > 3GB, barrel narrowing (task.0206) becomes P0

## Validation

```bash
pnpm check:fast   # during iteration
pnpm check        # once before commit
```
