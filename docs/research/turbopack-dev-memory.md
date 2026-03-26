---
id: turbopack-dev-memory
type: research
title: "Turbopack Dev-Mode Memory Bloat — Root Causes and Mitigation Options"
status: active
trust: reviewed
verified: 2026-03-26
summary: "Research spike on 6GB RSS in Next.js 16 Turbopack dev server — duplicate module copies across 46 API routes, container.ts mega-import fan-out, and barrel file export * chains."
read_when: "Investigating dev server memory, optimizing Turbopack bundling, or reducing cold-start compile times."
owner: derekg1729
created: 2026-03-26
tags: [turbopack, memory, performance, dx]
---

# Research: Turbopack Dev-Mode Memory Bloat

> spike: spike.0203 | date: 2026-03-26

## Question

Why does the Next.js 16.1.7 Turbopack dev server balloon to 6 GB RSS, and what
codebase-level changes can bring it below 2 GB without switching back to Webpack?

## Context

A heap snapshot of the dev server (port 3000) revealed:

- **524 MB in strings alone** -- 60%+ of heap is duplicate Turbopack module chunks.
- **46 API route files** under `apps/web/src/app/api/`, each receiving its own copy of
  transitive dependencies.
- Duplicate modules observed: zod (7 copies), uuid (3), @babel/runtime (4),
  class-variance-authority (2).
- `accounts.port.ts` (327 lines) appears as a 19.3 MB string -- pulled into many routes.
- The 6 GB spike was GC thrashing from retained duplicate module copies, not a
  traditional memory leak.

