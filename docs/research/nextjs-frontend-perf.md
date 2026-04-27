---
id: nextjs-frontend-perf
type: research
status: active
trust: draft
title: "Next.js Frontend Performance — Operator + Poly Nodes"
summary: Audit of operator + poly Next.js apps for missing top-0.1% practices around SSR, route transitions, and bundle size. Identifies the dominant perf hit (entire app wrapped in next/dynamic ssr:false) plus 14 secondary findings, and proposes a phased fix.
read_when: Improving frontend perceived perf, reviewing SSR/provider boundaries, or auditing the Next.js App Router setup in any node.
owner: derekg1729
created: 2026-04-27
verified: 2026-04-27
tags: [frontend, perf, ssr, nextjs, research]
---

# Research: Next.js Frontend Performance — Operator + Poly Nodes

> spike: spike.0401 | date: 2026-04-27

## Question

The operator and poly Next.js apps feel slow and unresponsive — usable, but
unprofessional. The user asked for a top-0.1% scan: what SSR, transition, and
"obvious" perf practices are we missing? This document inventories concrete
problems found in the current code and ranks fixes by impact / effort.

Scope: client-perceived perf only — TTFB, TTI, route transitions, perceived
latency. Server-side throughput and AI streaming latency are out of scope.

## Context

- Both nodes are Next.js 15.x App Router on Node, deployed `output: "standalone"` to k3s.
- Shared client provider stack lives in `packages/node-app/src/providers/`:
  `AuthProvider` (next-auth) → `QueryProvider` (TanStack Query) → `WagmiProvider` →
  `RainbowKitSiweNextAuthProvider` → `RainbowKitProvider`.
- App shell composed in `nodes/{operator,poly}/app/src/app/`:
  - `layout.tsx` — root, loads Manrope + RainbowKit CSS, mounts `Providers`.
  - `providers-loader.client.tsx` — wraps the provider tree in `next/dynamic({ ssr: false })`
    to dodge `@walletconnect` indexedDB access during SSR (bug.0157).
  - `providers.client.tsx` — composes the full provider tree.
  - `(app)/layout.tsx` — `"use client"` sidebar + topbar shell.
  - `(app)/<route>/page.tsx` — small server component that does
    `await getServerSessionUser()`, then renders a `"use client"` `view.tsx`.
  - `view.tsx` — client view with TanStack Query polling (5–30 s intervals).
- No `loading.tsx`, no `error.tsx`, no `Suspense` boundaries, no `dehydrate/HydrationBoundary`.
- No bundle analyzer, no `experimental.optimizePackageImports`, no PPR.

## Findings — what we're missing, ranked by impact

### 1. The entire app is rendered with SSR disabled (CRITICAL)

`providers-loader.client.tsx` uses `next/dynamic(() => import('./providers.client'), { ssr: false })`
to skip SSR for the wallet stack. Because `Providers` wraps `{children}` in
`layout.tsx`, **every route under it is also SSR-skipped**. The user gets a
blank HTML shell and waits for the JS bundle to download, parse, hydrate, and
mount before _anything_ visible appears. This is the dominant cause of "feels
slow."

The original constraint is real: `@walletconnect/*` references `indexedDB` at
import time and crashes Next's SSG/SSR worker. But the fix was applied at the
wrong layer — gating the _entire app_ on a wallet-only library.

**Fix:** isolate wallet providers to a wallet-scoped boundary. Only the
`/credits`, `/wallet-test`, and any "Connect Wallet" button need
Wagmi/RainbowKit. Lazy-load that subtree on demand. Move `AuthProvider` and
`QueryProvider` back to a normal SSR-friendly client component at the root.

- Pattern: split into `<RootProviders>` (auth + query, SSR-safe) and
  `<WalletProviders>` (wagmi + rainbowkit, lazy + ssr:false) mounted only
  inside routes/components that need wallet state.
- Companion: lazy-import `wagmi/connectors` and use
  `dynamic(() => import('@rainbow-me/rainbowkit').then(m => m.ConnectButton), { ssr: false })`
  for the connect button itself.

### 2. No streaming SSR / no `loading.tsx` / no Suspense (CRITICAL)

Every page does:

```tsx
export default async function Page() {
  const user = await getServerSessionUser();
  if (!user) redirect("/");
  return <ClientView />; // "use client" — does its own React Query fetches
}
```

So the server: (a) blocks on session, (b) renders an empty client view, (c) ships
JS, (d) hydrates, (e) _then_ fires `/api/v1/...` for data. The user sees blank →
spinner → data. There is no `loading.tsx` so route transitions look frozen.

**Fix:**

