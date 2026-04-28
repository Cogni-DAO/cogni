---
id: task.0403
type: task
title: "Operator — add `loading.tsx` + `error.tsx` route-group boundaries"
status: needs_merge
priority: 0
rank: 1
estimate: 2
branch: feat/task-0403-operator-loading-boundaries
summary: "Add the missing Next 15 App Router instant-feedback contract to operator: a `loading.tsx` and `error.tsx` per route group ((app), (public)) so client-side navigation shows a skeleton immediately instead of blocking on the full RSC payload. With `force-dynamic` on the root layout (required for `cookieToInitialState`), every nav is a server round-trip; without `loading.tsx` the user sees a frozen UI for the entire round-trip."
outcome: 'Clicking between sidebar nav items in operator paints a skeleton in <100 ms while the RSC payload streams in behind it. Sidebar + top bar remain visible across nav (the route-group layout is preserved). Build stays green; bundle size unchanged. After this PR, perceived nav latency drops from "stop-the-world" to "instant skeleton". Pattern is then mechanical to port to poly + resy + node-template in a follow-up.'
spec_refs:
assignees: derekg1729
credit:
project:
pr: https://github.com/Cogni-DAO/node-template/pull/1087
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, nextjs, ssr, app-router]
external_refs:
  - docs/research/nextjs-frontend-perf.md
  - work/items/spike.0401.nextjs-frontend-perf.md
  - work/items/task.0402.scope-wallet-provider-restore-ssr.md
---

## Problem

After task.0402 restored SSR, **subsequent client-side navigation still
feels laggy**. Clicking sidebar links between `/dashboard`, `/chat`,
`/work`, `/credits` produces a frozen UI for the entire server
round-trip, then a sudden full paint. No intermediate feedback. On a
signed-in app, this is the dominant felt-perf problem.

Root cause: `nodes/operator/app/src/app/layout.tsx` declares
`export const dynamic = "force-dynamic"` (mandatory because we read
`headers()` for `cookieToInitialState`). Every page is therefore
dynamic. Next 15's contract for dynamic routes is: **the user sees the
nearest `loading.tsx` Suspense fallback while the RSC payload streams
in.** We have **zero** `loading.tsx` files in the entire operator app:

```bash
$ find nodes/operator/app/src/app -name "loading.tsx"
# (empty)
$ find nodes/operator/app/src/app -name "error.tsx"
# (empty)
```

So Next has no fallback to render and the App Router blocks the whole
nav until the RSC tree is ready.

Reference: [Next 15 — Loading UI and Streaming](https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming).

## Design

### Outcome

Nav between any two routes inside operator paints a skeleton inside
`<SidebarInset>` within ~50 ms of the click. The sidebar + top bar
never re-render (route-group layout is preserved). The actual page
content streams in behind the skeleton. Public-page nav (`/`,
`/propose/merge`) shows a centered skeleton instead of a blank screen.

### Approach

Operator's app routes are partitioned into two route groups by existing
layout files:

```
src/app/
├─ layout.tsx                    (root, force-dynamic)
├─ (app)/layout.tsx              ← Sidebar + TopBar shell, "use client"
│   ├─ activity, credits, dashboard, profile, schedules, work
│   ├─ chat/  (own layout.tsx)
│   ├─ gov/   (own layout.tsx)
│   └─ setup/dao/  (own layout.tsx)
└─ (public)/layout.tsx
    ├─ page.tsx (landing)
    ├─ dummy
    └─ propose/merge
```

A single `loading.tsx` per route group is sufficient — Next 15 walks
up the tree to find the nearest one, and the route-group layout
remains rendered around it. We can refine sub-section skeletons (chat,
gov, setup wizard) in a follow-up if any feel too generic.

The repo already has the right primitive: `@/components/kit/layout/PageSkeleton`
composes `<PageContainer>` + `<Skeleton>` shadcn rows and is
layout-preserving by design.

### Files to add

1. `src/app/(app)/loading.tsx` — server component, exports default
   that renders `<PageSkeleton maxWidth="2xl" />`. Catches every
   route under `(app)` that doesn't have its own `loading.tsx`.
2. `src/app/(public)/loading.tsx` — server component with a minimal
   centered skeleton (no sidebar shell to fill).
