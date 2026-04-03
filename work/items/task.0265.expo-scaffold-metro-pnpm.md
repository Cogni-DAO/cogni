---
id: task.0265
type: task
title: "Scaffold apps/mobile/ — Expo Router + Metro pnpm workspace config"
status: needs_closeout
priority: 2
rank: 2
estimate: 2
summary: "Create the Expo app skeleton in apps/mobile/ with file-based routing, Metro configured for pnpm workspaces, and @cogni/node-contracts imported successfully."
outcome: "apps/mobile/ builds and runs in Expo Go. Imports from @cogni/node-contracts resolve correctly. Expo Router navigates between placeholder screens."
spec_refs: []
assignees: derekg1729
credit:
project: proj.mobile-app
branch: feat/task-0265-expo-scaffold
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
external_refs:
  - docs/research/mobile-app-strategy.md
---

# Scaffold apps/mobile/ — Expo Router + Metro pnpm workspace config

## Goal

Bootstrap the Expo app in the monorepo. Validate that pnpm workspace packages (`@cogni/node-contracts`, `@cogni/node-core`) are consumable by Metro bundler.

## Implementation Plan

- [x] Scaffold `apps/mobile/` with Expo SDK 53, Expo Router, NativeWind
- [x] Configure `metro.config.js` for pnpm symlink resolution and `unstable_enablePackageExports`
- [x] `apps/mobile` already covered by `pnpm-workspace.yaml` via `apps/*` glob
- [ ] Add workspace deps `@cogni/node-contracts`, `@cogni/node-core` (deferred: packages not yet on staging, see task.0248)
- [x] Create placeholder screens: `app/(auth)/login.tsx`, `app/(app)/chat/index.tsx`, `app/(app)/settings/index.tsx`
- [ ] Verify `import { ... } from '@cogni/node-contracts'` resolves in Metro (deferred: packages not yet on staging)
- [x] React 19 pinned in `package.json` to match web app
- [x] Add `apps/mobile` to `.dockerignore`
- [x] Add `AGENTS.md` with import boundaries
- [x] Create `lib/node-context.tsx` — multi-node state management

## Validation

```bash
cd apps/mobile && npx expo start  # runs in Expo Go
# Verify: no Metro resolution errors, placeholder screens navigate correctly
```
