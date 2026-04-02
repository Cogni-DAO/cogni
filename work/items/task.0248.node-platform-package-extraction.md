---
id: task.0248
type: task
title: "Deduplicate node platform: targeted package extractions + bounded node workspaces"
status: needs_design
priority: 1
rank: 5
estimate: 5
summary: "Eliminate ~660 duplicated files per node via targeted shared-package extractions and bounded node workspace structure. Node-template becomes the golden path."
outcome: "Adding a new node = create thin app shell (~50 files) + node-specific graphs. No file copying. Platform fixes land once, all nodes get them."
spec_refs:
  - spec.node-app-shell
  - docs/spec/architecture.md
  - docs/spec/multi-node-tenancy.md
  - docs/spec/packages-architecture.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 1
blocked_by:
  - task.0257
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [refactor, architecture, nodes, packages]
external_refs:
---

# Deduplicate node platform: targeted package extractions + bounded node workspaces

## Context

After task.0244-0246, each node is a full copy of the operator app (~675 files). Only ~15 files per node actually differ (layout, container, tool-bindings, server-env, tailwind, MCP config). The remaining ~660 files are byte-for-byte identical copies that drift independently.

## Design

### Outcome

Node-template is the golden path. Adding a new node = scaffold from template, customize ~15 files, add graphs. Platform fixes land in shared packages, all nodes get them via `workspace:*` deps.

### Approach

**Solution:** Three-layer extraction, following the established capability-package pattern. Each layer is an independent PR that can be reviewed and validated separately.

**Rejected alternatives:**

1. **One `@cogni/node-platform` monolith package** — Violates PURE_LIBRARY (features use Next.js, components use React, bootstrap reads env). Mixes 5 architectural layers in one package. Creates a god-dependency.
2. **Turborepo/Next.js shared app overlay** — No established pattern in codebase. Turbopack's transpilePackages doesn't solve the identical-file problem. Novel infra for unclear benefit.
3. **Symlinks** — Fragile, confusing for IDEs, breaks git history, not a pnpm workspace pattern.

### Architecture: What goes where

Based on framework-coupling analysis of the actual code:

