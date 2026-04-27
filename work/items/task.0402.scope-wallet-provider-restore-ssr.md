---
id: task.0402
type: task
title: "Restore SSR — adopt wagmi's canonical Next.js App Router SSR pattern"
status: needs_implement
priority: 0
rank: 1
estimate: 2
branch: worktree-research-nextjs-perf
summary: "Replace each node's whole-app `next/dynamic({ ssr: false })` wrapper with the wagmi-prescribed App Router SSR pattern: read `headers().get('cookie')` in the root layout (server component), call `cookieToInitialState(wagmiConfig, cookie)`, and pass the result as `initialState` into `<WagmiProvider>`. Delete `providers-loader.client.tsx`. Phase 1 = operator + flight; Phase 2 = mechanical port to poly + resy + node-template."
outcome: "Every route returns SSR HTML containing chrome and page markup (curl returns >>shell-size bytes). No hydration-mismatch warnings in the browser console for either authed-with-wallet or anonymous users. Wallet connect / disconnect / signing flows continue to work. `providers-loader.client.tsx` deleted in all four nodes; root `layout.tsx` is `async`, reads cookies once, and passes `initialState` into `<Providers>`. `pnpm check:full` stays green from a clean `.next/` rebuild."
spec_refs:
assignees: derekg1729
credit:
project:
pr: https://github.com/Cogni-DAO/node-template/pull/1081
reviewer:
revision: 1
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

**Solution**: adopt the wagmi-prescribed Next.js App Router SSR pattern
verbatim. Three coordinated changes per node, no new shared package, no
provider split.

#### Why this is the right pattern (citations)

The combination of changes below is the canonical wagmi + RainbowKit + SIWE
App Router pattern. The relevant docs:

