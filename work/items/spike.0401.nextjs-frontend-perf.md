---
id: spike.0401
type: spike
title: "Next.js frontend perf — operator + poly SSR / transitions / bundle audit"
status: done
priority: 1
rank: 99
estimate: 1
summary: "Audit operator + poly Next.js apps for missing top-0.1% practices around SSR, route transitions, and obvious bundle/perf wins. Identify highest-impact fixes."
outcome: "Research doc identifying the dominant perf hit (the entire app is wrapped in next/dynamic({ ssr:false })) plus 14 secondary findings. Phased recommendation: instant wins (loading.tsx, query defaults, optimizePackageImports, bundle analyzer) then SSR-architecture fix (provider split + Suspense + server prefetch + PPR)."
spec_refs:
assignees: derekg1729
credit:
project:
branch: worktree-research-nextjs-perf
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, ssr, nextjs, research]
external_refs:
  - docs/research/nextjs-frontend-perf.md
---

## Problem

Operator + poly UIs feel slow and unresponsive — usable but unprofessional.
First paint is gated on a large client JS bundle, route navigations have no
skeletons, and polled queries flicker on every refetch. We have not done a
systematic perf pass since the multi-node split.

## Goal

Identify the highest-impact gaps between our current setup and top-tier
Next.js App Router practice. Output a research doc, not code.

## Findings

See [docs/research/nextjs-frontend-perf.md](../../docs/research/nextjs-frontend-perf.md).

Headline: `nodes/{operator,poly}/app/src/app/providers-loader.client.tsx`
wraps the **entire** provider tree in `next/dynamic({ ssr: false })` to
work around `@walletconnect` indexedDB access during SSR. Side effect: SSR
is disabled for every route, so users wait for JS hydration before seeing
anything. Combined with no `loading.tsx`, no Suspense, no server prefetch,
and a heavy global provider stack (wagmi/rainbowkit on every page), this
is the dominant cause of perceived slowness.

Phased recommendation:

1. **Phase 1 (cheap, single PR):** `loading.tsx` per route, TanStack Query
   `placeholderData: keepPreviousData` + `refetchOnWindowFocus: false`,
   `experimental.optimizePackageImports`, `@next/bundle-analyzer`,
   replace blocking `<Script src="/theme-init.js" beforeInteractive>`.
2. **Phase 2 (architecture):** split providers into root (SSR-safe) +
   wallet (lazy ssr:false), make `(app)/layout.tsx` a server component,
   add `<Suspense>` + `dehydrate`/`HydrationBoundary` server prefetch on
   dashboard + work pages, move auth redirect into the proxy, then opt
   routes into `experimental.ppr = "incremental"`.
3. **Phase 3:** Web Vitals reporting → Loki/Grafana so we can prove the
   win and catch regressions on candidate-a.

## Validation

exercise: read `docs/research/nextjs-frontend-perf.md` and confirm it
covers SSR, transitions, bundle, and provides ranked, actionable fixes
with file references.
observability: n/a — research output, no runtime signal.

## Open Questions

- Is bug.0157 (WalletConnect → pino@7 → thread-stream test files in
  Turbopack) still a hard SSR blocker on a wallet-only boundary, or has
  the `thread-stream` shim already neutralized it? Phase 2a needs to
  prove this on a branch before committing to the provider split.
- Does `@assistant-ui/react` have an SSR-safe path?
