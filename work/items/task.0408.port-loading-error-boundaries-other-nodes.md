---
id: task.0408
type: task
title: "Port `loading.tsx` + `error.tsx` boundaries to poly + resy + node-template"
status: needs_merge
priority: 0
rank: 1
estimate: 1
branch:
summary: "Mechanical port of task.0403's pattern from operator to the three remaining nodes. Adds `(app)/loading.tsx`, `(app)/error.tsx`, `(public)/loading.tsx`, `(public)/error.tsx` per node so client-side nav inside each node paints a skeleton in <100 ms instead of freezing on the full RSC round-trip. Uses the existing `PageSkeleton` primitive (or each node's equivalent) — no new components. Drops any redundant page-level `force-dynamic` exports as a drive-by."
outcome: "Three single-node PRs (one per node), each adding 4 boundary files + AGENTS.md update. Each merges + flights independently to keep the `single-node-scope` gate green. After all three land, every Cogni node delivers Next 15's instant-feedback contract on nav. Per-node validation: click between sidebar nav items on candidate-a-<node> and confirm a skeleton paints inside the route-group shell within ~50–100 ms; capture before/after Performance traces."
spec_refs:
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, nextjs, ssr, app-router]
external_refs:
  - work/items/task.0403.operator-loading-error-boundaries.md
  - work/items/spike.0401.nextjs-frontend-perf.md
---

## Problem

Operator now has `loading.tsx` + `error.tsx` per route group (task.0403,
PR #1087). Poly, resy, and node-template still don't. The same
"frozen click → eventually paint" UX bites every signed-in user on
those nodes too. **Top priority** — perceived nav latency is the
biggest UI regression the user feels.

```bash
$ find nodes/{poly,resy,node-template}/app/src/app -name "loading.tsx"
# (empty)
$ find nodes/{poly,resy,node-template}/app/src/app -name "error.tsx"
# (empty)
```

## Design

### Outcome

Per node, after this work:

- `src/app/(app)/loading.tsx` renders inside the sidebar shell —
  sidebar + top bar stay mounted across nav.
- `src/app/(public)/loading.tsx` renders a centered skeleton.
- `src/app/(app)/error.tsx` and `(public)/error.tsx` are `'use client'`
  boundaries with `reset` + Pino-cross-referenceable `console.error` of
  the digest.
- `src/app/AGENTS.md` declares `loading.tsx` + `error.tsx` as part of
  the public route surface.

### Approach

Lift the four files verbatim from operator (PR #1087, commit
`423b63c50` post-squash) to each node. Adjust imports if `PageSkeleton`
lives at a different path per node (each node has its own
`@/components/kit/layout/PageSkeleton.tsx` — verify first).

### One PR per node — the `single-node-scope` gate

The repo enforces "one PR per node domain" via the `single-node-scope`
CI check. This work fans out to **three independent PRs**:

1. `feat/task-0404-poly-loading-boundaries` — touches only `nodes/poly/`
2. `feat/task-0404-resy-loading-boundaries` — touches only `nodes/resy/`
3. `feat/task-0404-node-template-loading-boundaries` — touches only
   `nodes/node-template/`

Land them serially (each through flight + validate-candidate) or in
parallel (each on its own candidate-a slot if the schedule allows).

### Reuse from task.0403

Pre-built primitives — no new code:

- `nodes/<node>/app/src/components/kit/layout/PageSkeleton.tsx` —
  layout-preserving skeleton (already exists per node).
- `nodes/<node>/app/src/components/kit/layout/PageContainer.tsx` —
  used internally by PageSkeleton.
- `nodes/<node>/app/src/components/vendor/shadcn/skeleton.tsx` —
  vendored shadcn primitive (do **not** import directly from app
  layer; UI governance forbids vendor imports outside `kit/`).

### UI governance gotcha (learned in task.0403)

The first attempt at `(public)/loading.tsx` imported `Skeleton` from
`@/components/vendor/shadcn/skeleton` to compose a marketing-flavored
skeleton. ESLint `no-restricted-imports` blocks this — vendor imports
are forbidden in the app layer. Use `PageSkeleton` from `kit/layout/`
instead. Lift the same shape that operator uses.

### biome `noConsole` gotcha

`error.tsx` calls `console.error(...)` to forward the digest for
cross-referencing with server logs. Biome's `lint/suspicious/noConsole`
rule flags this — add a `// biome-ignore lint/suspicious/noConsole: ...`
comment exactly as operator does. Don't strip the console.error;
removing the digest log is what biome's `--unsafe` autofix does and it
breaks the documented Next.js error-boundary pattern.

## Todos (per node — repeat ×3)

- [ ] Create branch `feat/task-0404-<node>-loading-boundaries` from main.
- [ ] Add `nodes/<node>/app/src/app/(app)/loading.tsx`.
- [ ] Add `nodes/<node>/app/src/app/(public)/loading.tsx`.
- [ ] Add `nodes/<node>/app/src/app/(app)/error.tsx`.
- [ ] Add `nodes/<node>/app/src/app/(public)/error.tsx`.
- [ ] Drop any redundant page-level `force-dynamic` exports under
      `(app)/**` whose root layout already forces dynamic. Keep API
      route ones.
- [ ] Update `nodes/<node>/app/src/app/AGENTS.md` to declare the new
      `loading.tsx` + `error.tsx` files as part of the public route
      surface.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format` clean.
- [ ] Open PR. Wait for `build (<node>)` green. Dispatch
      `Candidate Flight` workflow with `pr_number=<N>`. Await flight
      success.
- [ ] Hand-validate: open `https://candidate-a-<node>.cogni-dao.net`,
      sign in (if applicable), click between nav items, confirm
      skeleton paints in <100 ms while sidebar shell stays mounted.

## Validation

```
exercise:
  Per node, on candidate-a-<node>:

    NAV-FEEDBACK:
      Click between sidebar nav items.
      MUST: skeleton paints inside the route-group shell within
            ~50–100 ms each click on Slow 4G throttle.
      MUST: route-group layout (sidebar / chrome) does NOT flash
            or re-render across nav.

    ERROR BOUNDARY:
      Throw inside any (app) page server component on a feature
      branch — error.tsx renders inside the sidebar shell with a
      working "Try again" button. Revert the throw before merge.

    NO REGRESSION:
      curl https://candidate-a-<node>.cogni-dao.net/ | wc -c
      Same byte count as before this PR (loading.tsx is client-only
      Suspense fallback; first-paint SSR unchanged).

observability:
  Like task.0403: loading.tsx is client-perceptible only and our
  Pino server-side logger does NOT emit on Next.js page renders.
  Real signal is the human DevTools Performance trace + felt
  latency. Observability gap is a known limitation — see task.0406
  for the agent-side fix (PostHog access for data agents).
```

## Closes / Relates

- Implements spike.0401 Phase 2b for the remaining 3 nodes.
- Follow-up to task.0403 (operator) — mechanical port to the rest.
- Related: task.0405 (per-node skeleton-accuracy matrix — each
  generic skeleton may not match its actual page; that work covers
  the "is this skeleton lying" axis after the boundaries are in
  place).
- Related: task.0406 (PostHog data-agent access — real felt-perf
  observability).

## PR / Links

- PR(s):
  - poly: https://github.com/Cogni-DAO/node-template/pull/1089
  - resy: https://github.com/Cogni-DAO/node-template/pull/1090
  - node-template: https://github.com/Cogni-DAO/node-template/pull/1091