This is a known Turbopack issue (vercel/next.js #66326, #75142, #81161, #82512):
Turbopack isolates each route entry point and retains per-route module copies in
memory. With 46 routes and a deep transitive import graph, the combinatorial
explosion is severe.

## Findings

### Root Cause 1: `container.ts` mega-import fan-out (CRITICAL)

**36 of 46 routes** import `@/bootstrap/http` (via `wrapRouteHandlerWithLogging`).
This module imports `@/bootstrap/container`, which is the DI composition root. The
container file (`apps/web/src/bootstrap/container.ts`) directly imports:

| Import                                  | Weight | Notes                        |
| --------------------------------------- | ------ | ---------------------------- |
| `@temporalio/client`                    | ~12 MB | gRPC, protobuf, heavy native |
| `drizzle-orm` + `@cogni/db-client`      | ~8 MB  | Schema, query builder        |
| `viem`                                  | ~6 MB  | EVM client, ABI codec        |
| `ioredis`                               | ~3 MB  | Redis client                 |
| `langfuse`                              | ~2 MB  | Observability SDK            |
| `prom-client`                           | ~1 MB  | Prometheus metrics           |
| `@cogni/langgraph-graphs`               | ~4 MB  | All graph definitions        |
| `@cogni/financial-ledger`               | ~2 MB  | TigerBeetle adapter          |
| `@cogni/operator-wallet/adapters/privy` | ~3 MB  | Privy SDK                    |

**Every route bundles ALL of these** even if it only needs auth + JSON response.
Because Turbopack creates per-route module copies, 36 routes x ~40 MB transitive
graph = potential for ~1.4 GB in duplicated modules before GC pressure even starts.

**File**: `apps/web/src/bootstrap/container.ts` (lines 1-722)
**File**: `apps/web/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` (line 23: `import { getContainer } from "@/bootstrap/container"`)

### Root Cause 2: `@/ports/index.ts` barrel re-exports 28 port modules

The ports barrel (`apps/web/src/ports/index.ts`) has 28 export statements covering
~20 port files. While these are mostly type-only exports (which should be
tree-shakeable), Turbopack in dev mode does not fully tree-shake barrel re-exports.
The barrel pulls in runtime exports from:

- `accounts.port.ts` (error classes: `BillingAccountNotFoundPortError`, etc.)
- `llm.port.ts` (error class: `LlmError`, classifier functions)
- `payment-attempt.port.ts` (error classes)
- `thread-persistence.port.ts` (error class: `ThreadConflictError`)

5 routes import `@/ports` directly, but the barrel is also pulled transitively by
features and facades that routes import.

**File**: `apps/web/src/ports/index.ts`

### Root Cause 3: `@/shared` uses `export *` cascades

`apps/web/src/shared/index.ts` uses five `export *` re-exports:

```
export * from "./constants"
export * from "./env"
export * from "./errors"
export * from "./observability"
export * from "./util"
```

The `observability` sub-barrel further re-exports `prom-client` (via `./server/metrics`)
and `pino` (via `./server/logger`). While only 2 files import `@/shared` directly,
20 routes import `@/shared/observability` which pulls the full metrics + logging stack.

**File**: `apps/web/src/shared/index.ts`
**File**: `apps/web/src/shared/observability/index.ts`
**File**: `apps/web/src/shared/observability/server/metrics.ts` (imports `prom-client`)

### Root Cause 4: No `optimizePackageImports` configured

The `next.config.ts` has no `experimental.optimizePackageImports` setting. While
Turbopack claims automatic barrel optimization, there is a known open issue
(vercel/next.js #75148) where this does not work for local workspace packages
(which is exactly our case with `@cogni/*` packages).

**File**: `apps/web/next.config.ts`

### Root Cause 5: `serverExternalPackages` incomplete

The current config externalizes only 8 packages:

```ts
serverExternalPackages: [
  "dockerode",
  "ssh2",
  "cpu-features",
  "pino",
  "pino-pretty",
  "tigerbeetle-node",
  "@cogni/financial-ledger",
];
```

Missing candidates that are server-only and heavy:

- `@temporalio/client` (~12 MB, gRPC native)
- `ioredis` (~3 MB)
- `drizzle-orm` (~8 MB transitive)
- `viem` (~6 MB)
- `langfuse` (~2 MB)
- `prom-client` (~1 MB)
- `@grpc/grpc-js` (transitive from Temporal)

Since Next.js 16.1 fixed Turbopack resolution of transitive `serverExternalPackages`,
adding these would prevent Turbopack from bundling (and duplicating) them entirely.

## Options

### Option A: Expand `serverExternalPackages` (Quick Win)

**Effort**: Small (config change only)
**Impact**: Medium -- prevents Turbopack from bundling heavy server-only deps,
reducing per-route module duplication.

Add to `next.config.ts`:

```ts
serverExternalPackages: [
  // existing
  "dockerode",
  "ssh2",
  "cpu-features",
  "pino",
  "pino-pretty",
  "tigerbeetle-node",
  "@cogni/financial-ledger",
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
  "next-auth",
];
```

**Risk**: Low. These are all server-only. If a client component accidentally imports
one, the build will fail loud (good -- it surfaces the bug).

### Option B: Break the `container.ts` → route coupling (High Impact)

**Effort**: Medium (refactor `wrapRouteHandlerWithLogging`)
**Impact**: High -- the single biggest win. Breaking the import chain from route
wrapper to container eliminates the transitive fan-out of ALL adapters into ALL routes.

**Approach**: `wrapRouteHandlerWithLogging` imports `getContainer` only for
`config.unhandledErrorPolicy` (line 23). This can be resolved by:

1. **Lazy import**: Change `import { getContainer }` to `const { getContainer } = await import("@/bootstrap/container")` inside the handler function body (not module scope). Turbopack will not trace dynamic imports at module resolution time.
2. **Inject config**: Pass the error policy as a parameter to the wrapper instead of reaching into the container. The container is already initialized lazily at first request, but the static import forces Turbopack to bundle it for every route at compile time.

**Risk**: Low. The container is already lazy-initialized at runtime. Making the import
dynamic just defers the bundling to runtime too.

### Option C: Barrel import elimination / narrowing

**Effort**: Medium-Large (many files to update)
**Impact**: Medium -- reduces the surface area of what each route pulls in.

**Approach**:

1. Replace `import { ... } from "@/ports"` with direct imports: `import type { AccountService } from "@/ports/accounts.port"`.
2. Replace `export *` in `@/shared/index.ts` with named exports.
3. Split `@/shared/observability` into `@/shared/observability/context` (pure, lightweight) and `@/shared/observability/server` (pino + prom-client). Routes that only need `RequestContext` and `createRequestContext` should import from the lightweight path.

**Risk**: Medium. Many files to touch, risk of import path churn. Dependency-cruiser
rules currently enforce `@/ports` must use `index.ts` (blocks internal port files),
so relaxing that rule is a prerequisite.

### Option D: `NODE_OPTIONS` tuning

**Effort**: Tiny (env var change)
**Impact**: Low -- symptom management, not root cause. Prevents OOM kills but
does not reduce actual memory usage.

Set `NODE_OPTIONS="--max-old-space-size=8192"` in `.env.local` or dev scripts.
Next.js docs recommend this for large projects. Combined with
`--experimental-debug-memory-usage` for diagnostics.

**Risk**: None. Just adjusts GC thresholds.

### Option E: Route consolidation (catch-all patterns)

**Effort**: Large (route architecture change)
**Impact**: Medium-High -- fewer entry points means fewer module copies.

**Approach**: Consolidate related route groups behind catch-all handlers. For example,
the 12 attribution epoch routes under `/api/v1/attribution/epochs/[id]/*` could become
a single `[...action]/route.ts` with internal dispatch. This would reduce 12 Turbopack
entry points to 1.

**Risk**: High. Breaks Next.js file-system routing conventions, makes routes harder
to discover, and requires manual parameter parsing.

### Option F: `optimizePackageImports` for workspace packages

**Effort**: Small (config change)
**Impact**: Low-Medium -- helps Turbopack tree-shake barrel re-exports from
`@cogni/*` packages.

Add to `next.config.ts`:

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

**Risk**: Low. Known issue (vercel/next.js #75148) may limit effectiveness for
symlinked workspace packages. Worth trying but may not help.

## Recommendation

Execute in this order (highest impact per effort first):

1. **Option B** (break container coupling) -- single highest-impact change. One PR.
2. **Option A** (expand serverExternalPackages) -- config-only, can ship same PR.
3. **Option D** (NODE_OPTIONS) -- immediate relief, one-line change.
4. **Option F** (optimizePackageImports) -- low effort, might help.
5. **Option C** (barrel elimination) -- larger effort, do incrementally as tech debt.
6. **Option E** (route consolidation) -- only if options A+B are insufficient.

Expected outcome: Options A+B together should reduce dev-server RSS from ~6 GB to
~2-3 GB by eliminating the primary duplication vector (container.ts fan-out) and
preventing Turbopack from bundling heavy server deps.

## Open Questions

- [ ] Does Turbopack's dynamic `import()` actually defer module graph tracing, or
      does it eagerly resolve dynamic imports in dev mode? Needs empirical testing.
- [ ] What is the actual memory delta from adding packages to `serverExternalPackages`?
      Measure before/after with `process.memoryUsage()` logging.
- [ ] Will `optimizePackageImports` work with pnpm workspace symlinks in this monorepo?
- [ ] Is there a Turbopack-specific config to share module instances across route
      entry points (module federation-like)?

## Sources

- [Next.js Memory Usage Guide](https://nextjs.org/docs/app/guides/memory-usage)
- [Next.js serverExternalPackages docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)
- [Next.js optimizePackageImports docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports)
- [How we optimized package imports in Next.js (Vercel blog)](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js)
- [Turbopack dev memory #66326](https://github.com/vercel/next.js/issues/66326)
- [Turbopack RAM on macOS #75142](https://github.com/vercel/next.js/issues/75142)
- [Turbopack RAM+CPU #81161](https://github.com/vercel/next.js/issues/81161)
- [Next.js v15.4.6 Turbopack RAM tips #82512](https://github.com/vercel/next.js/discussions/82512)
- [optimizePackageImports + workspace packages #75148](https://github.com/vercel/next.js/issues/75148)
- [Next.js 16.1 serverExternalPackages fix](https://nextjs.org/blog/next-16-1)
- [Turbopack What's New in 16.2](https://nextjs.org/blog/next-16-2-turbopack)

## Proposed Layout

### Does this warrant a project?

No. This is a focused optimization effort with 2-3 well-scoped tasks. It fits under
the existing `proj.reliability` project or can stand alone as independent tasks.

### Proposed Tasks (PR-sized)

| ID        | Title                                                                                             | Est | Dependencies                         |
| --------- | ------------------------------------------------------------------------------------------------- | --- | ------------------------------------ |
| task.0204 | Break container.ts import coupling in wrapRouteHandlerWithLogging + expand serverExternalPackages | 2   | none                                 |
| task.0205 | Add NODE_OPTIONS tuning + optimizePackageImports for workspace packages                           | 1   | none                                 |
| task.0206 | Incremental barrel import narrowing in ports/ and shared/observability                            | 3   | task.0204 (validates approach first) |

### Sequence

```
task.0204 (Options A+B, highest impact)
  └─ can ship immediately
task.0205 (Options D+F, config-only)
  └─ can ship in parallel with 0204
task.0206 (Option C, tech debt)
  └─ after 0204 validates the memory improvement
```

Measurement gate: after task.0204 ships, measure dev-server RSS during a full
navigation of all 46 routes. If RSS stays below 3 GB, task.0206 becomes P2.
