---
id: task.0335
type: task
title: "Wallet analysis — clickable Monitored Wallets rows + paste-any-wallet search"
status: needs_implement
priority: 2
rank: 5
estimate: 1
created: 2026-04-20
updated: 2026-04-20
summary: "Two tiny UX unlocks on top of the shipped /research/w/[addr] page: (1) Monitored Wallets rows on /dashboard become links into the analysis page; (2) a paste-box accepts any 0x address and routes to the same page. Both ride the same dynamic route that ships in task.0329."
outcome: "Clicking any row on the /dashboard Monitored Wallets card navigates to /research/w/{addr}. A search box on /research + /dashboard lets you paste any 0x wallet and jump to its analysis. No new data paths; no drawer yet (that's a bigger follow-up)."
spec_refs:
  - docs/design/wallet-analysis-components.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/wallet-analysis-clickable-search
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, wallet-analysis, ui, quick-win]
---

# task.0335 — Clickable rows + paste-any-wallet search

## Problem

task.0329 shipped `/research/w/[addr]` — a live per-wallet analysis page that works for any 0x address. But the only way to reach it is to type the URL by hand. The existing Monitored Wallets table on `/dashboard` lists wallets without a drill-in. And there's no way to jump to an ad-hoc address from the UI.

## Scope

In:

- **Clickable rows** — `TopWalletsCard` (Monitored Wallets) each row wraps its key cells in `<Link href={/research/w/${addr}}>`. Whole row highlights on hover. Existing "Copy" action buttons stay as inline affordances that don't navigate.
- **Search box** — new tiny `WalletQuickJump` client component. Controlled text input + a Go button. Validates the address via `PolyAddressSchema` (the existing Zod regex + lowercase transform); invalid input shows a muted error under the box. On valid submit, `router.push(/research/w/${addr})`.
  - Mounted on `/research` (near the masthead) and on `/dashboard` (above the Monitored Wallets card).
- `WalletQuickJump` unit test — renders, rejects garbage, routes on valid addr (mock `useRouter`).

Out:

- Sheet drawer / in-page quick look — deferred.
- React Query client hook — deferred until drawer needs prefetch.
- Dedicated `/research/wallets` browse page with categories / "research mode" tab split — bigger follow-up; see parent project roadmap.

## Validation

- [ ] Clicking any Monitored Wallets row on `/dashboard` navigates to `/research/w/{addr}` (the row's lowercased address).
- [ ] Hover state visible on the whole row (not just a sub-cell).
- [ ] Existing per-row buttons (Copy, etc.) don't navigate; their click is still handled.
- [ ] `WalletQuickJump` on `/research` accepts a valid 0x address and navigates.
- [ ] Invalid input shows an inline error, does not navigate.
- [ ] Pressing Enter submits.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs`, `pnpm check:fast` all clean.

## Out of Scope

- Full "Wallets" dashboard redesign (research + categories + search tabs) — sized as a separate design-first task when you're ready.
- Dolt-backed analyst copy (task.0333) · niche-research engine (task.0334).
