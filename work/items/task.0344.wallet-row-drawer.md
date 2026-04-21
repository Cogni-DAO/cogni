---
id: task.0344
type: task
title: "Wallet row → side drawer (skeleton-first, no page jump)"
status: needs_implement
priority: 2
rank: 5
estimate: 1
created: 2026-04-20
updated: 2026-04-20
summary: "Click a row on /research → side Sheet opens immediately with WalletAnalysisView; the three slices (snapshot, trades, balance) stream in via React Query as they land. Replaces the previous router.push to /research/w/[addr] for in-table interactions; the full page stays available via an 'Open in page →' link in the drawer header."
outcome: "Browsing /research feels continuous — click a wallet, drawer slides in instantly, skeletons render in the same frame, real numbers fade in slice-by-slice as fetches complete. No full-page navigation, no perceived dead time."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/wallet-row-drawer
pr:
reviewer:
revision: 0
blocked_by: [task.0343]
deploy_verified: false
labels: [poly, wallet-analysis, ui, drawer]
---

# task.0344 — Wallet Row → Drawer

## Problem

`/research` row-click currently does `router.push(/research/w/{addr})` — full navigation, white flash, then the server-rendered page blocks on three Polymarket fetches before any pixel paints. For browsing a list and probing wallets, this kills flow.

## Scope

In:

- New client hook `features/wallet-analysis/client/use-wallet-analysis.ts`:
  - Three independent React Query calls keyed `["wallet", addr, "snapshot"|"trades"|"balance"]`.
  - 30 s stale time mirrors the server-side coalesce TTL.
  - `enabled` flag pauses fetches when the consumer (drawer) is closed.
  - Maps the contract response into the existing `WalletAnalysisData` view shape.
  - Returns `{ data, isLoading, isError }` with **per-slice** sub-objects so molecules can render their own loading state independently.
- New `WalletDetailDrawer` component:
  - Side-Sheet (right, max-w-3xl) opens instantly with `<WalletAnalysisView ... isLoading={…}/>` — skeletons render before any network call returns.
  - Header has the title + "Open in page →" link to `/research/w/{addr}` (shareable URL escape hatch).
  - Hook `enabled=false` when sheet is closed.
- Wire on `/research` view:
  - `selectedAddr` state; row click sets it; drawer is controlled by `addr !== null`.
  - Removes the previous `router.push` row navigation.
- Exports added to `@/features/wallet-analysis` barrel.

Out:

- CopyTradeToggle in the drawer header — depends on PR #965 merging first.
- `?w=0x…` deep-link / shareable drawer URL — small follow-up.
- Pointer/focus/touch row prefetch — defer until we observe latency complaints.
- Inline expand-row variant — deliberately rejected; `WalletAnalysisView` is too wide for sub-row rendering.

## Validation

- [ ] Click any row on `/research` → drawer slides in within one animation frame; the table stays visible behind the overlay.
- [ ] Stat grid + balance bar + chart + last-5 trades all show their skeleton state immediately.
- [ ] Snapshot stats fade in independently from trades + balance (per-slice loading).
- [ ] Closing the drawer (Esc / click-out / ✕) tears down the React Query subscription so we don't background-fetch.
- [ ] "Open in page →" link routes to `/research/w/{addr}` correctly.
- [ ] Re-opening the same wallet within 30 s reuses cached slices (no upstream calls).
- [ ] Re-opening a different wallet kicks off three new fetches; previous wallet's cache stays warm.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs`, `pnpm check:fast` clean.

## Out of Scope

CopyTradeToggle in drawer (post-#965). Deep-link `?w=…`. Row prefetch on hover/focus. Inline-expand variant.

## Notes

- Based on `feat/wallets-dashboard` (PR #966); rebases cleanly once that lands.
- Once PR #965 (copy-trade toggle) merges, fold `<CopyTradeToggle addr={addr} />` into the drawer header next to "Open in page →" — five-line follow-up commit.
