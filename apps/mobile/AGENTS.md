# apps/mobile — Cogni Mobile App

> Expo (React Native) app providing mobile access to all Cogni nodes.

## Ownership

- **Owner**: `apps/mobile/`
- **Type**: Expo app (not a Next.js app — different bundler, different runtime)
- **Framework**: Expo SDK 53, Expo Router, NativeWind (Tailwind for RN)

## Imports

- **may_import**: `@cogni/node-contracts`, `@cogni/node-core`, `@cogni/node-shared`, `zod`
- **must_not_import**: `@cogni/db-client`, `@cogni/db-schema`, `@cogni/node-app`, any package with Node builtins (`fs`, `crypto`, `net`)

## Key Files

| File | Purpose |
| --- | --- |
| `metro.config.js` | pnpm workspace resolution + package exports |
| `app/_layout.tsx` | Root layout (NodeProvider, StatusBar) |
| `app/(auth)/login.tsx` | Auth screens (OAuth, later SIWE) |
| `app/(app)/_layout.tsx` | Tab navigator (Chat, Settings) |
| `lib/node-context.tsx` | Multi-node state (active node, switcher) |

## Constraints

- **NO_NODE_BUILTINS**: Never import packages that use `fs`, `crypto`, `net`, or other Node APIs
- **SHARED_CONTRACTS_ONLY**: API types come from `@cogni/node-contracts`, never duplicated
- **DIRECT_TO_NODE**: App talks directly to node APIs, no BFF gateway
