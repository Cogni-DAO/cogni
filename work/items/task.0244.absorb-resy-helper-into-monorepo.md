---
id: task.0244
type: task
title: "Absorb cogni-resy-helper into monorepo — make fork obsolete"
status: done
priority: 0
rank: 1
estimate: 5
summary: "Pull apps/poly, packages/market-provider, poly-brain graph, and market-list tool from cogni-resy-helper fork into cogni-template monorepo. Each node becomes a separate webapp under apps/. Shared packages stay shared. Fork becomes read-only archive."
outcome: "cogni-resy-helper is obsolete. Poly node runs as apps/poly within the monorepo. Market-provider package and poly-brain graph are first-class shared packages. Node-template extraction (task.0233) has a concrete reference implementation of multi-node monorepo."
spec_refs:
  - docs/spec/node-formation.md
  - docs/spec/node-launch.md
  - docs/spec/node-operator-contract.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/absorb-resy-helper
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-04-01
labels: [nodes, multi-app, monorepo]
external_refs:
---

## Context

`cogni-resy-helper` is a fork of `cogni-template` with ~2,500 lines of delta:

- `apps/poly/` — Next.js landing page (Three.js, Framer Motion, port 3100)
- `packages/market-provider/` — Polymarket + Kalshi adapters (port pattern)
- `packages/langgraph-graphs/src/graphs/poly-brain/` — prediction market graph
- `packages/ai-tools/src/tools/market-list.ts` — AI tool for market queries
- `apps/operator/src/bootstrap/` — container wiring for market capability

The fork diverged because we didn't yet support multiple node apps in the monorepo.
Now we do (pnpm workspaces already resolve `apps/*`). Time to absorb.

## Architecture Decision

**Monorepo with multiple apps, NOT submodules.** Rationale:

- pnpm workspaces resolve `apps/*` natively
- Submodules break workspace resolution and add merge friction
- Graph-scoped builds (proj.cicd-services-gitops P2/P5) solve CI isolation properly
- DEPLOY_INDEPENDENCE (node-operator-contract) is about runtime, not repo structure

**Each node = one or more apps under `apps/`.** Current:

- `apps/operator` — operator + default node (chat, admin, AI runtime)
- `apps/poly` — poly prediction market node (landing page, eventually full app)

Future pattern (per node-operator-contract goals):

- `apps/{node}-landing` — marketing/blog (static, cheap)
- `apps/{node}-app` — user-facing SPA (auth, chat, tools)
- `apps/{node}-admin` — DAO governance dashboard

## Plan

### Phase 1: Pull delta (this task)

1. Copy `apps/poly/` from resy-helper `feat/market-provider-package` branch
2. Copy `packages/market-provider/` from same branch
3. Cherry-pick poly-brain graph into `packages/langgraph-graphs/`
4. Cherry-pick market-list tool into `packages/ai-tools/`
5. Wire bootstrap bindings in `apps/operator/`
6. Validate: `pnpm install`, typecheck, build, unit tests

### Phase 2: Verify parity (follow-up)

1. Run apps/poly dev server — confirm landing page renders
2. Run apps/operator chat — confirm poly-brain graph appears in picker
3. Run market-list tool — confirm Polymarket/Kalshi adapters work

### Phase 3: Archive fork

1. Push final state to cogni-resy-helper main
2. Update README: "This repo is archived. Development continues in cogni-template."
3. Archive GitHub repo (read-only)

## Non-goals

- Resy-specific features (no separate resy app yet — those features live in apps/operator)
- CI/CD per-app isolation (that's proj.cicd-services-gitops P2+)
- Node provisioning automation (that's node-launch.md scope)

## Validation

- [ ] `pnpm install` resolves all new deps (apps/poly, packages/market-provider)
- [ ] `pnpm packages:build` — all packages build including market-provider
- [ ] `pnpm --filter @cogni/ai-tools typecheck` — passes with market-list tool
- [ ] `pnpm --filter @cogni/langgraph-graphs typecheck` — passes with poly-brain graph
- [ ] `pnpm --filter @cogni/market-provider typecheck` — passes
- [ ] `pnpm --filter operator typecheck` — passes with MarketCapability wiring
- [ ] Unit tests: 120 tests across 17 files (ai-tools, langgraph-graphs, market-provider)
- [ ] `apps/poly` dev server renders landing page on port 3100
- [ ] `apps/operator` chat shows "Poly Brain" in graph picker
