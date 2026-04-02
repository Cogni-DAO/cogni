---
id: task.0248
type: task
title: "Deduplicate node platform: capability extractions + thin app shell"
status: needs_merge
priority: 1
rank: 5
estimate: 5
summary: "Eliminate duplicated platform code across nodes via targeted capability-package extractions, a thin internal source app shell, and bounded node workspace structure."
outcome: "Adding a new node = scaffold from template, customize ~15 files (routes, theme, container, env), add graphs. Platform fixes land once."
spec_refs:
  - spec.node-app-shell
  - docs/spec/architecture.md
  - docs/spec/multi-node-tenancy.md
  - docs/spec/packages-architecture.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch: feat/task-0248-node-platform-extraction
pr: https://github.com/Cogni-DAO/node-template/pull/694
reviewer:
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-03

labels: [refactor, architecture, nodes, packages]
external_refs:
---

# Deduplicate node platform: capability extractions + thin app shell

## Context

Each node is a full copy of the operator app (~675 files). Only ~22 files per node actually differ. The remaining ~650 files are identical copies that drift independently.

## Design

See [spec.node-app-shell](../../docs/spec/node-app-shell.md) for the full architecture.

### Three-layer strategy

1. **Capability libraries** (PURE_LIBRARY, `dist/` exports) — extract pure/runtime-agnostic code (ports, core, contracts, shared utils, graph-execution-host) into targeted packages. Consumed by any runtime.
2. **Thin app shell** (`@cogni/node-app`, source exports via `transpilePackages`) — low-volatility app chrome only (layout frame, providers, auth framing, extension-point types). Consumed by Next.js node apps only.
3. **Node-owned code** — routes, features, components, product UX, library choices, container overrides, theme, env, graphs. Each node owns its product decisions.

### Rejected alternatives

1. **One `@cogni/node-platform` monolith** — Puts everything (ports, adapters, features, components, bootstrap) in one package. Violates PURE_LIBRARY for the pure layers, becomes gravity well for the framework layers. Every consumer rebuilds everything.
2. **6-7 new PURE_LIBRARY packages** (previous design) — Over-fragmented for the problem. `@cogni/node-adapters` was a grab-bag, not a capability. Ignored the `transpilePackages` pattern for framework-coupled code.
3. **Symlinks / file copying** — Fragile, confusing for IDEs, not a workspace pattern.

### What extracts where

| Code                                                            | Target                                                                 | Category                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------- |
| Zod route contracts (55 files)                                  | `@cogni/node-contracts`                                                | Capability library      |
| Domain models + types (31 files)                                | `@cogni/node-core`                                                     | Capability library      |
| Pure shared utils — observability, crypto, config (81 files)    | `@cogni/node-shared`                                                   | Capability library      |
| AI execution stack — decorators, providers, factory (~20 files) | `@cogni/graph-execution-host` (task.0250)                              | Capability library      |
| Port interfaces (32 files)                                      | Existing capability packages + `@cogni/node-ports` for app-local ports | Capability library      |
| App chrome — layout frame, providers, auth, extension types     | `@cogni/node-app`                                                      | Internal source package |
| Non-AI adapters (~139 files)                                    | Stay in app pending per-adapter audit                                  | Deferred                |
| Features, components, routes, bootstrap                         | **Node-owned**                                                         | Node apps               |

### Key constraint: `SHELL_IS_CHROME_ONLY`

`@cogni/node-app` is NOT the place for feature UIs, product flows, or library choices. It provides the frame; nodes fill it. If it starts owning chat UI, billing dashboards, or assistant-ui integrations, it's too fat.

### Extension-point mechanism

Nodes customize via `NodeAppConfig` injection, not file-path shadowing:

- `headerComponent` — slot for per-node header
- `navItems` — sidebar navigation
- `capabilityBindings` — DI wiring
- `theme` — CSS variables

See spec for full interface definition.

### Invariants

- [ ] PURE_LIBRARY: Capability packages have no framework deps, no env (spec: packages-architecture)
- [ ] SHELL_IS_CHROME_ONLY: `@cogni/node-app` is layout/providers/auth/extension-types only (spec: node-app-shell)
- [ ] SHELL_NEVER_READS_ENV: App shell never reads `process.env` or `serverEnv()` (spec: node-app-shell)
- [ ] NODE_OWNS_PRODUCT: Nodes own routes, features, components, theme, env (spec: node-app-shell)
- [ ] CURATED_EXPORTS: App shell uses curated subpath exports, not wildcards (spec: node-app-shell)
- [ ] OVERRIDE_VIA_CONFIG: `NodeAppConfig` injection, not file shadowing (spec: node-app-shell)
- [ ] CAPABILITY_STAYS_PURE: Code consumed by services → capability package, not shell (spec: node-app-shell)
- [ ] NO_CROSS_NODE_IMPORTS: Enforced by dependency-cruiser (spec: multi-node-tenancy)

