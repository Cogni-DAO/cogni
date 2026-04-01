---
id: task.0245
type: task
title: "Multi-node architecture — nodes/ directory, per-node graph packages, dep-cruiser boundaries"
status: needs_closeout
priority: 0
rank: 1
estimate: 5
summary: "Introduce nodes/ as the bounded-context directory for node-specific code. Each node gets app/, graphs/, and bespoke code. Shared packages/ and services/ are operator-level. Dep-cruiser enforces no cross-node imports."
outcome: "nodes/node-template/ is the forkable base. nodes/poly/ holds poly-specific code. Clear dep-cruiser rules prevent import leakage across node boundaries. pnpm workspace resolves nodes/*/app and nodes/*/graphs."
spec_refs:
  - docs/spec/node-operator-contract.md
  - docs/spec/node-launch.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [nodes, multi-app, architecture]
external_refs:
---

## Context

task.0244 absorbed cogni-resy-helper into the monorepo, but node-specific code
is scattered: `apps/poly/` alongside the operator app, `poly-brain` in the shared
`packages/langgraph-graphs/`, market-list tool in shared `packages/ai-tools/`.

The repo needs a clear partition: **everything outside `nodes/` is operator
(shared infra). Everything inside `nodes/{name}/` is that node's sovereign code.**

## Architecture

```
nodes/
  node-template/               ← the forkable base (ROADMAP Phase 0.5)
    app/                       ← Next.js webapp shell (auth, chat, bootstrap)
    graphs/                    ← base node graphs package (@cogni/node-template-graphs)
    .cogni/repo-spec.yaml      ← node identity template

  poly/                        ← poly prediction market node
    app/                       ← poly webapp (@cogni/poly-app)
    graphs/                    ← poly-specific graphs (@cogni/poly-graphs: poly-brain)

  resy/                        ← resy reservation helper node
    app/                       ← resy webapp (@cogni/resy-app)
    graphs/                    ← resy-specific graphs (@cogni/resy-graphs)

packages/                      ← shared across ALL nodes + operator
  ai-core/                     ← AI primitives
  ai-tools/                    ← tool contracts (market-list stays here — any node can use it)
  langgraph-graphs/            ← shared graph runtime + base graphs (brain, poet, research)
  market-provider/             ← Polymarket + Kalshi adapters (shared capability)
  db-schema/                   ← shared DB schema
  ...

services/                      ← shared operator-level infrastructure
  scheduler-worker/
  sandbox-openclaw/
  sandbox-runtime/

apps/operator/                      ← operator app (rename to apps/operator in separate PR)
```

### Per-node contents

Each node directory contains exactly:

| Directory | Purpose                                      | pnpm package name      |
| --------- | -------------------------------------------- | ---------------------- |
| `app/`    | Next.js webapp (auth, routes, UI, bootstrap) | `@cogni/{node}-app`    |
| `graphs/` | Node-specific langgraph graphs package       | `@cogni/{node}-graphs` |
| `.cogni/` | repo-spec.yaml (node identity)               | n/a                    |
| `...`     | Any bespoke node code (domain packages)      | varies                 |

Each node's `app/` bootstrap composes its catalog by importing:

- Shared base graphs from `@cogni/langgraph-graphs`
- Node-specific graphs from `@cogni/{node}-graphs`

### Dependency-cruiser rules

```
nodes/poly/**  →  nodes/resy/**    ✗  NO_CROSS_NODE
nodes/poly/**  →  nodes/template/**  ✗  NO_CROSS_NODE (fork, don't import)
nodes/**       →  apps/**           ✗  NODE_NOT_OPERATOR
nodes/**       →  services/**       ✗  NODE_NOT_OPERATOR
packages/**    →  nodes/**          ✗  SHARED_NOT_NODE
nodes/{x}/**   →  packages/**       ✓  nodes consume shared
nodes/{x}/**   →  nodes/{x}/**      ✓  intra-node OK
```

### pnpm workspace changes

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
  - "nodes/*/app" # NEW — node webapps
  - "nodes/*/graphs" # NEW — node graph packages
