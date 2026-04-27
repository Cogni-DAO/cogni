---
id: task.0402.handoff
type: handoff
work_item_id: task.0402
status: active
created: 2026-04-27
updated: 2026-04-27
branch: worktree-research-nextjs-perf
last_commit: 9a63e9fc5090d4c153dd61c1b84b0af0980aa286
---

# Handoff: task.0402 — restore SSR is currently broken on candidate-flight

## Context

- task.0402 set out to restore SSR by deleting the whole-app
  `next/dynamic({ ssr: false })` wrapper across all four nodes (operator,
  poly, resy, node-template) and adopting wagmi's documented
  `cookieToInitialState` pattern (server `layout.tsx` reads
  `headers().get("cookie")`, passes `initialState` into `<WagmiProvider>`).
- PR #1081 was opened, code-reviewed APPROVE, and dispatched to
  `Candidate Flight` workflow — which failed the `decide` stage because
  PR Build never produced images.
- PR Build itself fails for **all three** node images (operator, poly,
  resy) with `Failed to collect page data for /_not-found` and
  `Attempted to call getDefaultConfig() from the server but
getDefaultConfig is on the client`.
- Local `pnpm typecheck` passed; the failure only appears in the Docker
  `next build` page-data-collection pass for the framework-internal
  `/_not-found` route. Two iterations of patching (force-dynamic export,
  try/catch around `headers()`) did **not** fix it — the actual blocker
  is the import chain, not the runtime call.

## Current State

- Branch `worktree-research-nextjs-perf` is up to date with `origin`,
  HEAD `9a63e9fc5`. PR #1081 is OPEN, `mergeable: BEHIND/CONFLICTING`
  has been resolved via merge of `origin/main`.
- All four nodes' root `layout.tsx` import `wagmiConfig` directly. That
  import alone pulls RainbowKit's `getDefaultConfig` (a `"use client"`
  helper in current RainbowKit) into the server module graph, which
  Next 15 RSC rejects during `_not-found` data collection. Build is
  red on every PR commit since the wrapper was deleted.
- Local `pnpm check:fast` is reportedly passing (laptop is overloaded —
  the user asked to stop running it). Treat CI as the truth source.
- The work item lifecycle says `status: done` but **the deploy gate is
  not green** — no candidate-flight has succeeded.

## Decisions Made

