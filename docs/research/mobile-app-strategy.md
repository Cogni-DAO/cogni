---
id: research.mobile-app-strategy
type: research
title: "Mobile App Strategy for Multi-Node Access"
status: draft
trust: draft
summary: Research on mobile app strategy for multi-node access
read_when: Planning mobile app development or evaluating PWA vs native approaches
owner: derekg1729
created: 2026-04-02
verified: 2026-04-02
tags: [research, mobile]
---

# Research: Mobile App Strategy for Multi-Node Access

> spike: spike.mobile-app | date: 2026-04-02

## Question

What is the fastest path to making all Cogni nodes accessible via a mobile app? Should we target all nodes via one app, or start with operator-only?

## Context

Today each node (operator, poly, resy) is a Next.js App Router app with:

- **30+ API routes** per node (identical route structure across nodes — `v1/ai/chat`, `v1/payments`, `v1/activity`, `v1/public/*`, etc.)
- **OpenAPI v3 spec** generated from `@cogni/node-contracts` Zod schemas, served at `/openapi.json`
- **Auth**: SIWE (Sign-In With Ethereum) + OAuth (GitHub, Discord, Google) via NextAuth JWT strategy
- **Streaming AI chat** via SSE
- **Hex architecture** with clean separation: contracts → core → ports → features → adapters → app

Task.0248 has already extracted 3 pure capability packages (`@cogni/node-core`, `@cogni/node-contracts`, `@cogni/node-shared`) — all framework-agnostic, ESM, compiled to `dist/`. These are directly consumable by any JavaScript runtime including React Native.

The multi-node architecture uses identical API contracts. Each node is distinguished only by domain, theme, and feature routes — the platform layer is shared.

## Findings

### Option A: Progressive Web App (PWA)

- **What**: Add `manifest.json` + service worker to existing Next.js apps. Users "Add to Home Screen" from Safari/Chrome.
- **Pros**: Zero new code. Instant. Works on all nodes simultaneously (one URL per node). No App Store review.
- **Cons**: No App Store discoverability. iOS push notifications work only on 16.4+ for home-screen installs. WalletConnect redirect flows are clunky in Safari (no deep-link back). No native wallet UX.
- **OSS tools**: `@ducanh2912/next-pwa` or manual service worker
- **Fit with our system**: Trivial — we already have the web apps. 1-2 days of work. Great as an interim step.
- **MVP time**: 1-2 days
- **Multi-node**: Excellent — each node URL is its own PWA

### Option B: Expo (React Native) + Shared Packages

- **What**: Native mobile app using Expo SDK 52+, sharing `@cogni/node-contracts` and `@cogni/node-core` from the existing monorepo.
- **Pros**: True native app. App Store presence. WalletConnect works via `@web3modal/wagmi-react-native`. SSE streaming works via `react-native-sse`. Expo Router mirrors Next.js file-based routing. pnpm monorepo integration confirmed working (Expo docs + `byCedric/expo-monorepo-example`).
- **Cons**: wagmi React Native pinned to v1.x (lags v2). Need polyfills (`react-native-get-random-values`, `@ethersproject/shims`). OAuth requires `expo-auth-session` for redirect flows. 2-3 week MVP.
- **OSS tools**: `expo` (SDK 52+), `expo-router`, `wagmi` v1.x, `viem`, `@web3modal/wagmi-react-native`, `react-native-sse`, `eventsource-parser`, `expo-auth-session`
- **Fit with our system**: Strong. Our pure packages (`node-contracts`, `node-core`, `node-shared`) export ESM with no Node builtins — Metro handles them via `unstable_enablePackageExports`. Only packages touching `fs`/`crypto`/`net` are excluded (already cleanly separated in our architecture). Zod schemas shared directly.
- **MVP time**: 2-3 weeks
- **Multi-node**: Configure base URL per node in app state. Same contracts, same auth flow, different domain. Node switcher in app.

### Option C: Capacitor (Web Wrapper)

- **What**: Wrap statically-exported Next.js app in a native shell.
- **Pros**: Reuse existing web code entirely.
- **Cons**: Requires `output: 'export'` (static HTML) which breaks SSR and dynamic API routes. Apple Guideline 4.2 actively rejects "repackaged websites" — must add native navigation, push, offline states to pass review. WalletConnect deep-link redirects back into Capacitor are fragile.
- **Fit with our system**: Poor. Our apps rely on SSR/dynamic routes. Static export is a non-starter for the AI chat flow.
- **MVP time**: 2-4 weeks + App Store rejection risk
- **Multi-node**: Moderate — webview URL switching feels non-native

### Option D: Apple App Clips

- **What**: Lightweight entry points (15-50 MB) that require a parent App Store app.
- **Fit**: Not standalone. Useful only as a "try before install" onramp to a native app (Option B). Not a strategy by itself.

## Recommendation

**Two-phase approach: PWA now, Expo next.**

### Phase 1: PWA (1-2 days) — Immediate reach

Add PWA manifests to all nodes. This gives mobile access today with zero new app code. Every node becomes installable from the browser. This is effectively free.