- [wagmi SSR guide](https://wagmi.sh/react/guides/ssr) — prescribes
  `createConfig({ ssr: true, storage: createStorage({ storage: cookieStorage }) })`
  in a config module, then in the App Router root layout:
  `cookieToInitialState(config, (await headers()).get("cookie"))`,
  passed as the `initialState` prop to `<WagmiProvider>` inside a
  `"use client"` providers component.
- [RainbowKit installation](https://rainbowkit.com/docs/installation) —
  uses `getDefaultConfig({ ..., ssr: true })` (which internally calls
  `createConfig` with the same shape) and the same provider tree.
- [RainbowKit authentication](https://rainbowkit.com/docs/authentication) —
  for SIWE + NextAuth, the documented composition order is:

  ```
  <WagmiProvider config={config} initialState={initialState}>
    <SessionProvider refetchInterval={0}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitSiweNextAuthProvider getSiweMessageOptions={...}>
          <RainbowKitProvider>{children}</RainbowKitProvider>
        </RainbowKitSiweNextAuthProvider>
      </QueryClientProvider>
    </SessionProvider>
  </WagmiProvider>
  ```

  Note `WagmiProvider` is the **outermost** provider — required so
  `cookieToInitialState` can hydrate it.
  `RainbowKitSiweNextAuthProvider` must be a descendant of
  `SessionProvider` to read the session.

#### What the fix does

Per node (`nodes/<node>/app/src/app/`), three coordinated changes:

**(a) `layout.tsx`** — make it `async`, read cookies, compute
`initialState`, pass it through:

```tsx
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";

import { wagmiConfig } from "@/shared/web3/wagmi.config";
import { Providers } from "./providers.client";

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const initialState = cookieToInitialState(
    wagmiConfig,
    (await headers()).get("cookie")
  );
  return (
    <html lang="en" className={manrope.className} suppressHydrationWarning>
      {/* …<head> + <body> unchanged… */}
      <ThemeProvider …>
        <Providers initialState={initialState}>
          <div id="main">{children}</div>
        </Providers>
      </ThemeProvider>
    </html>
  );
}
```

This is the wagmi-canonical shape. `headers()` is async in Next 15 (per
the [App Router migration to async dynamic APIs](https://nextjs.org/docs/messages/sync-dynamic-apis)),
hence the `async` layout.

**(b) `providers.client.tsx`** — accept `initialState`, reorder to the
RainbowKit-prescribed composition (Wagmi outermost), pass `initialState`:

```tsx
"use client";

import type { State } from "wagmi";

export function Providers({
  children,
  initialState,
}: {
  readonly children: ReactNode;
  readonly initialState?: State;
}): ReactNode {
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <AuthProvider>
        <QueryProvider>
          <RainbowKitSiweNextAuthProvider getSiweMessageOptions={…}>
            <RainbowKitThemeProvider>{children}</RainbowKitThemeProvider>
          </RainbowKitSiweNextAuthProvider>
        </QueryProvider>
      </AuthProvider>
    </WagmiProvider>
  );
}
```

Two changes from current:

1. `WagmiProvider` moves from the middle of the tree to outermost.
   This is the documented order; `cookieToInitialState` requires
   `WagmiProvider` to be the consumer of the hydrated state, and
   placing it outermost matches both wagmi and RainbowKit examples.
   `RainbowKitSiweNextAuthProvider` still has `SessionProvider` as an
   ancestor, satisfying its requirement.
2. `initialState` prop is forwarded into `WagmiProvider`. Without this,
   the server renders with no wallet state and the client hydrates
   with cookie-derived state → React-18 hydration-mismatch warning on
   every authed load.

**(c) `providers-loader.client.tsx`** — deleted. Its only purpose was
the `next/dynamic({ ssr: false })` wrap; with `initialState` plumbing
in place, `<Providers>` SSRs cleanly.

The wagmi config (`shared/web3/wagmi.config.ts`) is unchanged — it
already calls `getDefaultConfig({ ssr: true, storage: cookieStorage })`
which is the matching counterpart to this layout pattern.

#### Why not "just delete the wrapper"

The previous draft proposed deleting the wrapper alone. The
`/review-design` correctly flagged that this is necessary but not
sufficient: with `ssr: true` set, wagmi's serializer writes a state
cookie when a wallet connects, and on next SSR the server must read
that cookie via `cookieToInitialState` and seed `<WagmiProvider>` —
otherwise the server renders "no account" and the client hydrates
"connected", triggering hydration mismatch on every load with a wallet
cookie. The fix above is the wagmi-documented complete pattern.

**Reuses**:

- `getDefaultConfig({ ssr: true, storage: cookieStorage })` in
  `wagmi.config.ts` (no change).
- Existing `AuthProvider`, `QueryProvider`, `RainbowKitThemeProvider`
  composition (only the order changes).
- Existing `thread-stream-noop.ts` Turbopack alias (kept; it solves a
  separate build-time problem — bug.0157 — not the runtime SSR problem).

**Rejected**:

- _Provider split into `RootProviders` + `WalletProvidersLazy` in
  `packages/node-app/src/providers/`._ More complex, more code,
  splinters a per-node-UI-wiring concern into a shared package. Only
  worth doing if the canonical pattern above fails for an unforeseen
  reason. See "Fallback" below.
- _Adding `<WalletGate>` to mount the wallet provider only on
  wallet-using surfaces._ `UserAvatarMenu` (in every authenticated
  route's chrome) calls `useDisconnect`, and `WalletConnectButton` is
  in the unauth chrome. Every visible route already needs wallet
  context. Bundle-shrinking via per-surface gating is a separate task,
  blocked on first having bundle-analyzer wired up.
- _Moving providers to `packages/node-app`._ Boundary check
  (Phase 3a): per-node UI wiring, not a shared port or domain. Stays
  in app code.
- _"Just delete the wrapper" without `initialState` plumbing._ Ships a
  hydration-mismatch warning on every authed load. Rejected by
  `/review-design`.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] SSR_RESTORED: A route that does not server-redirect (the public
      landing `/` for unauthenticated requests) returns >= 20 kB of
      HTML containing visible page copy when curled with no cookies.
      Compare to the pre-fix shell baseline captured in the PR body.
- [ ] CHROME_IN_SSR_HTML: For an authenticated `(app)` route, `curl`
      with a valid `next-auth.session-token` cookie returns SSR HTML
      whose `<body>` contains the topbar markup (`SidebarTrigger`,
      `TreasuryBadge`) and the page heading. Empty `<body>` is a
      regression.
- [ ] NO_HYDRATION_WARNINGS: Browser console shows zero React
      hydration-mismatch warnings for both (a) anonymous load of `/`
      and (b) authed load of `/dashboard` with a wallet cookie set.
      Captured as a screenshot in the validation comment.
- [ ] WALLET_FLOW_INTACT: ConnectButton on `/` opens the RainbowKit
      modal, signs SIWE, redirects to `/chat`. Disconnect from
      `UserAvatarMenu` clears the session and returns to landing.
      `/credits` reads balance.
- [ ] WAGMI_INITIAL_STATE_PRESENT: `<WagmiProvider>` receives a
      non-undefined `initialState` prop sourced from
      `cookieToInitialState(wagmiConfig, headers().get("cookie"))` in
      the root server layout. (This is what makes
      `NO_HYDRATION_WARNINGS` achievable.)
- [ ] PROVIDER_ORDER_CANONICAL: `<WagmiProvider>` is the outermost
      provider; `RainbowKitSiweNextAuthProvider` is a descendant of
      `SessionProvider`. Matches the RainbowKit + SIWE App Router
      reference composition.
- [ ] NO_SHARED_PACKAGE_CHURN: No new files in `packages/node-app/`.
      The fix is per-node only. (Triggers fallback design if violated.)
- [ ] CLEAN_REBUILD_GREEN: `rm -rf nodes/operator/app/.next &&
pnpm --filter operator build` produces zero `Module not found`
      warnings and succeeds. The `thread-stream` noop alias and
      `serverExternalPackages` list in `next.config.ts` are unchanged
      (bug.0157 build guard).
- [ ] ARCHITECTURE_ALIGNMENT: Implements the documented patterns —
      [wagmi SSR guide](https://wagmi.sh/react/guides/ssr) +
      [RainbowKit installation](https://rainbowkit.com/docs/installation) +
      [RainbowKit authentication](https://rainbowkit.com/docs/authentication).
      Spec touch: `docs/spec/architecture.md` §SSR-unsafe libraries
      currently references a stale path (`src/app/providers/wallet.client.tsx`);
      update to point at the per-node `providers.client.tsx` + this
      pattern.
- [ ] LAYOUT_REMAINS_SERVER: Root `layout.tsx` stays a server
      component (no `"use client"` added to it). It just becomes
      `async` because `headers()` is async in Next 15.

### Files

**Phase 1 (operator only):**

- Modify: `nodes/operator/app/src/app/layout.tsx` — make `async`, read
  `(await headers()).get("cookie")`, compute `cookieToInitialState`,
  pass `initialState` prop into `<Providers>`. Swap import from
  `./providers-loader.client` to `./providers.client`.
- Modify: `nodes/operator/app/src/app/providers.client.tsx` — accept
  `initialState?: State` prop, reorder providers (Wagmi outermost),
  forward `initialState` into `<WagmiProvider>`.
- Delete: `nodes/operator/app/src/app/providers-loader.client.tsx`.
- Modify: `docs/spec/architecture.md` §SSR-unsafe libraries — replace
  the dead `src/app/providers/wallet.client.tsx` reference with the
  current per-node `providers.client.tsx` + `layout.tsx` cookie-reading
  pattern. Cite the wagmi/RainbowKit docs.

**Phase 2 (mechanical port to remaining nodes):**

- Modify: `nodes/{poly,resy,node-template}/app/src/app/layout.tsx` —
  same shape as operator.
- Modify: `nodes/{poly,resy,node-template}/app/src/app/providers.client.tsx`
  — same shape.
- Delete: `nodes/{poly,resy,node-template}/app/src/app/providers-loader.client.tsx`.

**Tests:** no new automated tests. Validation is observational
(curl + browser console + Loki) and codified in the validation block.
A future task can add a Playwright test that asserts
`page.content().includes("…SidebarTrigger…")` on a known authed route,
but that's a separate test-coverage task and not blocking.

### Phasing

**Phase 1 — operator POC + candidate-a validation.**

1. Apply the three operator-side changes + spec touch.
2. Local: `pnpm --filter operator dev` → confirm
   `curl -s http://localhost:3000/ | wc -c` is >> the previous shell
   baseline (capture both numbers in the PR body).
3. Local: `rm -rf nodes/operator/app/.next && pnpm --filter operator build &&
pnpm --filter operator start` → smoke test `/`, sign in, `/dashboard`,
   `/credits`, disconnect. Open DevTools console; require zero
   hydration warnings.
4. Open PR, flight to candidate-a, run the validation block below.

**Phase 2 — port poly + resy + node-template.** Three identical PRs
(or one bundled PR if Phase 1 lands cleanly and reviewers prefer one).
Same validation, per node.

### Fallback design (if Phase 1 regresses)

If `pnpm build` fails with a runtime / SSR error, or if the
`NO_HYDRATION_WARNINGS` invariant cannot be satisfied even after the
`initialState` plumbing is in place, the right fallback per
[wagmi's WalletConnect SSR notes](https://wagmi.sh/react/guides/ssr) is
**lazy-init the WalletConnect connector**, not split the providers.

Concretely, in `wagmi.config.ts`, replace `getDefaultConfig` with the
explicit `createConfig` form and gate the WalletConnect connector
behind `typeof window !== "undefined"`:

```ts
import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected } from "wagmi/connectors";

const connectors =
  typeof window !== "undefined"
    ? [
        injected(),
        // walletConnect({ projectId, … }) — added client-side only
      ]
    : [injected()];

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: { [CHAIN.id]: http() },
});
```

This keeps `WagmiProvider` as a normal client component with full SSR
support and never imports `@walletconnect/*` on the server. RainbowKit's
`getDefaultConfig` does this internally already when `ssr: true` is
set, so this fallback is only relevant if we discover the internal
guard isn't sufficient on our specific Next 15 / Turbopack setup.

**Explicitly rejected (was in the prior draft):** mounting
`<WalletProvidersLazy />` as a non-children sibling with React context.
Sibling components can't provide context to a tree they don't contain.
That paragraph was wrong; this fallback replaces it.

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

    UNAUTH SSR (no redirect):
      1a. `curl -sI https://<candidate-a-operator>/` returns 200 (the
          public landing route does not redirect anonymous requests).
      1b. `curl -s https://<candidate-a-operator>/ | wc -c` returns a
          byte count significantly higher than the pre-fix shell
          baseline. Capture both numbers in the PR comment.
      1c. `curl -s https://<candidate-a-operator>/` includes visible
          landing copy in the HTML body (e.g. the hero heading) AND
          the `WalletConnectButton` markup (`data-wallet-slot=desktop`
          or its compact variant).

    AUTHED SSR (chrome must render server-side):
      2a. Acquire a session via the agent-api-validation flow
          (discover → register → auth) so we have a
          `next-auth.session-token` cookie.
      2b. `curl -s -H "Cookie: next-auth.session-token=…" \
          https://<candidate-a-operator>/dashboard` returns 200 with a
          body containing topbar markup (e.g. `SidebarTrigger`,
          `TreasuryBadge`) and the "Dashboard" heading. Empty `<body>`
          is a regression.

    HYDRATION (no mismatches):
      3a. Open the same URLs in a real browser with DevTools console
          open. Connect a wallet, refresh `/dashboard`. Console must
          show zero hydration-mismatch warnings. Screenshot the
          console; attach to PR comment.

    WALLET FLOW:
      4a. Sign-in on `/` via SIWE → redirects to `/chat`.
      4b. `/credits` shows balance.
      4c. Disconnect from `UserAvatarMenu` returns to landing.

    BUILD GUARD:
      5a. `rm -rf nodes/operator/app/.next && pnpm --filter operator build`
          succeeds with zero `Module not found` warnings.
      5b. `pnpm check:full` stays green.

  Phase 2 — repeat 1c, 2b, 3a, 4a, 5a on candidate-a poly, resy,
  node-template (one node at a time).

observability:
  Loki at the deployed SHA, scoped to the agent's own session
  (label set per docs/guides/agent-api-validation.md):
    {service_name="operator", environment="candidate-a"}
       | json
       | path = "/dashboard"
       | http_status = 200
  Confirm a 200 response for the agent's own GET /dashboard request
  with response bytes well above the pre-fix shell baseline (capture
  both in the PR comment).

  If our log schema doesn't expose response bytes, a non-redirect 200
  on the SSR path is sufficient — the wc -c capture in step 1b/2b is
  the primary size check.
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

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/1081 (red,
  candidate-flight blocked on PR Build failure — see handoff)
- Handoff: [handoff](../handoffs/task.0402.handoff.md)
