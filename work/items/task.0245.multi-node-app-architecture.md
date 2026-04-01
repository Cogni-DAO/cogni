---
id: task.0245
type: task
title: "Multi-node architecture — nodes/ directory, per-node graph packages, dep-cruiser boundaries"
status: needs_design
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

- [ ] `nodes/poly/app/` starts on port 3100
- [ ] `nodes/poly/graphs/` builds and exports poly-brain
- [ ] Poly-brain no longer in shared `packages/langgraph-graphs/`
- [ ] `nodes/node-template/` exists as forkable base
- [ ] Dep-cruiser blocks cross-node imports
- [ ] Dep-cruiser blocks nodes/ → apps/ imports
- [ ] Dep-cruiser blocks packages/ → nodes/ imports
- [ ] `pnpm check` passes
