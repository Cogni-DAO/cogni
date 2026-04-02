---
id: spec.node-app-shell
type: spec
title: "Node App Shell: Shared Platform via Internal Source Package"
status: draft
spec_state: draft
trust: draft
summary: "Defines two package categories (capability libraries and internal source packages) and how node apps consume shared platform code without file duplication."
read_when: "Creating a new node, extracting shared code from apps/operator, or deciding whether code belongs in a capability package vs the app shell."
implements: proj.operator-plane
owner: derekg1729
created: 2026-04-02
verified: 2026-04-02
tags: [architecture, nodes, packages, multi-node]
---

# Node App Shell: Shared Platform via Internal Source Package

> Nodes are thin app shells that overlay a shared platform. Capability libraries compile to `dist/`; the app shell exports source and is compiled by each consumer's bundler.

### Key References

|             |                                                                   |                                         |
| ----------- | ----------------------------------------------------------------- | --------------------------------------- |
| **Project** | [proj.operator-plane](../../work/projects/proj.operator-plane.md) | Multi-node architecture roadmap         |
| **Spec**    | [Packages Architecture](./packages-architecture.md)               | Capability package rules (PURE_LIBRARY) |
| **Spec**    | [Multi-Node Tenancy](./multi-node-tenancy.md)                     | DB_PER_NODE, auth isolation             |
| **Guide**   | [Multi-Node Dev](../guides/multi-node-dev.md)                     | Running nodes locally                   |

## Design

### Two package categories

```
packages/
  ┌──────────────────────────────────────────────────────┐
  │ CAPABILITY LIBRARIES (existing pattern)              │
  │ Compiled to dist/ via tsc-b + tsup                   │
  │ PURE_LIBRARY — no framework deps, no env, no process │
  │                                                      │
  │ ai-core, db-client, graph-execution-core,            │
  │ scheduler-core, ids, langgraph-graphs, ...           │
  │ + NEW: graph-execution-host (task.0250)              │
  └──────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────┐
  │ NODE APP SHELL (new pattern)                         │
  │ Exports TypeScript SOURCE, not dist/                 │
  │ Compiled by each consumer's Next.js bundler          │
  │ React, Next.js, pino, env patterns are allowed       │
  │                                                      │
  │ @cogni/node-app                                      │
  └──────────────────────────────────────────────────────┘
```

### How node apps consume the shell

```
┌─────────────────────────────────────────────────────┐
│ packages/node-app/                                  │
│   src/                                              │
│     ports/          ← 32 port interfaces            │
│     core/           ← domain models, types          │
│     contracts/      ← Zod route contracts           │
│     shared/         ← observability, crypto, config │
│     adapters/       ← all adapters (AI, DB, etc.)   │
│     features/       ← shared platform features      │
│     components/     ← shared UI kit                 │
│     bootstrap/      ← DI container pattern          │
│     index.ts        ← barrel export                 │
│   package.json      ← exports: "./src/index.ts"     │
└──────────────────────┬──────────────────────────────┘
                       │ workspace:*
          ┌────────────┼────────────┐
          ▼            ▼            ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ operator │  │   poly   │  │   resy   │
  │ apps/web │  │ apps/web │  │ apps/web │
  │ ~15 own  │  │ ~22 own  │  │ ~10 own  │
  │ files    │  │ files    │  │ files    │
  └──────────┘  └──────────┘  └──────────┘

  Each node's Next.js bundler compiles @cogni/node-app source directly.
  No intermediate dist/ build step. Turbopack/webpack handles it.
```

### What goes where

