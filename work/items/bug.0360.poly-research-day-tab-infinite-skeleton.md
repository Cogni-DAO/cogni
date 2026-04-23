---
id: bug.0360
type: bug
title: "Poly research Day tab hangs indefinitely — no timeout, no error state"
status: done
priority: 1
rank: 1
estimate: 1
outcome: "Day tab on /research resolves within 10s — shows data or an error message instead of hanging indefinitely."
created: 2026-04-23
updated: 2026-04-23
summary: "Selecting the Day tab on /research causes an infinite skeleton. Polymarket's DAY leaderboard endpoint is slow enough to exceed the backend 5s AbortController, but three missing guards mean the UI never recovers: no frontend AbortSignal on fetch(), no maxDuration on the Next.js route, and isError is never checked in view.tsx."
project: proj.poly-prediction-bot
assignees: [derekg1729]
deploy_verified: false
labels: [poly, research, ux, timeout, data-api]
---

# bug.0360 — Poly research Day tab hangs indefinitely

## Symptoms

- Selecting Day on `/research → Wallets` shows a skeleton that never resolves.
- After ~10 minutes the data may eventually appear (if Polymarket's DAY endpoint finally responds) or the tab remains blank forever.
- Week/Month/All tabs work (slower than ideal, but resolve).
- No error message is ever shown to the user.

## Root Cause

Three missing guards form the chain:

1. **No `AbortSignal` on the frontend `fetch()`** — `fetchTopWallets.ts` calls `fetch('/api/v1/poly/top-wallets?...')` with no signal. If the Next.js route handler hangs, the browser waits indefinitely (no browser-level timeout for same-origin fetch).

2. **No `maxDuration` on the route** — `nodes/poly/app/src/app/api/v1/poly/top-wallets/route.ts` has no `export const maxDuration`. Next.js App Router will wait indefinitely for the route handler to return.

3. **`isError` never checked in `view.tsx`** — `ResearchView` destructures only `{ data, isLoading }` from `useQuery`. When the query fails (after React Query's `retry: 1`), `isLoading` becomes `false` and `data` is `undefined`. The table renders with zero rows and no error message — looks like an empty result, not a failure.

The backend 5s `AbortController` in `PolymarketDataApiClient` _does_ fire — but because the route has no try/catch and `wrapRouteHandlerWithLogging` re-throws, the Next.js route never returns a clean 500 within a bounded time, leaving the connection open.

## Evidence

Loki (`env=candidate-a`, today): zero `poly.top-wallets` completions with any DAY period, multiple WEEK completions at 4–5s (borderline on the 5s timeout). The DAY endpoint simply never appears in "request complete" logs.

## Fix

Three surgical changes, no architecture changes:

### 1. `fetchTopWallets.ts` — add frontend AbortSignal (10s)

```ts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10_000);
try {
  const res = await fetch(`/api/v1/poly/top-wallets?${qs}`, { signal: controller.signal });
  ...
} finally {
  clearTimeout(timeoutId);
}
```

### 2. `top-wallets/route.ts` — add `maxDuration`

```ts
export const maxDuration = 10; // seconds
```

### 3. `research/view.tsx` — handle `isError`

```ts
const { data, isLoading, isError } = useQuery({ ... });
// render an error banner when isError; show emptyMessage="No data — try refreshing."
```

## Validation

### exercise

Navigate to `/research` on candidate-a → click Day tab → within 12s should see either data or an error message ("Failed to load — try again"), not an indefinite skeleton.

### observability

`{service="app", env="candidate-a", pod=~"poly-node-app-.*"} | json | route="poly.top-wallets"` — confirm "request complete" (or error) appears within 10s of the tab click. No hung in-flight requests.