## Plan

### Spike: Turbopack + transpilePackages — DONE (2026-04-02)

Validated: 7-file `@cogni/node-app` with `AppShell`, `NodeAppProvider`, `NodeAppConfig` + slot injection.
Turbopack compiles source exports correctly. No memory regression. Curated subpath exports resolve.
Gotcha: git worktrees break Turbopack (symlink outside filesystem root). Must run from real repo.
Results recorded in spec.node-app-shell.

### Phase 1: Pure capability extractions (no risk, immediate dedup)

- [x] Create `packages/node-core/` — move 16 core + 5 type files → DONE (PR: feat/task-0248-node-platform-extraction)
  - All 4 apps rewired: `@/core` → `@cogni/node-core`, `@/types/*` → `@cogni/node-core`
  - Original files deleted (no shims). -4,870 lines.
  - `pnpm check` all 11 checks pass.
- [x] Create `packages/node-contracts/` — move 45 Zod contract files → DONE (feat/task-0248-phase2-contracts)
  - All 4 apps rewired: `@/contracts/*` → `@cogni/node-contracts` barrel import
  - ChatMessage dedup: selective re-export from ai.chat.v1.contract to avoid TS2308 collision
  - 42 duplicate import statements merged post-sed
  - Original files deleted. -8,405 lines.
  - `pnpm check:fast` all 6 checks pass.
- [x] Create `packages/node-shared/` — 40 pure shared utility files extracted (not 81; dependency audit excluded heavy-dep files)
  - 485 consumer imports rewired across 4 apps + tests. -10,967 lines.
  - App-local barrels (observability, web3, util) combine local + package re-exports.
  - 22 files remain app-local per app: env, db, hooks, config server, model-catalog, wagmi, evm-wagmi, onchain, logger, metrics, redact, cn.
  - `pnpm check` all 11 checks pass.
  - Branch: `feat/task-0248-phase1b-node-shared`
- [ ] Move `shared/hooks/useIsMobile.ts` to app-local (deferred to Phase 3 @cogni/node-app)

### Phase 2: Graph execution extraction (task.0250, consumed by scheduler-worker)

- [ ] Create `@cogni/graph-execution-host` per task.0250 design
- [ ] Rewire apps/operator + nodes to import from package
- [ ] `pnpm check` passes

### Phase 3: Thin app shell (`@cogni/node-app`) — spike passed, ready to implement

- [ ] Create `packages/node-app/` with curated subpath exports
- [ ] Move layout frame (sidebar, header, topbar structure with slots)
- [ ] Move common providers (auth session wrapper, theme, query client)
- [ ] Define `NodeAppConfig` extension-point interface
- [ ] Create default `node-config.ts` in node-template
- [ ] Create poly/resy `node-config.ts` overrides
- [ ] Rewire all apps
- [ ] `pnpm check` passes

### Phase 4: Node workspace restructure

- [ ] Rename `nodes/*/app/` → `nodes/*/apps/web/`
- [ ] Rename `nodes/*/graphs/` → `nodes/*/packages/graphs/`
- [ ] Update `pnpm-workspace.yaml` globs
- [ ] `pnpm check` passes

### Phase 5: Adapter audit (deferred, per-adapter decision)

- [ ] Audit 139 non-AI adapters: which existing capability packages should absorb them?
- [ ] Move adapters to their capability homes (DB → db-client, payments → operator-wallet, etc.)
- [ ] Remaining app-specific adapters stay in app

## Review Notes

### Node apps must preserve hexagonal architecture

Extracting shared core to `@cogni/node-core` does NOT eliminate the `@/core` layer. Each node app retains `src/core/public.ts` as its local barrel, which re-exports from the package AND is the extension point for node-specific domain models (e.g., `core/reservations/` for resy).

`@/core` remains a valid hexagonal layer. Arch probes and dep-cruiser rules that enforce the core barrel boundary still apply to node-local core files.

### Arch probe `blocks internal core file imports` — needs update

The probe at `app/__arch_probes__/fail_entrypoint_imports_core_internal.ts` imports `@/core/chat/model` which no longer exists locally (moved to package). This probe's boundary is now enforced by package exports instead of dep-cruiser. Fix: remove the probe and test case, add comment that package exports enforce this boundary. When nodes add their own core files, a new probe should be added targeting those.

## Validation

Each phase independently:

```bash
pnpm check
```

After all phases:

```bash
# Verify node-template is a complete runnable app
pnpm dev  # operator still works
pnpm dev:poly  # poly still works

# Verify nodes are thin
find nodes/poly/apps/web/src -type f | wc -l
# Target: <100 node-owned files (down from 675)

# Verify no cross-node imports
pnpm exec dependency-cruiser --config .dependency-cruiser.cjs nodes/
```