| Code                                             | Location                        | Rationale                                              |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------ |
| Port interfaces, domain types, Zod contracts     | `@cogni/node-app`               | Shared across all nodes, pure types                    |
| Adapters (AI, DB, payments, temporal)            | `@cogni/node-app`               | Identical across nodes, take deps via constructor      |
| Shared features (ai, payments, accounts)         | `@cogni/node-app`               | Framework-coupled but identical — bundler compiles     |
| Shared UI (kit/\*, chat, auth components)        | `@cogni/node-app`               | React-coupled but identical — bundler compiles         |
| Bootstrap patterns (container shape, factories)  | `@cogni/node-app`               | DI wiring patterns — node overrides specific bindings  |
| Shared utilities (observability, crypto, config) | `@cogni/node-app`               | Pure functions, used everywhere                        |
| Node-specific routes/pages                       | Node `apps/web/src/app/`        | Per-node UI and API routes                             |
| Node-specific features                           | Node `apps/web/src/features/`   | e.g., resy reservations                                |
| Node-specific components                         | Node `apps/web/src/components/` | e.g., poly Hero, BrainFeed                             |
| Node-specific container overrides                | Node `apps/web/src/bootstrap/`  | Tool bindings, capability wiring                       |
| Node-specific graphs                             | Node `packages/graphs/`         | AI graph definitions                                   |
| Theme / CSS                                      | Node `apps/web/src/styles/`     | Per-node color tokens                                  |
| Server env config                                | Node `apps/web/src/shared/env/` | Per-node env vars (DB_PER_NODE)                        |
| Graph execution runtime                          | `@cogni/graph-execution-host`   | Capability library — also consumed by scheduler-worker |

### Node workspace structure

```
nodes/
  node-template/              # Golden path — scaffold new nodes from here
    .cogni/                   # repo-spec, node identity
    apps/
      web/                    # Next.js app — thin shell + shared platform
        src/
          app/                # Default routes (dashboard, chat, settings)
          bootstrap/          # Default container.ts, tool-bindings.ts
          shared/env/         # Default server-env.ts
          styles/             # Default tailwind.css
        next.config.ts        # transpilePackages: ["@cogni/node-app"]
        package.json          # depends on @cogni/node-app + capability packages
    packages/
      graphs/                 # Node-specific graph definitions

  poly/
    .cogni/
    apps/
      web/
        src/
          app/                # Poly homepage, custom routes
          bootstrap/          # Poly container.ts (VCS tools excluded)
          components/         # Poly-specific: Hero, BrainFeed, etc.
          shared/env/         # Poly server-env.ts (COGNI_NODE_ID, etc.)
          styles/             # Poly theme
        next.config.ts
        package.json
    packages/
      graphs/                 # poly-brain graph
```

### Internal source package shape

`@cogni/node-app` differs from capability packages in three ways:

```json
// packages/node-app/package.json
{
  "name": "@cogni/node-app",
  "private": true,
  "version": "0.0.0",
  "exports": {
    "./*": "./src/*" // Source exports, NOT dist/
  },
  "peerDependencies": {
    "react": ">=19",
    "next": ">=16"
  }
}
```

1. **Source exports** (`./src/*`) instead of `./dist/*` — consumers compile via their own bundler
2. **Framework peer deps** — React and Next.js are peerDependencies, not banned
3. **No tsup, no tsc-b** — no intermediate build step. Bundler is the compiler.

Consumer next.config.ts:

```ts
// nodes/poly/apps/web/next.config.ts
const nextConfig: NextConfig = {
  transpilePackages: ["@cogni/node-app"],
  // ... existing config
};
```

### Import convention in node apps

```ts
// Node app imports from shell via subpath
import { BillingContext } from "@cogni/node-app/ports/billing-context";
import { AppSidebar } from "@cogni/node-app/features/layout/components/AppSidebar";
import { makeLogger } from "@cogni/node-app/shared/observability";

// Node-specific code uses local @/ alias as usual
import { ReservationsFeature } from "@/features/reservations";
```

### What does NOT go in `@cogni/node-app`

1. **Code consumed by non-Next.js runtimes** (scheduler-worker, Temporal activities) → stays in capability packages (`@cogni/graph-execution-host`, `@cogni/db-client`, etc.)
2. **Node-specific overrides** (container.ts, tool-bindings, server-env, theme) → stays in node's `apps/web/`
3. **Node-specific features/components** → stays in node's `apps/web/`
4. **Anything that needs process lifecycle** → stays in `services/`

