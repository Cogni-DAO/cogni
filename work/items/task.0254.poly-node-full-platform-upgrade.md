---
id: task.0254
type: task
title: "Upgrade poly node landing page onto full platform base"
status: needs_implement
priority: 1
rank: 3
estimate: 2
summary: "The poly node currently has the full operator platform with the original poly landing page components layered on top. The landing page components (NeuralNetwork, MarketCards, AgentStream, BrainFeed, Hero) have strict-mode type errors and missing Three.js JSX type definitions. Fix type errors so pnpm typecheck:poly passes clean."
outcome: "Poly node boots, typechecks, and serves the Three.js landing page with full platform (auth, chat, streaming) behind it."
spec_refs: []
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [poly, nodes, type-errors]
external_refs: []
---

## Context

The poly node was rebuilt from node-template (full platform) with the original
poly landing page components restored. The components were written without
strict TypeScript and have ~80 type errors (mostly `possibly undefined` and
missing `@react-three/fiber` JSX element types).

## Plan

1. Fix `NeuralNetwork.tsx` — add `@react-three/fiber` JSX type augmentation,
   add null checks for array access
2. Fix `MarketCards.tsx` — null checks for outcome access
3. Fix `AgentStream.tsx` — null checks for sequence/event access
4. Verify `pnpm typecheck:poly` passes
5. Verify poly dev server renders landing page on :3100

## Validation

- [ ] `pnpm typecheck:poly` passes
- [ ] `pnpm dev:poly` renders Three.js landing page
- [ ] Sign in → redirects to /chat with full platform