- Add `loading.tsx` next to every page → instant skeleton on navigation.
- Add `error.tsx` for graceful failure.
- Move the first paint of data into a Server Component that fetches with the
  session and streams via `<Suspense>`, then hand off to a client child for
  interactivity. For TanStack Query, prefetch on the server with `dehydrate`
  and a `<HydrationBoundary>` so the client mounts with data already there
  (TanStack Query SSR guide).
- Where session is the only blocker, push it to the proxy (`src/proxy.ts`)
  instead of repeating `await getServerSessionUser()` in every page.

### 3. `(app)/layout.tsx` is `"use client"` for no reason

The sidebar/topbar shell is a static structural component but is fully
client-rendered. Combined with #1, the chrome itself blocks on JS.

**Fix:** make `(app)/layout.tsx` a server component. `SidebarProvider` can
remain a client island that wraps just the interactive part. `AppSidebar` can
render statically with a small client toggle.

### 4. Heavy provider tree paid on every route

Every route — even ones with no wallet UI — pulls in `wagmi`, `viem`,
`@rainbow-me/rainbowkit`, `@rainbow-me/rainbowkit-siwe-next-auth`, and the
RainbowKit CSS. Rough estimate: ~250–350 kB gzipped client JS that 80 % of
pages don't need.

**Fix:** route-scoped providers (see #1) + drop the global RainbowKit CSS
import from `layout.tsx`; load it inside the wallet boundary.

### 5. No `optimizePackageImports` / bundle analyzer

`next.config.ts` has no `experimental.optimizePackageImports`. We import from
`lucide-react`, `@radix-ui/*`, `@tanstack/react-table`, `@tanstack/react-query`,
`@assistant-ui/*`, `@dnd-kit/*` — all of which Next can tree-shake far more
aggressively when listed there. `lucide-react` alone is ~1 MB unminified.

**Fix:**

```ts
experimental: {
  optimizePackageImports: [
    "lucide-react",
    "@radix-ui/react-icons",
    "@tanstack/react-table",
    "@tanstack/react-query",
    "@assistant-ui/react",
    "@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/modifiers",
    "date-fns", // if used
  ],
},
```

Plus add `@next/bundle-analyzer` and a one-shot `pnpm analyze` script per node
so we have ground truth before optimizing further.

### 6. Polling without `keepPreviousData` causes flicker

`useQuery({ queryKey, refetchInterval: 5_000 })` without
`placeholderData: keepPreviousData` re-enters loading state on each
window-focus refetch. Combined with conditional render
(`{loading ? skeleton : data ? table : empty}`) it produces visible thrash.

Default in `query-provider.tsx` is just `staleTime: 60_000` and nothing else.

**Fix:** raise the default to include

```ts
defaultOptions: {
  queries: {
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,  // keepPreviousData — no flicker
  },
},
```

Polling stays, the table just keeps the previous frame visible.

### 7. No `Link` prefetch tuning, no `useTransition` on heavy nav

Default Next `<Link>` prefetch is fine, but with #1 in place every prefetch is
a JS-only fetch with no HTML payload. Once SSR is restored, `<Link prefetch>`
will preload real HTML. For tab-switches inside a page (e.g. dashboard
`user`/`system` toggle that triggers new queries), wrap state changes in
`useTransition` so the UI stays interactive while data resolves.

### 8. No PPR (Partial Prerendering)

Next 15.x ships `experimental.ppr = "incremental"` — static shell + dynamic
holes streamed from the edge. Once the `ssr: false` global wrap is removed,
PPR makes the sidebar + topbar instant on cold loads.

**Fix:** add `experimental.ppr = "incremental"` and opt-in per route with
`export const experimental_ppr = true;` once Suspense boundaries exist.

### 9. Fonts: missing `display: 'swap'`

`Manrope({ subsets: ["latin"] })` — no `display`. Next defaults to `swap` for
`next/font/google`, so this is probably fine, but explicit is better. Worth
setting `display: "swap"`, `preload: true`, and using the CSS variable form
(`variable: "--font-manrope"`) to avoid layout shift.

### 10. `<Script src="/theme-init.js" strategy="beforeInteractive">`

`beforeInteractive` blocks first paint on a tiny script that could just be
inlined in the `<head>` (or use `next-themes`'s built-in script). It is a
small contributor but it is a render-blocker on every load.

### 11. No `next/image` for any of the wallet/avatar images

Skim of code does not show systematic `next/image` usage. Worth a pass.

### 12. Auth re-checked in every page

Every server component does `await getServerSessionUser()`. The proxy already
runs on every request and resolves a token (`getToken`); have it write a
header and let pages read it cheaply, or rely on the proxy for the redirect
entirely.

### 13. No error/loading observability for slow renders

There's no Web Vitals reporting. We can't tell which routes are slow on real
users. Next has a built-in `reportWebVitals` hook → ship LCP/FID/CLS/INP to
Loki via `/api/v1/internal/metrics` (or Langfuse for traces) so we can find
the biggest offenders empirically.

### 14. Duplicate `Providers` per node

`providers.client.tsx` is duplicated across `nodes/operator/app` and
`nodes/poly/app`. Same drift surface, same fixes required twice. After the
fix in #1, the wallet-scoped provider should live in `packages/node-app` and
be consumed identically by both nodes.

### 15. `serverExternalPackages` is good — keep it

The big list in `next.config.ts` is correct and fixes a real problem
(per-route duplication of heavy server deps in dev). No change needed; called
out so we don't regress it.

## Recommendation

Treat the bundle as a **two-phase fix**:

**Phase 1 — instant perceived-perf wins (1 small PR each, no architecture change):**

1. Add `loading.tsx` per route (every `(app)/<route>/`).
2. Set TanStack Query defaults to keep previous data + no window-focus refetch.
3. Add `experimental.optimizePackageImports` for lucide/radix/dnd-kit/tanstack.
4. Wire `@next/bundle-analyzer` and ship a baseline report into `docs/research/`.
5. Drop `next-themes` blocking `<Script>` in favor of the library's own.

This is half a day of work and will visibly speed up navigation.

**Phase 2 — fix the SSR architecture (1 medium PR, shared between nodes):**

6. Split providers into `<RootProviders>` (SSR-safe) and `<WalletProviders>` (lazy + ssr:false).
7. Make `(app)/layout.tsx` a server component; isolate interactive bits.
8. Add `<Suspense>` + server-side prefetch with `dehydrate`/`HydrationBoundary` for the
   data each page already fetches client-side (start with `dashboard` and `work`).
9. Move repeated `getServerSessionUser` redirects to the proxy.
10. Once stable: enable `experimental.ppr = "incremental"` and opt routes in.

After Phase 2: ship Web Vitals reporting (#13) so we can prove the win and
catch regressions on real candidate-a traffic.

**Trade-offs accepted:**

- The wallet-provider split has a real refactor cost in poly (more wallet
  surfaces than operator). We accept that — the alternative is paying
  wagmi/walletconnect on every route forever.
- Server-side prefetch with TanStack Query duplicates fetch logic between
  server/client adapters. Acceptable; the alternative (full migration to RSC
  data fetching) is much larger and out of scope.
- PPR is `experimental`. We pin Next exact and gate the rollout per route.

## Open Questions

- **bug.0157** (WalletConnect → pino@7 → thread-stream test files in Turbopack) —
  is this still a hard blocker on running wagmi under SSR, or did the
  `thread-stream` shim already neutralize it? Need to test removing
  `ssr: false` from a wallet-only boundary.
- Does `@assistant-ui/react` have an SSR-safe import path? It is on the chat
  page and is heavy.
- Are there existing per-node Web Vitals dashboards in Grafana, or do we
  need to provision one?
- How much of the perceived slowness is HTTP API latency rather than client
  render? A quick Loki query on `/api/v1/work/items` p95 will tell us
  whether #2 (streaming SSR) actually helps or whether the bottleneck is
  upstream.

## Proposed Layout

This is directional, not binding.

**Project**: no new project. This work fits cleanly into a small
`proj.frontend-perf` or, more honestly, slots under whatever existing UX
project covers operator/poly chrome (none currently — fine to leave as
project-less work).

**Specs**: one new spec, `docs/spec/frontend-architecture.md`, capturing as-built
provider boundaries (root vs wallet), where SSR/streaming is required, the
prefetch contract for TanStack Query, and the perf budget (LCP target,
bundle-size ceiling per route group). Write this _after_ Phase 2 lands so it
documents reality.

**Tasks** (sequence, as prose — not pre-decomposed work items):

1. Phase 1 quick wins as a single bundled PR — `loading.tsx` files, query
   defaults, optimizePackageImports, bundle analyzer, theme script. Cheap;
   no design needed.
2. Phase 2a: provider split + SSR-restore — needs a design pass first
   because bug.0157 may force compromises. Convert to a `task.*` after we
   verify the WalletConnect SSR blocker on a branch.
3. Phase 2b: server-prefetch + Suspense for dashboard + work — only after
   2a. PR-sized.
4. Phase 2c: PPR opt-in per route — small follow-up after 2b is stable on
   candidate-a.
5. Web Vitals reporting + Grafana dashboard — folded into the
   `monitoring-expert` workstream.

Each step is independently shippable and independently flightable to
candidate-a, which matches our "prototype against reality" loop. Do **not**
fan these out into work items now — convert to `task.*` only when the prior
step proves out.
