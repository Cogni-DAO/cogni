---
id: task.0343
type: task
title: "Research page → wallets browse dashboard (replaces static dossier)"
status: needs_implement
priority: 2
rank: 5
estimate: 2
created: 2026-04-20
updated: 2026-04-20
summary: "Replace the static spike.0323 dossier on /research with a browseable wallets table that mirrors the /work toolbar pattern (Input + FacetedFilter + DataGrid). Same nav slot, same URL — no /wallets sprawl. Click any row → /research/w/[addr]. Compact no-fly-zone footer keeps the compliance reminder."
outcome: "Click 'Research' in the sidebar → see live top-N Polymarket wallets in a sortable, filterable table. Filter by Period (DAY/WEEK/MONTH/ALL), Category (heuristic v0), Tracked (yes/no). Search by wallet substring or username. Quick-jump to any 0x via the existing WalletQuickJump. The static dossier (BeefSlayer hero, category map, runner-up cards, sources) is deleted — its content lives on /research/w/0x331b… and the no-fly-zone footer."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/wallets-dashboard
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, wallet-analysis, ui, research, dashboard]
---

# task.0343 — Research → Wallets Browse Dashboard

## Problem

`/research` today is a 715-line static dossier from spike.0323. Now that we have a real `/research/w/[addr]` page with live data and a `/dashboard` Monitored Wallets card, the static prose is mostly redundant — the BeefSlayer hero is just a hardcoded copy of what `/research/w/0x331b…` renders live, the runner-up cards are duplicate data, and the category scorecard's job (telling users what to look at) is better done by an actual filter chip.

We also explicitly do not want to add a sibling `/wallets` page — that's UI sprawl. Replace the existing `/research` view with a browse dashboard, keep the URL, keep the nav slot.

## Scope

In:

- New `_components/category.ts` — v0 heuristic mapping userName/wallet → coarse category enum (Weather · Tech · Sports · Esports · Politics · Crypto · Other). Pure function. Real labels arrive with task.0333 Dolt analyst.
- New `_components/columns.tsx` — TanStack column definitions matching the `/work` shape. Reuses `formatShortWallet`, `formatPnl`, `formatRoi`, `formatNumTrades`, `formatUsdc` from `dashboard/_components/wallet-format` (already shared).
- Rewrite `view.tsx` — single client view:
  - `WalletQuickJump` for paste-any-wallet (already shipped in PR #963).
  - `/work`-style toolbar: `Input` search + three `FacetedFilter`s (Period, Category, Tracked) + Clear filters. URL-driven state (`?period=…&category=…&tracked=…&q=…&sort=…`).
  - `DataGrid` from `components/reui/data-grid/` — same primitives `/work` uses. Click row → `router.push(/research/w/{addr})`.
  - Footer: compact 2-column no-fly aside with the four explicit avoids + Harvard-flagged-dataset rule of thumb.
- Delete the rest of the old static dossier (BeefSlayer hero, runner-up cards, category scorecard, runner-up roster, sources, footer prose). Live data + `/research/w/0x331b…` cover the same ground.

Out:

- New `/wallets` route — explicit non-goal (UI sprawl).
- Per-row WR / ROI / DD from snapshot fetch — would require N CLOB calls per render. Defer until prefetch + caching can handle it.
- Real Dolt-stored categories — task.0333.
- Sheet drawer on row click — full navigation matches `/work`; a drawer is a separate feature ask.

## Validation

- [ ] `/research` renders the new toolbar + grid (visual shape matches `/work`).
- [ ] Search input filters rows by wallet substring + username.
- [ ] Period filter swaps the underlying leaderboard window (DAY/WEEK/MONTH/ALL).
- [ ] Category filter narrows by the heuristic label.
- [ ] Tracked filter shows only currently copy-traded wallets when set to "Tracked".
- [ ] Clear filters resets all four.
- [ ] Click any row → navigates to `/research/w/{addr}`.
- [ ] URL reflects filter state and survives page reload.
- [ ] No-fly footer renders with the four avoids + Harvard link.
- [ ] No new sidebar nav item; `/research` slot is preserved.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs`, `pnpm check:fast` clean.

## Out of Scope

Drawer view. Per-row WR/ROI from snapshot fetch. Dolt-tagged categories. New `/wallets` route.

## Notes

- Cleanly depends on PR #965 (copy-trade toggle) once that merges — it moves `fetchCopyTargets` + `COPY_TARGETS_QUERY_KEY` into `@/features/wallet-analysis/client/copy-trade-targets`. Two-line import swap during rebase.