- Original SSR-disable was added on 2026-04-03 in
  [`a898569b`](https://github.com/Cogni-DAO/node-template/commit/a898569b) —
  commit message explicitly: _"@walletconnect accesses indexedDB at
  module load time. When providers.client.tsx is statically imported in
  the server-component layout, Next.js evaluates the full import chain
  during static page generation — where indexedDB does not exist. Fix:
  add a providers-loader.client.tsx 'use client' shim in each node that
  uses next/dynamic with ssr:false to lazy-load providers.client.tsx.
  The layout imports the loader instead of the providers directly,
  breaking the SSR evaluation path."_
- Earlier sibling commit [`2ea421e0`](https://github.com/Cogni-DAO/node-template/commit/2ea421e0):
  _"keep WagmiProvider app-local — transpilePackages breaks wagmi SSR…
  wagmi internals access indexedDB during SSR static page generation.
  When WalletProvider is compiled via transpilePackages, the 'use client'
  boundary doesn't prevent server-side module initialization."_
- Together these establish the load-bearing reason the dynamic shim
  existed: **the `'use client'` directive does not prevent server-side
  module evaluation during Next's static-page-generation pass.** The
  shim was the only thing keeping `next build` green.
- Today's PR ([`eb4e3834`](https://github.com/Cogni-DAO/node-template/commit/eb4e3834))
  re-introduced the static import chain that `a898569b` was breaking.
  All four nodes now fail the same way `a898569b` originally fixed.
- Two later attempts to patch ([`6d4dce07`](https://github.com/Cogni-DAO/node-template/commit/6d4dce07)
  added `export const dynamic = "force-dynamic"`;
  [`9a63e9fc`](https://github.com/Cogni-DAO/node-template/commit/9a63e9fc) wrapped
  `headers()` in try/catch) did **not** fix it — they only address the
  runtime invocation, not the module-graph import.

## Next Actions

- [ ] Read this handoff, the two historical commits above, and the
      research doc at `docs/research/nextjs-frontend-perf.md`.
- [ ] Decide between two paths and write the decision into the work
      item before touching code:
  - **Path A — revert task.0402.** Restore `providers-loader.client.tsx`
    in all four nodes, restore the original `layout.tsx` (no
    `headers()`, no `cookieToInitialState`), keep this PR's research
    doc and spike.0401, close PR #1081 as `superseded`. Cheapest path
    back to green; loses the SSR-restoration goal.
  - **Path B — drop RainbowKit `getDefaultConfig`, use wagmi
    `createConfig` directly.** RainbowKit's `getDefaultConfig` is
    flagged `'use client'` and cannot be imported from the server
    layout. wagmi's `createConfig` (no RainbowKit wrapper) is
    server-importable. Pattern: build the config with explicit
    connectors (`injected`, optional `walletConnect`), keep
    `ssr: true` + `cookieStorage`, then `cookieToInitialState` works
    in the server layout. RainbowKit still consumes the config inside
    the client `Providers` boundary unchanged. This is what the
    canonical [`with-next-app` example](https://github.com/rainbow-me/rainbowkit/tree/main/examples/with-next-app)
    does. Higher effort (~1 day) but actually delivers the SSR goal.
- [ ] If Path A: revert the four `layout.tsx` files + four
      `providers.client.tsx` files + restore four
      `providers-loader.client.tsx` files to their state on `main`
      before this branch. Keep `docs/research/`, `spike.0401`, and the
      `architecture.md` §SSR-unsafe libraries doc rewrite (with a note
      that the cookieToInitialState pattern was attempted and fails on
      our setup — see this handoff). Push, watch CI go green, merge.
- [ ] If Path B: rewrite each node's `wagmi.config.ts` to use
      `createConfig` directly (no `getDefaultConfig`). Verify
      `pnpm --filter operator build` succeeds locally **inside Docker**
      (the bug only reproduces in the Docker build, not host
      typecheck). Then re-flight.
- [ ] Either way: PR #1081's title and body need updating so its TLDR
      matches what actually shipped. Don't merge with stale text.

## Risks / Gotchas

- **Local typecheck is a false negative.** `pnpm typecheck` passes for
  all four nodes; the failure is only in the static-generation pass of
  `next build`, which only runs in the Docker image build. Reproduce
  with `pnpm --filter operator build` locally before pushing.
- **`'use client'` is not a server-eval barrier.** Per
  [`2ea421e0`](https://github.com/Cogni-DAO/node-template/commit/2ea421e0),
  Next.js still evaluates the module body of `'use client'` files
  during static page collection. The only thing that breaks the eval
  chain is `next/dynamic({ ssr: false })`. Don't trust the directive
  alone.
- **`cookieToInitialState` doesn't fix the module-graph problem.** It
  fixes hydration mismatch _if_ you can already import the config
  server-side. With RainbowKit `getDefaultConfig`, you can't.
- **The PR diff is currently 19 files / +1042/-210**, mixing the
  research doc, spike, layout changes, provider changes, two failed
  CI fixes, and spec touches. If reverting, surgical revert of the
  four `layout.tsx` + `providers.client.tsx` + reinstating the
  loaders is enough — keep the docs.
- **Worktree is bootstrapped** (node_modules present, packages built
  earlier this session). Husky hooks active.

## Pointers

| File / Resource                                                                                              | Why it matters                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`a898569b` commit](https://github.com/Cogni-DAO/node-template/commit/a898569b)                              | The original `ssr:false` wrapper fix — explains why it exists                                                                   |
| [`2ea421e0` commit](https://github.com/Cogni-DAO/node-template/commit/2ea421e0)                              | Why WagmiProvider is app-local, not in `@cogni/node-app`                                                                        |
| [`eb4e3834` commit](https://github.com/Cogni-DAO/node-template/commit/eb4e3834)                              | The breaking change in this PR                                                                                                  |
| `nodes/operator/app/src/app/layout.tsx`                                                                      | Imports `wagmiConfig` from server context — the bug                                                                             |
| `nodes/operator/app/src/shared/web3/wagmi.config.ts`                                                         | Calls `getDefaultConfig()` — flagged `'use client'` in current RainbowKit                                                       |
| `nodes/operator/app/src/app/providers.client.tsx`                                                            | Composes WagmiProvider; reorder + `initialState` work was correct                                                               |
| `docs/research/nextjs-frontend-perf.md`                                                                      | The spike that motivated this work — keep                                                                                       |
| `work/items/task.0402.scope-wallet-provider-restore-ssr.md`                                                  | Design doc; "Fallback design" section already mentions `createConfig` w/ lazy WC connector — that **is** Path B in this handoff |
| `next.config.ts` (per node)                                                                                  | `transpilePackages: ["@cogni/node-app"]` — explains why providers stay per-node                                                 |
| [wagmi `with-next-app` example](https://github.com/rainbow-me/rainbowkit/tree/main/examples/with-next-app)   | Canonical RainbowKit + wagmi App Router example — uses `getDefaultConfig`, may show updated pattern                             |
| [PR #1081](https://github.com/Cogni-DAO/node-template/pull/1081)                                             | Currently red; needs decision before any retry                                                                                  |
| Last failed run: [PR Build 24983896419](https://github.com/Cogni-DAO/node-template/actions/runs/24983896419) | The exact `getDefaultConfig from the server` error                                                                              |