### Phase 2: Expo App (2-3 weeks) — App Store presence

Build a single Expo app that connects to **all nodes** via a node-switcher. This is the "1 app, N nodes" strategy.

**Why Expo over Capacitor**: Our apps use SSR/dynamic routes, which Capacitor can't handle. Expo gives us native performance, App Store compliance, and direct Zod contract sharing from the monorepo.

**Why one app for all nodes**: The API surface is identical across nodes (`@cogni/node-contracts`). The only difference is the base URL and theme. A node-switcher (stored server list with domain + display name + theme color) lets users access operator, poly, resy, and any future node from one install.

**Architecture for the Expo app**:

```
apps/mobile/                        # New Expo app in the monorepo
├── app/                            # Expo Router (file-based routes)
│   ├── (auth)/                     # Login flows (SIWE + OAuth)
│   ├── (app)/                      # Authenticated screens
│   │   ├── chat/                   # AI chat (streaming SSE)
│   │   ├── activity/               # Usage dashboard
│   │   ├── credits/                # Balance + payments
│   │   └── settings/               # Node switcher, profile
│   └── _layout.tsx                 # Root layout (node context provider)
├── lib/
│   ├── api-client.ts               # Typed fetch using @cogni/node-contracts
│   ├── node-context.ts             # Active node (URL, theme, name)
│   └── auth/                       # SIWE + OAuth via expo-auth-session
├── package.json                    # deps: @cogni/node-contracts, @cogni/node-core
└── metro.config.js                 # pnpm workspace resolution
```

**Key decisions**:

- **API client** generated from `@cogni/node-contracts` Zod schemas (same source of truth as web)
- **Auth** uses same NextAuth JWT strategy — mobile just needs to POST credentials and store the JWT
- **Streaming** via `react-native-sse` + `eventsource-parser` (proven pattern in AI chat apps)
- **Node switcher** stores `{ url, name, themeColor }[]` in AsyncStorage. Default: operator. Add nodes by URL.

**What NOT to build in v1**: Push notifications, offline mode, on-chain transaction signing (use web fallback via in-app browser).

## Validated (POC 2026-04-02)

POC in `experiments/mobile-expo-poc/` confirmed on physical iPhone:

- **Expo SDK 54** + React 19.1 + RN 0.81 loads in Expo Go
- **NativeWind v4** — same Tailwind `className` strings as web app
- **Metro + pnpm workspaces** — `unstable_enablePackageExports` resolves workspace packages
- **Expo Router** — file-based routing with group layouts works
- **Next.js component reuse: NOT possible** — RN uses View/Text/Pressable, not DOM. Reuse is at the type/logic/styling-vocabulary level only. Use `react-native-reusables` (shadcn port) for equivalent component API.

### Auth path (critical finding)

NextAuth uses HttpOnly cookies — mobile can't use cookies. Two paths:
1. **API key flow** (`/api/v1/auth/openai-compatible/connect`) — works today, zero backend changes. Best for MVP.
2. **OAuth redirect** (`expo-auth-session`) — needs design work to extract JWT from NextAuth callback outside cookie context.

### Core tasks to real app (6 points)

1. API key auth via existing OpenAI-compatible endpoint (1pt)
2. SSE streaming chat client with `react-native-sse` (2pt)
3. Inline chat contracts or wait for task.0248 (1pt)
4. Persist node list + auth tokens in SecureStore/AsyncStorage (1pt)
5. `react-native-reusables` component kit for polished UI (1pt)

## Open Questions

- wagmi v1.x pin: is this blocking for SIWE? Web uses wagmi v2. Can they coexist in pnpm monorepo?
- Should node discovery be manual (paste URL) or use DNS convention (e.g., `api.{node}.cogni.dev`)?
- CI impact: does `apps/mobile/` in monorepo slow down existing pipelines? May need workspace filtering.

## Proposed Layout

### Project

`proj.mobile-app` — Goal: Ship a single mobile app providing access to all Cogni nodes.

Phases:

1. **PWA** — Add manifests to all nodes (1-2 days)
2. **Expo scaffold** — Auth + chat for operator-only (1-2 weeks)
3. **Multi-node** — Node switcher, all nodes accessible (1 week)
4. **App Store** — EAS Build, TestFlight, submission (1 week)

### Specs needed

- `spec.mobile-app` — API client contract sharing, auth flow on mobile, node-switcher protocol
- Update `spec.node-app-shell` — Add mobile as a consumer of capability packages

### Tasks (rough sequence)

1. `task.*` — Add PWA manifests to operator + nodes
2. `task.*` — Scaffold `apps/mobile/` with Expo Router + Metro config for pnpm workspace
3. `task.*` — Implement SIWE + OAuth auth flow on mobile
4. `task.*` — Build streaming AI chat screen using `@cogni/node-contracts`
5. `task.*` — Add node-switcher (multi-backend support)
6. `task.*` — Activity dashboard + credits screens
7. `task.*` — EAS Build + TestFlight + App Store submission
