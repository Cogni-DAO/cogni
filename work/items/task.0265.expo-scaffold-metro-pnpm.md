---
id: task.0265
type: task
title: "Scaffold apps/mobile/ — Expo Router + Metro pnpm workspace config"
status: needs_implement
priority: 2
rank: 2
estimate: 2
summary: "Create the Expo app skeleton in apps/mobile/ with file-based routing, Metro configured for pnpm workspaces, and @cogni/node-contracts imported successfully."
outcome: "apps/mobile/ builds and runs in Expo Go. Imports from @cogni/node-contracts resolve correctly. Expo Router navigates between placeholder screens."
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

# Scaffold apps/mobile/ — Expo Router + Metro pnpm workspace config

## Goal

Bootstrap the Expo app in the monorepo. Validate that pnpm workspace packages (`@cogni/node-contracts`, `@cogni/node-core`) are consumable by Metro bundler.

## Implementation Plan

- [ ] `npx create-expo-app apps/mobile --template tabs` (Expo Router template)
- [ ] Configure `metro.config.js` for pnpm symlink resolution and `unstable_enablePackageExports`
- [ ] Add `apps/mobile` to `pnpm-workspace.yaml`
- [ ] Add workspace deps: `@cogni/node-contracts`, `@cogni/node-core`
- [ ] Create placeholder screens: `app/(auth)/login.tsx`, `app/(app)/chat/index.tsx`, `app/(app)/settings/index.tsx`
- [ ] Verify `import { ... } from '@cogni/node-contracts'` resolves in Metro
- [ ] Pin React/React Native as workspace singletons to avoid duplicate hook errors
- [ ] Add `apps/mobile` to `.dockerignore` (not needed in Docker builds)

## Validation

```bash
cd apps/mobile && npx expo start  # runs in Expo Go
# Verify: no Metro resolution errors, placeholder screens navigate correctly
```