```

## Design

### Outcome

Establish `nodes/` as the enforceable sovereignty boundary so each node can own its app + graph package while shared operator code remains outside `nodes/`.

### Approach

**Solution**: Move poly app and poly-brain graph into `nodes/poly/{app,graphs}`, create a forkable `nodes/node-template/`, update workspace globs, and add dependency-cruiser rules that prevent node/operator and cross-node leakage.

**Reuses**: Existing `apps/poly` app as-is, existing `packages/langgraph-graphs/src/graphs/poly-brain` graph files, existing dependency-cruiser enforcement pattern, existing shared `@cogni/langgraph-graphs` base catalog.

**Rejected**:

- Keep node apps under `apps/*`: rejected because it blurs sovereignty boundaries and makes node extraction harder.
- Keep poly-brain in shared `@cogni/langgraph-graphs`: rejected because node-specific graph ownership belongs with node code, not shared operator package.

### Invariants

- [ ] FORK_FREEDOM: Node code remains forkable and independent under `nodes/{node}` (spec: node-operator-contract)
- [ ] NO_CROSS_IMPORTS: Enforce no forbidden imports across node/operator/shared boundaries (spec: node-operator-contract)
- [ ] DEPLOY_INDEPENDENCE: Structure supports per-node deploy units (`app/`, `graphs/`) without operator coupling (spec: node-operator-contract)
- [ ] GITOPS_IS_SINK: Filesystem layout aligns with node-launch repo assumptions (spec: node-launch)
- [ ] SIMPLE_SOLUTION: Port existing code with minimal rewrites

## Design Review

## Design Review: task.0245

### Summary

This design creates a dedicated `nodes/` bounded context, migrates poly artifacts into node-owned packages, and enforces import boundaries via dependency-cruiser.

### Scorecard

| Dimension              | Score   | Rationale                                                                                                       |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| Simplicity             | PASS    | Uses move/refactor boundaries instead of rebuilding app/graph logic.                                            |
| OSS-First              | PASS    | Leverages existing pnpm workspaces + dependency-cruiser; no bespoke tooling added.                              |
| Architecture Alignment | PASS    | Preserves existing shared packages and strengthens explicit domain boundaries.                                  |
| Boundary Placement     | PASS    | Node-specific graph moves to node package; shared packages remain reusable.                                     |
| Content Boundaries     | PASS    | Work item now carries execution design while specs remain contract authority.                                   |
| Scope Discipline       | PASS    | Limited to task.0245 structure/rules/template work.                                                             |
| Risk Surface           | CONCERN | Moving package paths may break imports/scripts if any hidden references exist. Mitigate with full `pnpm check`. |

### Blocking Issues

None.

### Concerns

- Ensure `apps/poly` path references are fully migrated, including workspace metadata and lockfile entries.
- Ensure shared `LANGGRAPH_CATALOG` drops poly-brain entry to prevent dual registration.

### Verdict: APPROVE

## Plan

### Phase 1: Create nodes/ structure + move poly

1. Create `nodes/poly/app/` — move `apps/poly/` content here
2. Create `nodes/poly/graphs/` — move poly-brain from `packages/langgraph-graphs/`
3. Update `pnpm-workspace.yaml` with `nodes/*/app` and `nodes/*/graphs`
4. Remove poly-brain from shared catalog; poly app composes its own
5. Update `pnpm install`, verify resolution

### Phase 2: Create node-template/

1. Create `nodes/node-template/app/` — minimal Next.js shell with auth + chat
2. Create `nodes/node-template/graphs/` — re-exports shared base graphs
3. Create `nodes/node-template/.cogni/repo-spec.yaml` — template identity
4. Document: "to create a new node, copy node-template/ and customize"

### Phase 3: Dep-cruiser rules

1. Add NO_CROSS_NODE rule (nodes/{a} cannot import nodes/{b})
2. Add NODE_NOT_OPERATOR rule (nodes/ cannot import apps/ or services/)
3. Add SHARED_NOT_NODE rule (packages/ cannot import nodes/)
4. Validate with `pnpm arch:check`

### Phase 4: Wire resy node (follow-up)

1. Create `nodes/resy/app/` — clone from node-template, add resy features
2. Create `nodes/resy/graphs/` — resy-specific graphs

## Separate PR (not this task)

- Rename `apps/operator` → `apps/operator` — one clear rename PR, no mixing concerns

## Non-goals

- Per-node databases (V1+)
- Operator repo extraction (ROADMAP Phase 6)
- Per-node CI isolation (proj.cicd-services-gitops P2+)
- DNS wiring (dns-ops follow-up)

## Validation

- [x] `nodes/poly/app/` moved to `nodes/poly/app/` (port 3100 scripts preserved)
- [x] `nodes/poly/graphs/` builds as `@cogni/poly-graphs` and exports poly-brain
- [x] Poly-brain removed from shared `packages/langgraph-graphs/` catalog and exports
- [x] `nodes/node-template/` scaffold created (`app/`, `graphs/`, `.cogni/repo-spec.yaml`)
- [x] Dep-cruiser blocks cross-node imports (`no-cross-node`)
- [x] Dep-cruiser blocks nodes/ → apps/services imports (`node-not-operator`)
- [x] Dep-cruiser blocks packages/ → nodes/ imports (`shared-not-node`)
- [ ] `pnpm check` passes