3. `src/app/(app)/error.tsx` — `'use client'` (Next requires it for
   error boundaries), renders message + `reset()` button. Catches
   any RSC error inside `(app)` so the sidebar shell stays alive.
4. `src/app/(public)/error.tsx` — same shape, public styling.

### Why not a single global `loading.tsx`

A `loading.tsx` co-located with the root `layout.tsx` would render
**outside** the `(app)` route-group layout — i.e. without the sidebar.
Click `/dashboard → /chat` would flash the sidebar away and back. By
placing one `loading.tsx` inside each route group, the route-group
layout (sidebar shell or public chrome) is preserved and only the
inner content swaps to the skeleton.

### Out of scope (follow-ups)

- Poly / resy / node-template: same pattern, mechanical port. File as
  task.0404 once operator validates.
- Sub-section skeletons (chat composer, gov tables, setup wizard):
  defer until generic skeleton is observed in flight and judged
  insufficient.
- Per-page `Suspense` boundaries inside server components for
  individual data fetches (the next-tier streaming pattern). Bigger
  task; do after this lands.
- Drop redundant page-level `force-dynamic` exports on pages already
  forced dynamic by the root layout — drive-by, can include in this
  PR if trivial.

## Todos

- [ ] **Add `(app)/loading.tsx`** rendering `<PageSkeleton maxWidth="2xl" />`.
- [ ] **Add `(public)/loading.tsx`** with a centered, marketing-page-friendly skeleton.
- [ ] **Add `(app)/error.tsx`** as a `'use client'` component with `reset` button + structured Pino-friendly console.error of the digest.
- [ ] **Add `(public)/error.tsx`** mirroring (app) shape.
- [ ] **Drive-by**: drop redundant page-level `export const dynamic = "force-dynamic"` on pages whose root layout already forces dynamic (only the page-level ones that are not API routes — keep API ones).
- [ ] **Local build green**: `pnpm --filter operator build`.
- [ ] **`pnpm check:fast`** clean.
- [ ] Closeout PR + flight to candidate-a.

## Validation

```
exercise:
  Phase 1 — local dev (single-machine, before flight):

    BUILD GUARD:
      1a. `rm -rf nodes/operator/app/.next && pnpm --filter operator build`
          succeeds. The new loading + error files appear in the route
          tree as `loading` / `error` segments (Next prints them).

    NAV-FEEDBACK:
      1b. `pnpm dev:stack` → open http://localhost:3000, sign in.
          Open DevTools Network panel, throttle to "Slow 4G".
      1c. Click sidebar links in this order:
          /dashboard → /chat → /work → /credits → /schedules → /dashboard.
          Each click MUST paint a skeleton inside the main column within
          ~50–100 ms. Sidebar + top bar MUST NOT flash / re-render.
      1d. Repeat without throttling on a fast network — skeleton should
          flash but be visible (not a layout jump from blank to content).

    ERROR BOUNDARY:
      1e. Temporarily throw inside any (app) page server component
          (`throw new Error("test boundary")` in dashboard/page.tsx).
          Reload — error.tsx renders inside the sidebar shell with a
          working "Try again" button. Revert the throw.

    NO REGRESSION:
      1f. `curl -s http://localhost:3000/dashboard | wc -c` — same
          byte count as before this PR (loading.tsx does not affect
          first-paint SSR; only client-nav feedback). Confirm in PR.

  Phase 2 — candidate-a flight (post-merge, real signal):

    1g. After flight, repeat 1c on https://candidate-a-operator.cogni-dao.net
        with a real browser. Capture a Performance trace before + after
        for one nav (/dashboard → /chat). Expected: a "first contentful
        paint" event ≤100 ms after click on the post-PR trace; pre-PR
        trace had no FCP between click and full RSC arrival.

observability:
  Loki at the deployed SHA, scoped to the agent's own session:
    {env="candidate-a", service="app", pod=~"operator-.*"}
       | json
       | path =~ "/(dashboard|chat|work|credits|schedules)"
       | http_status = 200
  Confirm 200s for the agent's own RSC fetches at the deployed SHA.
  loading.tsx is a client-perceptible change; the server-side log
  pattern is unchanged from pre-PR. The real signal is the human
  Performance trace in 1g.
```

## Closes / Relates

- Implements spike.0401 Phase 2b (nav-perf step).
- Follow-up to task.0402 — restored SSR gave us correct first paint;
  this gives us instant nav feedback.

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/1087
