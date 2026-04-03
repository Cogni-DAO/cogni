---
id: task.0264
type: task
title: "Add PWA manifests + service workers to operator + all nodes"
status: needs_implement
priority: 2
rank: 1
estimate: 1
summary: "Add manifest.json, service worker, and meta tags to operator, poly, resy, and node-template for installable PWA support on mobile devices."
outcome: "All nodes are installable from mobile browsers via Add to Home Screen. Each node has its own themed icon and splash screen."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
---

# Add PWA manifests + service workers to operator + all nodes

## Goal

Make all Cogni node web apps installable as PWAs on mobile devices. Zero new features — just the manifest, service worker, and meta tags needed for Add to Home Screen.

## Implementation Plan

- [ ] Add `manifest.json` to `apps/operator/public/` with name, icons, theme_color, start_url
- [ ] Add `manifest.json` to `nodes/node-template/app/public/`, `nodes/poly/app/public/`, `nodes/resy/app/public/`
- [ ] Add `<link rel="manifest">` and Apple meta tags to root layout of each app
- [ ] Add minimal service worker (cache-first for static assets, network-first for API)
- [ ] Use `@ducanh2912/next-pwa` or manual service worker registration
- [ ] Generate app icons (192x192, 512x512) for each node with node theme color
- [ ] Test Add to Home Screen on iOS Safari and Android Chrome

## Validation

```bash
pnpm check:fast
# Manual: open each node URL on mobile, verify Add to Home Screen prompt works
```
