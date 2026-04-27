---
id: task.0402
type: task
title: "Restore SSR — drop the whole-app `next/dynamic({ ssr: false })` wrapper"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "The wagmi config already sets `ssr: true` + `cookieStorage` (the wagmi/RainbowKit-prescribed SSR pattern), but every node still wraps its entire provider tree in `next/dynamic({ ssr: false })` via `providers-loader.client.tsx`. This was added defensively during the multi-node split and is almost certainly redundant. Delete the wrapper, validate SSR returns real HTML on operator, then port to poly + resy + node-template."
outcome: "Operator (Phase 1) and then poly + resy + node-template (Phase 2) render real HTML on the server for non-API routes — `curl /dashboard` returns chrome + skeleton markup, not an empty shell. `providers-loader.client.tsx` deleted from each node. `layout.tsx` mounts `Providers` directly. Wallet flows still work. If deletion regresses (build, hydration, or runtime), the fallback design (provider split into RootProviders + WalletProvidersLazy) is documented below and switches the task to a slightly larger PR — but stays the same shape."
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
disabled. Root cause: `nodes/<node>/app/src/app/providers-loader.client.tsx`:

```ts
const DynamicProviders = dynamic(
  () => import("./providers.client").then((m) => m.Providers),
  { ssr: false }
);
```

…and that `Providers` wraps `{children}` in `layout.tsx`. So the entire
visible app — sidebar, topbar, and every page body — is gated behind
client JS. The user sees an empty HTML shell until JS hydrates. Likely
also the source of the noisy IndexedDB warnings at boot.

## Design

### Outcome

`curl /dashboard` (and every other route) returns real chrome + page
markup as SSR HTML. Time-to-first-paint stops being JS-bound. Wallet
flows still work.

### Approach

**Solution**: Delete the dynamic ssr:false wrapper. The wagmi config
already does what it needs to do for SSR.

