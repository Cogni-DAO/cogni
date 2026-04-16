---
id: spike.0239
type: spike
title: "Three.js agent observatory — prototype + performance budget"
status: needs_triage
priority: 3
rank: 99
estimate: 2
summary: "Prototype a Three.js-powered agent observatory page. Agents as 3D characters in isometric workspace, driven by real-time SSE activity. Establish performance budget (bundle size, GPU, mobile fallback)."
outcome: "Working prototype of /observatory route with lazy-loaded Three.js scene, at least one animated agent character, and documented performance budget. Decision: proceed or defer."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, threejs, agents, spike]
external_refs:
---

# Three.js Agent Observatory — Prototype + Performance Budget

## Research Questions

1. Bundle size impact of `three` + `@react-three/fiber` + `@react-three/drei` with route-level code splitting?
2. GPU performance on low-end devices? Fallback strategy for mobile?
3. What does the scene show? Live agents working? Activity replay? Agent "home base"?
4. 3D asset pipeline: how do we create/source agent character models?
5. How does real-time SSE data drive 3D animation state?

## Scope

- Prototype only — no production code
- Lazy-loaded route (`/observatory`)
- At least one animated agent character
- Connected to live run activity via `useRunActivity` hook
- Performance measurements documented

## Validation

```bash
pnpm check:fast
```
