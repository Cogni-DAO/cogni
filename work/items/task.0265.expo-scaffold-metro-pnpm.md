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
external_refs:
  - docs/research/mobile-app-strategy.md
  - experiments/mobile-expo-poc/
---

# Scaffold apps/mobile/ — Expo Router + Metro pnpm workspace config

## Goal

Bootstrap the Expo app in the monorepo. Validate that pnpm workspace packages (`@cogni/node-contracts`, `@cogni/node-core`) are consumable by Metro bundler.

## POC Results (2026-04-02)

Validated in `experiments/mobile-expo-poc/`:

- **Expo SDK 54** + React 19.1 + RN 0.81 — loads on physical iPhone via Expo Go
- **NativeWind v4** — Tailwind className strings work identically to web
- **Expo Router** — file-based routing with `(auth)` and `(app)` groups works
- **Metro + pnpm** — `unstable_enablePackageExports` + monorepo watchFolders resolves workspace packages
- **AGENTS.md** — `services` layer with `may_import: ["packages"]` passes validation

### Gotchas discovered

- Expo Go on App Store ships SDK 54 — must match (SDK 53 rejected)
- AGENTS.md boundary validator: `apps/` has no path-to-layer mapping; use `"layer": "services"` for standalone apps that consume packages
- `CI=1` suppresses QR code — must run interactively for device testing
- `@expo/ngrok` required for `--tunnel` mode (cross-network testing)

## Implementation Plan

- [ ] Scaffold `apps/mobile/` with Expo SDK 54, Expo Router, NativeWind (reference: `experiments/mobile-expo-poc/`)
- [ ] Configure `metro.config.js` for pnpm symlink resolution and `unstable_enablePackageExports`
- [ ] Add workspace deps `@cogni/node-contracts`, `@cogni/node-core` (requires task.0248 merge)
- [ ] Verify `import { ... } from '@cogni/node-contracts'` resolves in Metro
- [ ] Create screens: auth, chat, settings with tab navigation
- [ ] Create `lib/node-context.tsx` — multi-node state management
- [ ] Add `apps/mobile` to `.dockerignore`
- [ ] Add `AGENTS.md` with `services` layer boundaries

## Validation

```bash
cd apps/mobile && npx expo start  # runs in Expo Go
# Verify: no Metro resolution errors, screens navigate correctly
```