`nodes/<node>/app/src/shared/web3/wagmi.config.ts` calls
`getDefaultConfig({ ssr: true, storage: createStorage({ storage: cookieStorage }) })`.
That is **the** RainbowKit/wagmi prescribed pattern for App Router SSR
(see [wagmi SSR guide](https://wagmi.sh/react/guides/ssr) and
[RainbowKit Next.js install](https://rainbowkit.com/docs/installation)).
With `ssr: true` and cookie-backed storage, `WagmiProvider` is safe to
render as a regular `"use client"` component during prerender — wagmi
defers indexedDB-touching code to the client mount.

Git history confirms the wrapper was added in the multi-node split commit
(`53d9e3301`), well after `ssr: true` was wired into the config
(`eaaaa7222`, treasury badge). It's redundant defensive code.

So Phase 1 is a one-line-per-node change: delete
`providers-loader.client.tsx` and import `Providers` directly in
`layout.tsx`. No new shared package, no new components, no new pattern.

**Reuses**:

- The existing `Providers` composition in `providers.client.tsx`
  (no change).
- The existing wagmi `ssr: true` config (no change).
- Existing `thread-stream-noop.ts` Turbopack alias (kept; it solves a
  separate build-time problem — bug.0157 — not the runtime SSR problem).

**Rejected** (unless Phase 1 fails):

- _Provider split into `RootProviders` (auth + query, SSR-safe) +
  `WalletProvidersLazy` (wagmi + rainbowkit, dynamic ssr:false sibling
  of children) in `packages/node-app/src/providers/`._ More complex,
  more code, splinters a one-line problem across a shared package and
  four call sites. Only worth doing if simply removing the wrapper
  regresses (build, hydration, or runtime). Kept as the documented
  fallback under "Fallback design" below.
- _Adding `<WalletGate>` to mount the wallet provider only on
  wallet-using surfaces._ Surface scan shows `UserAvatarMenu` (in every
  authenticated `(app)` route's chrome) calls `useDisconnect`, and
  `WalletConnectButton` is in the unauth chrome on `(public)` routes.
  Practically every visible route already needs wallet context. The
  potential bundle win from a per-surface gate is real but separate
  from the SSR win and belongs in a follow-up bundle-analyzer task.
- _Moving providers to `packages/node-app`._ Boundary check (Phase 3a):
  the providers don't share runtime, aren't pure domain, don't shield
  vendor SDK churn — they're per-node UI wiring. Stays in app code.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] SSR_RESTORED: After this PR, `curl <node-host>/dashboard` (and any
      `(app)` route) returns SSR HTML containing the sidebar/topbar
      chrome and the page heading. Empty `<body>` is a regression.
- [ ] WALLET_FLOW_INTACT: Connect Wallet on `/` and balance read on
      `/credits` continue to work, both first-load and post-navigation.
      No new hydration mismatch warnings in the browser console for
      authenticated users.
- [ ] NO_SHARED_PACKAGE_CHURN: No new files in `packages/node-app/`.
      The fix is per-node deletion only. (Triggers fallback design if
      violated.)
- [ ] BUG_0157_BUILD_GUARD: `pnpm check:full` (operator-build job)
      stays green. The `thread-stream` noop alias and
      `serverExternalPackages` list in `next.config.ts` are unchanged.
- [ ] SIMPLE_SOLUTION: Net diff per node is negative (delete a file,
      shrink another by one import line).
- [ ] ARCHITECTURE_ALIGNMENT: Follows the wagmi/RainbowKit App Router
      SSR pattern (spec: docs/spec/architecture.md §SSR-unsafe libraries —
      which currently references a stale path; update on the way through).

### Files

**Phase 1 (operator only):**

- Delete: `nodes/operator/app/src/app/providers-loader.client.tsx`
- Modify: `nodes/operator/app/src/app/layout.tsx` — change
  `import { Providers } from "./providers-loader.client";` to
  `import { Providers } from "./providers.client";`
- Modify: `docs/spec/architecture.md` §SSR-unsafe libraries — update
  the dead path reference (`src/app/providers/wallet.client.tsx`) to
  point at the current per-node `providers.client.tsx` and document
  the wagmi `ssr: true` + `cookieStorage` pattern as the canonical
  way to keep wallet code SSR-safe.

**Phase 2 (mechanical port to remaining nodes):**

- Delete: `nodes/{poly,resy,node-template}/app/src/app/providers-loader.client.tsx`
- Modify: `nodes/{poly,resy,node-template}/app/src/app/layout.tsx`
  — same one-line import swap.

**Tests:** no new tests. Validation is observational (curl + browser),
documented below. We have no Playwright suite for the chrome SSR path,
and adding one belongs in a separate test-coverage task.

### Phasing

**Phase 1 — operator POC + candidate-a validation.**

- Apply the operator-only change.
- Local: `pnpm --filter operator dev` → confirm
  `curl -s http://localhost:3000/ | grep -i "Cogni"` returns SSR HTML.
- Local: `pnpm --filter operator build && pnpm --filter operator start`
  → smoke test `/`, `/dashboard`, `/credits`, Connect Wallet flow.
- Open PR, flight to candidate-a, run validation block.

**Phase 2 — port poly + resy + node-template.** Three identical
one-line changes. Same validation, per node.

### Fallback design (if Phase 1 deletion regresses)

If removing `providers-loader.client.tsx` causes any of: a build error,
a runtime indexedDB ReferenceError on the server during prerender, or
a hydration mismatch — switch to the provider split:

- New file: `packages/node-app/src/providers/wallet-providers.client.tsx`
  — composes `WagmiProvider` + `RainbowKitSiweNextAuthProvider` +
  `RainbowKitProvider`. Takes `config: Config` as a prop.
- New file: `packages/node-app/src/providers/wallet-providers-lazy.client.tsx`
  — re-exports `WalletProviders` via `next/dynamic({ ssr: false })`.
- New file: `packages/node-app/src/providers/root-providers.tsx`
  — composes `AuthProvider` + `QueryProvider` only; renders
  `<WalletProvidersLazy config={...}>{children}</WalletProvidersLazy>`
  inside. Because `next/dynamic({ ssr: false })` renders nothing on the
  server, children are nested in a way that lets Next render them
  through the SSR-safe parents — verify this carefully against the
  Next.js dynamic-children semantics; if children pass through the
  dynamic boundary, instead render `<WalletProvidersLazy />` as a
  non-children sibling and use a React context to expose wallet hooks.
- Update each node's `providers.client.tsx` to a thin shim that imports
  `RootProviders` from `@cogni/node-app/providers` and passes its
  node-local `wagmiConfig`.

This is the design originally drafted in the prior commit. Saved here
because if we hit a real regression we want a known landing path, not
another design loop.

### Out of Scope

- `loading.tsx` / Suspense / server prefetch / PPR — spike.0401 Phase
  1 / 2b / 2c, separate tasks.
- Rewriting `(app)/layout.tsx` to a server component — independent win,
  separate task.
- `experimental.optimizePackageImports`, `@next/bundle-analyzer` —
  small separate PR(s) under spike.0401 Phase 1.
- Per-surface `<WalletGate>` to shrink the wallet bundle on routes that
  don't need it — separate bundle-perf task; depends on having
  bundle-analyzer in place first to measure the win.

## Validation

```
exercise:
  Phase 1 — on candidate-a operator:
    1. `curl -s https://<candidate-a-operator>/dashboard | head -c 4000`
       returns a non-empty HTML body containing sidebar/topbar chrome
       and the "Dashboard" heading (proves SSR restored).
    2. Same URL in a real browser with JS disabled — chrome renders;
       skeletons render where data would be.
    3. Re-enable JS — Connect Wallet on `/` opens RainbowKit modal,
       connect succeeds, `/credits` shows balance. No new hydration
       mismatch warnings in console.
    4. `pnpm --filter operator build` and `pnpm check:full` both stay
       green (bug.0157 build guard intact).
  Phase 2 — repeat #1 and #3 on candidate-a poly + resy + node-template.

observability:
  Loki at the deployed SHA, scoped to the agent's own session:
    {app="operator", env="candidate-a"} |= "GET /dashboard"
       | json | http_status_code = "200"
       | line_format "{{.method}} {{.path}} {{.duration_ms}} {{.bytes}}"
  Confirm a 200 with response bytes well above the JS-shell baseline
  (proxy currently returns ~3-4 kB shell; expect >20 kB after fix).
```

## Closes / Relates

- Closes bug.0157 — its stated outcome is "no thread-stream noop stub
  needed", but Phase 1 is more conservative: it drops the SSR wrapper
  and leaves the build-time alias alone. If Phase 1 succeeds and the
  alias also turns out to be removable, do it as a follow-up under
  bug.0157 directly.
- Implements spike.0401 Phase 2a (the SSR-restore step).
