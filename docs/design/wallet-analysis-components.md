---
id: wallet-analysis-components
type: design
title: "Wallet Analysis — Reusable Components + Live Data Plane"
status: draft
spec_refs:
created: 2026-04-19
updated: 2026-04-20
---

# Wallet Analysis — Reusable Components + Live Data Plane

> Any 0x Polymarket wallet renders the same full-fidelity analysis view, fed by a thin HTTP route that computes deterministic metrics on demand (no DB, no migration) and defers authored judgment to [task.0333](../../work/items/task.0333.wallet-analyst-agent-and-dolt-store.md) (Dolt) + event grounding to [task.0334](../../work/items/task.0334.poly-niche-research-engine.md) (Postgres EDO).

## Problem

- `/research` renders **BeefSlayer** as a bespoke hero. Hardcoded stats, hardcoded trades, no other wallet can render.
- `OperatorWalletCard` on `/dashboard` renders the balance bar only for the operator.
- `TopWalletsCard` lists wallets but has no drill-in.

## Component decomposition

One organism, seven molecules, two variants.

```
WalletAnalysisView(address, variant, size)
│
├─ WalletIdentityHeader   ─ name · wallet · Polymarket / Polygonscan · category chip
├─ StatGrid               ─ WR · ROI · PnL · DD · hold · avg/day     [snapshot · 30 s]
├─ BalanceBar             ─ Available · Locked · Positions           [balance  · 30 s]
├─ TradesPerDayChart      ─ last 14 d bars                           [trades   · 30 s · lazy]
├─ RecentTradesTable      ─ last N trades                            [trades   · 30 s · lazy]
├─ TopMarketsList         ─ top 4 derived from trades                [derived]
├─ EdgeHypothesis         ─ markdown prose, authored                 [from task.0333 Dolt · prop fallback today]
└─ CopyTradeCTA           ─ vNext · set-as-mirror-target
```

| variant  | used by                                                   | shows                                            |
| -------- | --------------------------------------------------------- | ------------------------------------------------ |
| `page`   | `/research/w/[addr]` AND `/research` hero (`size="hero"`) | all molecules                                    |
| `drawer` | `/dashboard` row → `Sheet`                                | identity · StatGrid · BalanceBar · last 5 trades |

Molecules accept `{ data, isLoading, error }` and render their own skeleton / empty / error states. **No sub-component fetches on its own.**

`EdgeHypothesis` reads from `data.hypothesisMd` (the snapshot slice). In Checkpoint B that prop is a **hardcoded fallback for BeefSlayer only**, inlined in `view.tsx`. When task.0333 ships it comes from a Dolt `poly_wallet_analyses` row without any component change.

## Data plane — compute, not store

Three slices, three independent fetches.

| Slice      | Source                                                                                       | Availability                                              | Freshness |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| `snapshot` | compute: `PolymarketDataApiClient` trades + CLOB resolutions                                 | any addr (metrics `null` until enough resolved positions) | 30 s      |
| `trades`   | `PolymarketDataApiClient` `/trades?user=`                                                    | any addr                                                  | 30 s      |
| `balance`  | `PolymarketDataApiClient` `/positions?user=` (any addr) + operator CLOB USDC (operator only) | any addr (positions-only) · operator (full breakdown)     | 30 s      |

**No Postgres snapshot table.** No `poly_wallet_screen_snapshots`. No seed script. No migration. Numbers are deterministic `f(trades × resolutions)` — compute every request, cache the result. Research fixtures remain documentation.

**Reuse mandate.** All Polymarket Data-API calls go through the existing `PolymarketDataApiClient` in `packages/market-provider`. Metrics math lives in a new sibling package module `packages/market-provider/src/analysis/wallet-metrics.ts` — pure function over `{ trades, resolutions }`, unit-testable. Adding a second Data-API client in `nodes/poly/app/` is a review-blocking violation.

**Coalescing + concurrency.**

- Module-scoped `Map<string, { value, expiresAt }>` at the handler, 30 s TTL keyed `(slice, addr)`. Ten simultaneous requests for the same key → one upstream call.
- `p-limit(4)` shared across all upstream client calls caps in-flight requests when prefetching many wallets at once (e.g. a Monitored-Wallets hover sweep).
- Single-replica assert at boot (`instrumentation.ts`) throws if `POLY_REPLICA_INDEX != 0` or pod-name suffix is not `-0`. The module-Map cache silently corrupts with >1 replica — hard-fail, not a comment. Single-replica deployment is enforced by the SINGLE_WRITER invariant (see `poly-dev-expert` skill).

**Per-slice fetching.** `useWalletAnalysis(addr)` fans out to three React Query calls, one per slice. Each call hits `/api/v1/poly/wallets/[addr]?include=<slice>`. Three keys, three independent loading states, three skeletons render independently.

**Lazy.** `TradesPerDayChart` + `RecentTradesTable` are `next/dynamic` imports — only pulled when `variant === "page"`.

**Prefetch.** `TopWalletsCard` row → `onPointerEnter` / `onFocus` / `onTouchStart` (debounced 50 ms) → `queryClient.prefetchQuery` for `snapshot` + `trades`. `balance` skipped to spare the cap for operator use.

## API surface

One route. Contract owns the shape.

```
GET /api/v1/poly/wallets/{addr}?include=snapshot|trades|balance
```

Contract: [`nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts`](../../nodes/poly/app/src/contracts/http/poly.wallet-analysis.v1.contract.ts) (Zod). Enforces:

