---
id: task.0248
type: task
title: "Extract shared node platform into packages/node-platform"
status: needs_design
priority: 2
rank: 5
estimate: 5
summary: "Refactor the shared platform code (ports, core, shared, contracts, components, bootstrap patterns) out of apps/operator into a packages/node-platform package. All nodes and operator import from it instead of duplicating ~700 files."
outcome: "nodes/node-template/app is a thin shell (~50 files) that imports @cogni/node-platform for all shared platform functionality. Adding a new node means creating a thin app + graphs, not copying 800 files."
spec_refs:
  - docs/spec/architecture.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0247
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [refactor, architecture, nodes, packages]
external_refs:
---

## Context

After task.0244-0246, each node is a full copy of the operator app (~800 files).
This works for v0 but creates drift risk — platform fixes must be applied to
every node independently.

## Goal

Extract the shared AI app platform into `packages/node-platform` so nodes are
thin shells that import shared infrastructure:

- **ports/** — all 28 port interfaces
- **core/** — domain models (accounts, ai, billing, chat, payments)
- **shared/** — env, observability, auth, config, db, crypto, web3
- **contracts/** — Zod route contracts (ai._, payments._, schedules._, users._)
- **components/** — full UI kit (shadcn, kit/\*, chat)
- **bootstrap/** — DI container pattern, capability factories, http wrappers
- **features/** — platform features (ai, payments, accounts)
- **adapters/** — platform adapters (ai, db, payments, temporal, etc.)

## What stays in each node's app

- `src/app/` — node-specific pages and routes (homepage, custom pages)
- `src/features/` — node-specific features (e.g. reservations for resy)
- `src/bootstrap/container.ts` — node-specific capability wiring
- `graphs/` — node-specific AI graphs

## Shared UI standardization (part of extraction)

When extracting the platform package, also standardize these UI patterns
across all nodes so new nodes get them for free:

- Clean GitHub icon link in header (poly's pattern — no stars counter widget)
- Sign-in button/link in landing page header — keep the current teal-outlined style (poly's Header.tsx pattern is clean). Fix auth flow per bug.0255
- Per-node color theming via CSS variables only (operator=blue, poly=teal, resy=blue)

Related: bug.0255 (node landing page auth flow broken — useTryDemo not wired)

## Non-goals

- Runtime plugin system (nodes are still separate Next.js apps)
- Shared database migrations (each node manages own schema)

## Validation

- [ ] `packages/node-platform` builds independently
- [ ] `nodes/node-template/app` imports from `@cogni/node-platform`
- [ ] `apps/operator` imports from `@cogni/node-platform`
- [ ] All nodes + operator pass `pnpm check`
- [ ] No duplicate platform code across nodes