## Goal

Enable nodes as thin app shells (~15-50 files) that import shared platform code from a single internal source package. Platform fixes land once in `@cogni/node-app`, all nodes get them via `workspace:*` without file copying.

## Non-Goals

- Runtime plugin system (nodes are still separate Next.js apps)
- Published npm packages (all packages remain `private: true`)
- Replacing capability libraries — `@cogni/ai-core`, `@cogni/db-client`, etc. continue using the existing PURE_LIBRARY pattern
- Operator aggregation plane (separate concern per multi-node-tenancy spec)

## Invariants

| Rule                        | Constraint                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TWO_PACKAGE_CATEGORIES      | Capability libraries export `dist/` (PURE_LIBRARY). `@cogni/node-app` exports `src/` (internal source package). No mixing.                                                                                |
| SOURCE_EXPORTS_FOR_SHELL    | `@cogni/node-app` exports TypeScript source, never compiled `dist/`. Consumers compile it via `transpilePackages`.                                                                                        |
| CAPABILITY_STAYS_PURE       | Code consumed by scheduler-worker or services MUST live in a capability library (PURE_LIBRARY), not in `@cogni/node-app`.                                                                                 |
| SHELL_NOT_GOD_PACKAGE       | `@cogni/node-app` contains only code that is (a) identical across all nodes AND (b) specific to the Next.js app runtime. Code meeting only (a) but shared with non-Next.js runtimes → capability package. |
| NODE_OVERRIDES_ONLY         | Each node's `apps/web/src/` contains ONLY node-specific overrides. If a file is identical to node-template, it should import from `@cogni/node-app` instead.                                              |
| NO_CROSS_NODE_IMPORTS       | `nodes/poly/**` must never import from `nodes/resy/**` or vice versa. Enforced by dependency-cruiser.                                                                                                     |
| GOLDEN_PATH_IS_TEMPLATE     | `node-template` is the reference node. Its `apps/web/` is a complete runnable app using `@cogni/node-app` for all shared code. New nodes scaffold from it.                                                |
| TRANSPILE_PACKAGES_REQUIRED | Every Next.js app consuming `@cogni/node-app` must include it in `transpilePackages` in `next.config.ts`.                                                                                                 |

### File Pointers

| File                                          | Purpose                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/node-app/package.json`              | Internal source package declaration                                          |
| `packages/node-app/src/index.ts`              | Root barrel export                                                           |
| `nodes/node-template/apps/web/next.config.ts` | Reference transpilePackages config                                           |
| `pnpm-workspace.yaml`                         | Workspace glob includes `packages/*`, `nodes/*/apps/*`, `nodes/*/packages/*` |
| `.dependency-cruiser.cjs`                     | Cross-node import enforcement                                                |
| `docs/spec/packages-architecture.md`          | Capability library rules (companion spec)                                    |

## Open Questions

- [ ] Does Turbopack (Next.js 16 dev mode) handle `transpilePackages` for a ~660-file internal package without dev-server memory regression? Needs spike.
- [ ] Should `@cogni/node-app` use subpath exports (`"./ports/*": "./src/ports/*"`) or a single root export? Subpath is more granular but more config.
- [ ] How does the node override mechanism work for features? Does poly's `AppHeader.tsx` shadow `@cogni/node-app/features/layout/components/AppHeader`? Or does poly's `bootstrap/container.ts` inject a different component?

## Related

- [Packages Architecture](./packages-architecture.md) — Capability library rules (PURE_LIBRARY pattern)
- [Multi-Node Tenancy](./multi-node-tenancy.md) — DB_PER_NODE, auth isolation
- [Node Operator Contract](./node-operator-contract.md) — NO_CROSS_IMPORTS, DATA_SOVEREIGNTY
- [task.0248](../../work/items/task.0248.node-platform-package-extraction.md) — Implementation task
- [task.0250](../../work/items/task.0250.extract-graph-execution-host-package.md) — graph-execution-host capability extraction (consumed by scheduler-worker)