| Layer              | Files | Framework deps | Extractable? | Target                         |
| ------------------ | ----- | -------------- | ------------ | ------------------------------ |
| **ports/**         | 32    | 0              | Yes          | `@cogni/node-ports`            |
| **core/**          | 24    | 0              | Yes          | `@cogni/node-core`             |
| **contracts/**     | 55    | 0              | Yes          | `@cogni/node-contracts`        |
| **types/**         | 7     | 0              | Yes          | `@cogni/node-core`             |
| **shared/** (pure) | 81    | 0              | Yes          | `@cogni/node-shared`           |
| **shared/hooks/**  | 1     | React          | No           | stays in app                   |
| **adapters/**      | 159   | 0              | Yes          | `@cogni/node-adapters`         |
| **features/**      | 153   | 70 Next.js     | **No**       | stays in app (Next.js coupled) |
| **components/**    | 101   | 96 React       | **No**       | stays in app (React coupled)   |
| **bootstrap/**     | 36    | 18 env/process | **No**       | stays in app (runtime wiring)  |
| **app/** (routes)  | 157   | Next.js        | **No**       | stays in app                   |

**Extractable:** ~358 files (ports + core + contracts + types + shared-pure + adapters)
**Stays in app:** ~448 files (features + components + bootstrap + app routes + hooks)

But since features/components/bootstrap are 99% identical across nodes, we solve that duplication differently: **node apps import shared features/components from node-template via workspace reference**, not via package extraction.

### Node workspace structure (aligned with bounded-product pattern)

```
nodes/
  node-template/          # Golden path — source of truth for platform code
    .cogni/               # repo-spec, node metadata
    apps/
      web/                # The Next.js app (renamed from app/)
        src/
          app/            # Next.js routes (template defaults)
          features/       # Platform features (shared via workspace ref)
          components/     # Platform UI (shared via workspace ref)
          bootstrap/      # DI container (template default, nodes override)
          shared/hooks/   # React hooks (framework-coupled)
          styles/         # Tailwind, theme
    packages/
      graphs/             # Node-specific graphs (renamed from graphs/)
    infra/                # Future: node-specific compose overlays

  poly/
    .cogni/
    apps/
      web/                # Thin shell: layout overrides, poly-specific pages
        src/
          app/            # Poly routes + pages (homepage, custom)
          features/       # Poly-specific features only
          components/     # Poly-specific components only (Header, Hero, etc.)
          bootstrap/      # Poly container.ts + tool-bindings.ts overrides
          styles/         # Poly theme (tailwind.css override)
    packages/
      graphs/             # Poly-specific graphs (poly-brain, etc.)
```

**Key principle:** `node-template/apps/web` is a **complete, runnable app**. Poly's `apps/web` overrides only what differs (~15 files), importing the rest from shared packages.

### Package extraction plan (ordered by value / risk)

**Phase 1 — Pure domain extractions (zero risk, immediate dedup)**

| Package                 | From                       | Files | Deps                    |
| ----------------------- | -------------------------- | ----- | ----------------------- |
| `@cogni/node-contracts` | `src/contracts/`           | 55    | `zod`, `@cogni/ai-core` |
| `@cogni/node-core`      | `src/core/` + `src/types/` | 31    | None (pure domain)      |

These are already 100% identical across all nodes, have zero framework deps, and follow the exact capability-package pattern.

**Phase 2 — Port + adapter extractions (subsumes task.0250)**

| Package                       | From                             | Files | Deps                                                           |
| ----------------------------- | -------------------------------- | ----- | -------------------------------------------------------------- |
| `@cogni/node-ports`           | `src/ports/`                     | 32    | `@cogni/ai-core`, `@cogni/graph-execution-core`                |
| `@cogni/graph-execution-host` | `src/adapters/server/ai/` subset | ~20   | `@cogni/ai-core`, `@cogni/langgraph-graphs`, `@cogni/ai-tools` |
| `@cogni/node-adapters`        | `src/adapters/` (remainder)      | ~139  | `@cogni/node-ports`, various                                   |

`@cogni/node-ports` must extract first (adapters depend on ports). `@cogni/graph-execution-host` extracts the AI execution subset (task.0250 design, reviewed and approved) as part of this phase. Remaining adapters become `@cogni/node-adapters`.

**Phase 3 — Shared utilities**

| Package              | From                      | Files | Deps                  |
| -------------------- | ------------------------- | ----- | --------------------- |
| `@cogni/node-shared` | `src/shared/` minus hooks | 81    | `pino`, `node:crypto` |

This includes observability, config helpers, content-scrubbing, crypto utils — all pure functions with zero framework deps.

**Phase 4 — Framework-coupled dedup (different strategy)**

Features, components, bootstrap are React/Next.js-coupled and CANNOT be pure packages per `packages-architecture.md:58`. For these, use **workspace inheritance**:

- Node-template `apps/web/` is the canonical complete app
- Other nodes' `apps/web/` are thin shells that:
  - Override only differing files (container.ts, tool-bindings, layout components, server-env, tailwind)
  - Import shared features/components from `@cogni/node-platform-ui` (a React package, not a PURE_LIBRARY — uses `"react"` as peerDependency, similar to how shadcn/ui works)
  - OR: use Next.js `transpilePackages` to reference node-template's source directly

Phase 4 is the most complex and should be designed separately after Phases 1-3 prove the pattern.

### Relationship to task.0250/0251/0252

task.0250 (extract graph-execution-host) is **absorbed into Phase 2** of this task. The design decisions from task.0250's review still apply:

- Type ownership: define in package, app re-exports (same PR)
- Constructor injection for Logger (PURE_LIBRARY compliant)
- Opaque CompletionStreamFn signature
- Inline EVENT_NAMES strings

task.0251 (wire execution in scheduler-worker) and task.0252 (strip AI deps from Next.js) remain independent — they consume the extracted package.

### Invariants

- [ ] PURE_LIBRARY: All extracted packages have no process lifecycle, no env vars, no framework deps (spec: packages-architecture)
- [ ] NO_SRC_IMPORTS: Packages never import `@/` or `src/` paths (spec: packages-architecture)
- [ ] COMPOSITE_BUILD: All packages use TypeScript composite mode (spec: packages-architecture)
- [ ] DB_PER_NODE: Extracted adapters accept DB client via constructor, not env (spec: multi-node-tenancy)
- [ ] NO_CROSS_IMPORTS: No imports between `nodes/poly/**` and `nodes/resy/**` (spec: multi-node-tenancy)
- [ ] CAPABILITY_PER_PACKAGE: One package per capability, not one monolith (spec: packages-architecture)

## Plan

### Phase 1: Extract `@cogni/node-contracts` + `@cogni/node-core`

- [ ] Create `packages/node-contracts/` with all Zod route contracts
- [ ] Create `packages/node-core/` with domain models + types
- [ ] Rewire all 4 apps (operator + 3 nodes) to import from packages
- [ ] `pnpm check` passes

### Phase 2: Extract ports + adapters (includes task.0250 scope)

- [ ] Create `@cogni/node-ports` with all 32 port interfaces
- [ ] Create `@cogni/graph-execution-host` (task.0250 design)
- [ ] Create `@cogni/node-adapters` with remaining adapters
- [ ] Rewire all apps
- [ ] `pnpm check` passes

### Phase 3: Extract `@cogni/node-shared`

- [ ] Create `packages/node-shared/` with pure shared utilities
- [ ] Move `shared/hooks/useIsMobile.ts` to app-local (1 React file)
- [ ] Rewire all apps
- [ ] `pnpm check` passes

### Phase 4: Node workspace restructure

- [ ] Rename `nodes/*/app/` → `nodes/*/apps/web/`
- [ ] Rename `nodes/*/graphs/` → `nodes/*/packages/graphs/`
- [ ] Update `pnpm-workspace.yaml` globs
- [ ] Design framework-coupled sharing strategy (separate design task)

## Validation

Each phase independently:

```bash
pnpm check
```

After all phases:

```bash
# Verify no duplicate platform code
diff -rq packages/node-ports/src/ apps/operator/src/ports/ 2>/dev/null
# Should show: apps/operator/src/ports/ re-exports from @cogni/node-ports

# Verify nodes are thin
find nodes/poly/apps/web/src -type f | wc -l
# Target: <100 (down from 675)
```
