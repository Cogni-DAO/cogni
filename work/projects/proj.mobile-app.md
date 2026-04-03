---
id: proj.mobile-app
type: project
primary_charter:
title: "Mobile App — Single App, All Nodes"
state: Active
priority: 2
estimate: 8
summary: "Ship a single mobile app providing access to all Cogni nodes. PWA for immediate reach, Expo for App Store presence."
outcome: "Users install one app, connect to any Cogni node (operator, poly, resy), chat with AI agents, view activity, and manage credits — from their phone."
assignees:
  - derekg1729
created: 2026-04-02
updated: 2026-04-02
labels:
  - mobile
  - ux
  - multi-node
---

# Mobile App — Single App, All Nodes

> Research: [docs/research/mobile-app-strategy.md](../../docs/research/mobile-app-strategy.md)

## Goal

Ship a single mobile app that provides access to all Cogni nodes. Users install one app, add nodes by URL, and get AI chat, activity dashboard, and credits management for any connected node.

## Context

### What exists today

- **3 Next.js web apps** (operator, poly, resy) with identical API surface
- **`@cogni/node-contracts`** — Zod schemas shared across all nodes, consumable by any JS runtime
- **`@cogni/node-core`**, **`@cogni/node-shared`** — pure packages, no Node builtins
- **OpenAPI v3** served at `/openapi.json` per node
- **Auth**: SIWE + OAuth (GitHub, Discord, Google) via NextAuth JWT
- **Streaming AI chat** via SSE

### Why mobile

- Users want to check agent activity, chat, and manage credits from their phone
- App Store presence increases discoverability and trust
- PWA gives immediate reach with zero new code

## Design Decisions

### One app, N nodes (node-switcher)

The API surface is identical across nodes (`@cogni/node-contracts`). Only the base URL and theme differ. A node-switcher stores `{ url, name, themeColor }[]` in AsyncStorage. Default: operator. Add nodes by URL.

### PWA first, Expo second

PWA is effectively free (manifest + service worker on existing apps). Expo follows for native performance, App Store presence, and proper wallet integration.

### OAuth-first auth on mobile

SIWE requires WalletConnect deep-linking which is fragile on mobile. MVP ships with OAuth (GitHub/Discord/Google via `expo-auth-session`). SIWE added as follow-on once wallet deep-linking is validated.

### Direct-to-node, no BFF

Mobile app talks directly to each node's API. No backend-for-frontend gateway. Matches decentralized architecture — each node is sovereign.

## Roadmap

### Crawl (P0): PWA

**Goal:** Mobile access today with zero new app code.

| Deliverable                                                 | Status      | Est | Work Item |
| ----------------------------------------------------------- | ----------- | --- | --------- |
| Add PWA manifests + service workers to operator + all nodes | Not Started | 1   | task.0264 |

### Walk (P1): Expo MVP

**Goal:** Native app with auth + AI chat for operator.

| Deliverable                                                   | Status      | Est | Work Item |
| ------------------------------------------------------------- | ----------- | --- | --------- |
| Scaffold `apps/mobile/` — Expo Router + Metro pnpm config     | Not Started | 2   | task.0265 |
| OAuth auth flow (GitHub/Discord/Google via expo-auth-session) | Not Started | 2   | task.0266 |
| Streaming AI chat screen using `@cogni/node-contracts`        | Not Started | 3   | task.0267 |

### Run (P2): Multi-Node + App Store

**Goal:** All nodes accessible. App Store submission.

| Deliverable                                   | Status      | Est | Work Item |
| --------------------------------------------- | ----------- | --- | --------- |
| Node-switcher + multi-backend support         | Not Started | 2   | task.0268 |
| Activity dashboard + credits screens          | Not Started | 2   | task.0269 |
| SIWE wallet auth via WalletConnect            | Not Started | 3   | task.0270 |
| EAS Build + TestFlight + App Store submission | Not Started | 2   | task.0271 |

## Architecture

### Mobile app structure

```
apps/mobile/                        # Expo app in the monorepo
├── app/                            # Expo Router (file-based routes)
│   ├── (auth)/                     # Login flows (OAuth, later SIWE)
│   ├── (app)/                      # Authenticated screens
│   │   ├── chat/                   # AI chat (streaming SSE)
│   │   ├── activity/               # Usage dashboard
│   │   ├── credits/                # Balance + payments
│   │   └── settings/               # Node switcher, profile
│   └── _layout.tsx                 # Root layout (node context provider)
├── lib/
│   ├── api-client.ts               # Typed fetch using @cogni/node-contracts
│   ├── node-context.ts             # Active node (URL, theme, name)
│   └── auth/                       # OAuth via expo-auth-session
├── package.json                    # deps: @cogni/node-contracts, @cogni/node-core
└── metro.config.js                 # pnpm workspace resolution
```

### Package consumption

```
@cogni/node-contracts  ─── shared directly (Zod schemas, typed API client)
@cogni/node-core       ─── shared directly (domain models, pure logic)
@cogni/node-shared     ─── shared directly (utils without Node builtins)
@cogni/db-client       ─── NOT consumed (Node builtins: fs, crypto)
@cogni/node-app        ─── NOT consumed (React/Next.js, web-only)
```

### Relationship to Other Projects

| Project                       | Relationship                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `proj.premium-frontend-ux`    | **Parallel.** Desktop web UX. Mobile is a separate delivery surface.                         |
| `proj.operator-plane`         | **Dependency.** Multi-node API contracts defined here. task.0248 extraction enables sharing. |
| `proj.decentralized-identity` | **Future.** Mobile SIWE depends on wallet deep-linking working reliably.                     |

## Constraints

- **SHARED_CONTRACTS_ONLY**: Mobile consumes `@cogni/node-contracts` — never duplicates API types
- **NO_NODE_BUILTINS**: Only packages without `fs`/`crypto`/`net` are consumed by mobile
- **OAUTH_BEFORE_SIWE**: MVP ships with OAuth auth. SIWE follows as a separate task.
- **DIRECT_TO_NODE**: No BFF. Mobile talks directly to each node's API.

## Dependencies

- [x] `@cogni/node-contracts` extracted (task.0248 Phase 1)
- [x] `@cogni/node-core` extracted (task.0248 Phase 1)
- [x] `@cogni/node-shared` extracted (task.0248 Phase 1)
- [x] OpenAPI v3 endpoint (`/openapi.json`)
- [ ] OAuth providers configured on all nodes (GitHub, Discord, Google)
- [ ] Expo SDK 52+ compatibility with pnpm monorepo validated (spike in task.0265)

## As-Built Specs

- [architecture.md](../../docs/spec/architecture.md) — Hexagonal layers, contract-first
- [packages-architecture.md](../../docs/spec/packages-architecture.md) — Capability package rules
- [node-app-shell.md](../../docs/spec/node-app-shell.md) — Three-layer dedup, package categories

## Design Notes

**PWA is phase zero, not a product.** It's a free bridge while the Expo app is built. No investment beyond manifest + service worker.

**OAuth before SIWE on mobile.** WalletConnect deep-linking is the highest-risk integration. Ship OAuth auth first, validate SIWE in a design spike (task.0270 is `needs_design`), then implement.

**Monorepo placement.** `apps/mobile/` sits alongside `apps/operator/`. It consumes only pure capability packages — never `src/` imports, never Node-dependent packages. The hex architecture boundary is preserved: mobile is just another delivery surface, like web or MCP.