- `addr` matches `^0x[a-f0-9]{40}$` then lowercased before any handler logic.
- `include` repeated query params parsed as a Zod array subset of `{snapshot, trades, balance}`; default `["snapshot"]`.
- Each slice independently optional in the response. `warnings: Array<{ slice, code, message }>` surfaces partial failures — UI renders "trades unavailable, retrying" instead of silently empty.
- Any 0x address returns 200. Snapshot metrics null until resolved positions count is large enough for meaningful math (≥5 resolved).
- `balance` has two modes: operator addr → `{ available, locked, positions, total }`; any other addr → `{ positions, total }` only. Contract response shape makes `available` / `locked` optional.

**Auth.** Handler calls `await getServerSessionUser()` explicitly — no middleware trust. Acceptance test: unauthed request → `401`.

## Routes & UX flow

```
/research                  → WalletAnalysisView variant=page size=hero  (BeefSlayer block)
/research/w/[addr]         → WalletAnalysisView variant=page            (any wallet)
/dashboard row click       → Sheet with WalletAnalysisView variant=drawer + ?w=0x… deep-link
```

- `/research` keeps its dossier shape (intro · categories · no-fly zone). The BeefSlayer block becomes `<WalletAnalysisView address=BEEF variant="page" size="hero" />`, fed by the hook.
- `/research/w/[addr]` — dynamic Next.js route, auth-gated server shell, client `WalletAnalysisView`.
- Dashboard drawer — shadcn `Sheet` (already vendored). Deep-link via `?w=0x…`. Esc / click-out closes and clears the param.

## Rollout — one PR, three commits

[task.0329](../../work/items/task.0329.wallet-analysis-component-extraction.md):

| Checkpoint                 | Scope                                                                                                                                                                                                                                                                                                    | Gate                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Extract** ✅ shipped | 7 molecules + `WalletAnalysisView` page variant; `/research` re-renders BeefSlayer through it with hardcoded props                                                                                                                                                                                       | Visual parity with main                                                                                                                                                       |
| **B · Data plane**         | `packages/market-provider/src/analysis/wallet-metrics.ts` pure function + Zod contract + `GET /api/v1/poly/wallets/[addr]` route + module-scoped TTL coalesce + `p-limit(4)` + single-replica boot assert + `useWalletAnalysis` hook + `/research/w/[addr]` page. BeefSlayer block switches to the hook. | BeefSlayer numbers via API match Checkpoint-A baseline; 10-concurrent-request stampede test passes; `401` when unauthenticated; non-operator addr gets positions-only balance |
| **C · Drawer**             | `drawer` variant + `Sheet` from Monitored Wallets row + pointer/focus/touch prefetch + `?w=…` deep-link                                                                                                                                                                                                  | Drawer interactive ≤ 200 ms on prefetched row                                                                                                                                 |

### vNext — Copy-trade CTA (parked)

Blocked on two decisions: where the Harvard-flagged dataset lives, what "admin" means under multi-tenant RLS (`task.0318`). File a design when both land.

## Invariants

- Numbers are compute, not store. No poly_wallet_screen_snapshots table ever. Follow-ups that need versioned judgment go to Dolt via task.0333.
- One `useWalletAnalysis(addr)` hook, three React Query calls, three independent `{ data, isLoading, error }` slices. Molecules consume; molecules never fetch.
- Address validation in the Zod contract, not the handler.
- Any 0x address → 200. Auth enforced explicitly at the route via `getServerSessionUser()`.
- Coalesce dedups same `(slice, addr)`; `p-limit(4)` caps cross-key fan-out. Both at the handler, not the client.
- Single-replica deployment enforced by boot assert — cache corruption on replicas>1 is a hard fail.
- `balance` slice always available; operator addr gets full USDC breakdown, others get positions value only.
- All Polymarket Data-API calls go through `packages/market-provider`. Metrics computation lives in that same package — `packages/market-provider/src/analysis/`.
- `EdgeHypothesis` renders from `data.hypothesisMd`. The prop source is a hardcoded BeefSlayer fallback for Checkpoint B; task.0333 swaps it to Dolt with zero component change.

## Open questions (non-blocking)

1. **Minimum resolved-positions threshold before rendering metrics** — research doc's screen used n ≥ 15. Start there; surface "insufficient data" state if under.
2. **Calibration of `snapshot` cache vs `trades` cache** — both 30 s. Snapshot is `f(trades)` so they could share a key; kept separate for per-slice loading isolation. Worth a bench during implementation.
3. **Drawer variant on narrow viewports** — Sheet vs full-screen modal. Decide in Checkpoint C; not a design concern.

## Pointers

- Reusable view (shipped A): [`features/wallet-analysis/`](../../nodes/poly/app/src/features/wallet-analysis/)
- Data adapter (mandatory): [`polymarket.data-api.client.ts`](../../packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts)
- Metrics math source: [`scripts/experiments/wallet-screen-resolved.ts`](../../scripts/experiments/wallet-screen-resolved.ts) — extract into `packages/market-provider/src/analysis/wallet-metrics.ts`
- Selection source: [`TopWalletsCard.tsx`](<../../nodes/poly/app/src/app/(app)/dashboard/_components/TopWalletsCard.tsx>)
- Drawer primitive: [`vendor/shadcn/sheet.tsx`](../../nodes/poly/app/src/components/vendor/shadcn/sheet.tsx)
- Dolt follow-up: [`task.0333`](../../work/items/task.0333.wallet-analyst-agent-and-dolt-store.md)
- EDO follow-up: [`task.0334`](../../work/items/task.0334.poly-niche-research-engine.md)
- Research context: [`polymarket-copy-trade-candidates.md`](../research/polymarket-copy-trade-candidates.md)
