---
id: task.0402
type: task
title: "Scope wallet provider boundary — restore SSR for all non-wallet routes"
status: needs_design
priority: 0
rank: 1
estimate: 3
summary: "Stop wrapping the entire app in next/dynamic({ ssr: false }). Split providers into a root tier (auth + query, SSR-safe) and a wallet tier (wagmi + rainbowkit + walletconnect, lazy + ssr:false), so only routes/components that actually need wallet state pay the wallet bundle and skip SSR. Closes bug.0157 by scoping the workaround correctly instead of containing it via a thread-stream noop alias."
outcome: "Non-wallet routes render with SSR restored on operator (Phase 1) and on poly + resy + node-template (Phase 2). Shared `RootProviders` / `WalletProviders` / `WalletGate` live in packages/node-app. Wallet flows (`/credits`, ConnectButton) still work. bug.0157's `thread-stream` resolveAlias either removed or scoped/documented. Validated on candidate-a per the validation block below."
spec_refs:
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, ssr, nextjs, wallet]
external_refs:
  - docs/research/nextjs-frontend-perf.md
  - work/items/spike.0401.nextjs-frontend-perf.md
  - work/items/bug.0157.walletconnect-pino-ssr-bundling.md
---

## Problem

Every route in operator + poly + resy + node-template renders with SSR
disabled. Root cause: `nodes/<node>/app/src/app/providers-loader.client.tsx`
does:

```ts
const DynamicProviders = dynamic(
  () => import("./providers.client").then((m) => m.Providers),
  { ssr: false }
);
```

…and that `Providers` wraps `{children}` in `layout.tsx`. The original
intent was just to dodge `@walletconnect/*` indexedDB access during SSR
(see bug.0157), but the boundary was placed at the root, so the whole app
loses SSR. The user sees a blank HTML shell until JS hydrates. Likely
also the source of the noisy IndexedDB warnings on boot.

bug.0157's stated outcome already names the correct scope:
"WalletConnectButton (and its RainbowKit parent) is loaded via
next/dynamic with ssr: false. No thread-stream noop stub needed."
This task delivers that.

## Approach

The wallet stack (`wagmi`, `viem`, `@rainbow-me/rainbowkit`,
`@rainbow-me/rainbowkit-siwe-next-auth`, walletconnect transitive) is the
_only_ part of the provider tree that can't SSR. Auth (next-auth) and
TanStack Query both SSR fine. So:

- `packages/node-app/src/providers/` gains:
  - `RootProviders` (client component, SSR-safe) — composes
    `AuthProvider` + `QueryProvider`. Replaces the current `Providers`
    composition for the non-wallet path.
  - `WalletProviders` (client component, lazy-loaded with `ssr: false`)
    — composes `WagmiProvider` + `RainbowKitSiweNextAuthProvider` +
    `RainbowKitProvider`. Takes a `config: Config` prop so each node
    passes its own `wagmiConfig`.
  - A `useWallet` / `<WalletGate>` helper for the small set of components
    that actually need wallet context, mounting `WalletProviders` on
    demand.
- `RainbowKit` CSS import moves out of root `layout.tsx` into the wallet
  boundary.
- Each node's `nodes/<node>/app/src/app/`:
  - `providers-loader.client.tsx` is deleted.
  - `providers.client.tsx` becomes a thin `<RootProviders>` wrapper that
    wires the node-local `wagmiConfig` into a `WalletProvidersContext`
    so deep components can lazy-mount it without prop-drilling.
  - `layout.tsx` mounts `RootProviders` directly (no more `next/dynamic`).
- Surfaces that need wallet state (`/credits`, `/wallet-test`,
  `ConnectButton` in topbar/header, poly's wallet panels) wrap
  themselves in `<WalletProviders config={wagmiConfig}>` via a shared
  `<WalletGate>` to keep the call site small.
- Verify the `thread-stream` noop alias in `next.config.ts` can be
  removed. If Turbopack still follows the chain on a now-much-smaller
  surface, leave the alias and note it; if not, drop it (closes
  bug.0157 cleanly).

## Phasing

**Phase 1 — operator POC + candidate-a validation.**

- Land the shared `RootProviders` / `WalletProviders` / `WalletGate` in
  `packages/node-app/src/providers/`.
- Wire operator only. Other nodes keep working off the old pattern in
  this PR (the new shared exports are additive).
- Identify operator's wallet-bearing surfaces, gate each with
  `<WalletGate>`.
- Restore SSR on operator's root `layout.tsx`.
- Try removing the `thread-stream` resolveAlias for operator. If the
  Docker build (`pnpm check:full` operator-build job) still fails,
  leave the alias for now and note it as residual.
- Flight to candidate-a, then run the validation block below.

**Phase 2 — port poly + resy + node-template.**

- Mechanical port: each node's `providers.client.tsx` collapses to a
  `<RootProviders>` wrapper; `providers-loader.client.tsx` is deleted;
  wallet-bearing surfaces wrap in `<WalletGate>` with the node-local
  `wagmiConfig`.
- Drop the `thread-stream` resolveAlias from each node's `next.config.ts`
  if Phase 1 proved it removable; otherwise leave with a TODO.
- Flight each node and re-run the same validation against its routes.

Single shared package + four nearly-identical node call sites means
Phase 2 is small and mostly diff-paste. Splitting still de-risks the
rollout: if Phase 1 surfaces a wagmi-on-SSR regression we missed, only
operator pays.

## Validation

```
exercise:
  Phase 1 — on candidate-a operator:
    1. `curl -s https://<candidate-a-operator>/dashboard | head -c 4000`
       must return a non-empty HTML body containing the sidebar/topbar
       chrome and the dashboard headline (proving SSR is back).
    2. Open the same URL in a real browser with JS disabled — the
       chrome and skeletons should still render.
    3. Re-enable JS, click "Connect Wallet" → RainbowKit modal opens,
       connect succeeds, balance loads on /credits. (Wallet path still works.)
    4. Bundle analyzer report: non-wallet route group's first-load JS
       should drop noticeably (target: -100 kB+ gzip vs current).
  Phase 2 — repeat #1 and #3 on candidate-a poly + resy + node-template.

observability:
  Loki query at the deployed SHA, scoped to the agent's own session:
    {app="operator", env="candidate-a"} |= "/dashboard"
       | json | http_status_code = "200"
       | line_format "{{.method}} {{.path}} {{.duration_ms}}"
  Confirm a 200 with a non-trivial response size for the SSR HTML
  request (not just the JS chunk request).
```

## Out of Scope

- `loading.tsx` / Suspense / server prefetch / PPR — those are spike.0401
  Phase 1 / 2b / 2c, separate tasks.
- Rewriting `(app)/layout.tsx` to a server component — depends on this
  task but is not required for the SSR win and can land after.
- `experimental.optimizePackageImports`, bundle analyzer wiring — small
  separate PR(s).

## Closes / Relates

- Closes bug.0157 (delivers its stated outcome correctly scoped).
- Implements Phase 2a from spike.0401.
