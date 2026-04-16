---
id: task.0274
type: task
title: "Wire NodeAppConfig into sidebar + layout components"
status: needs_design
priority: 3
rank: 20
estimate: 2
summary: "Make node-config.ts the single source for node identity. Sidebar, header, topbar read navItems/externalLinks/logo from useNodeAppConfig() instead of hardcoded constants."
outcome: "Adding/removing a nav item or external link = edit node-config.ts. No more scattered NAV_ITEMS/EXTERNAL_LINKS constants across layout components."
spec_refs:
  - spec.node-app-shell
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02

labels: [refactor, nodes, ux]
external_refs:
---

# Wire NodeAppConfig into sidebar + layout components

## Context

Phase 3 of task.0248 created `NodeAppConfig`, `NodeAppProvider`, `useNodeAppConfig()`, and `node-config.ts` in all 4 apps. These define navItems, externalLinks, logo, and sidebarExtras. But nothing consumes them yet — the sidebar/header still hardcode their own constants.

This is the follow-up that makes node-config.ts actually useful.

## Design decisions needed

- Should the sidebar import `useNodeAppConfig()` directly, or should the layout inject config via props?
- Should `ChatThreadsSidebarGroup` (feature-specific) be injected via `sidebarExtras`, or stay hardcoded in AppSidebar?
- Should `AppHeader` and `AppTopBar` also read from config (logo, socials), or stay as-is?
- Does `NodeAppProvider` wrap at the root layout level, or at the (app) layout level?

## Plan

- [ ] Add `NodeAppProvider` to root layout (wrapping children with node-config)
- [ ] Refactor `AppSidebar` to read `navItems` + `externalLinks` from `useNodeAppConfig()`
- [ ] Remove hardcoded `NAV_ITEMS` / `EXTERNAL_LINKS` constants from each AppSidebar.tsx
- [ ] Inject `ChatThreadsSidebarGroup` via `sidebarExtras` in node-config.ts
- [ ] Update `AppHeader` logo/branding to read from config (optional)
- [ ] `pnpm check:fast` passes
- [ ] Verify sidebar renders correctly for operator, node-template, poly, resy

## Validation

```bash
pnpm check:fast
pnpm --filter operator build
```
