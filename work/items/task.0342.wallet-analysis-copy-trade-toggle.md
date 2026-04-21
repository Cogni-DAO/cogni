---
id: task.0342
type: task
title: "Wallet analysis — per-wallet copy-trade status pill + toggle"
status: needs_implement
priority: 2
rank: 5
estimate: 1
created: 2026-04-20
updated: 2026-04-20
summary: "Add a live-agent-style copy-trade indicator pill to the /research/w/[addr] page that shows whether the calling user is currently mirroring this wallet, with click-to-toggle on/off. Shares the same per-user API + React Query key as the dashboard Monitored Wallets card so flips are reflected everywhere in lock-step."
outcome: "Open any wallet's analysis page. A green 'Copy-trading' pill with pulsing Radio icon top-right = mirroring; click to stop. Muted 'Copy-trade' pill = not; click to start. Same pill style the dashboard uses for 'N agents active'."
spec_refs:
  - docs/design/wallet-analysis-components.md
  - docs/spec/poly-multi-tenant-auth.md
assignees: [derekg1729]
credit:
project: proj.poly-prediction-bot
branch: feat/wallet-analysis-copy-toggle
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, wallet-analysis, ui, copy-trading]
---

# task.0342 — Wallet Analysis: Copy-Trade Toggle

## Problem

Monitored Wallets on `/dashboard` has `+` / `−` buttons to track a wallet. The per-wallet analysis page at `/research/w/[addr]` (shipped in task.0329) has no way to toggle tracking. Users drill into a wallet, decide to mirror it, then have to navigate back to `/dashboard` to enable it. Friction.

## Scope

In:

- Extract the three copy-trade client helpers + React Query key from `app/(app)/dashboard/_api/fetchCopyTargets.ts` into `features/wallet-analysis/client/copy-trade-targets.ts`. One source of truth for `COPY_TARGETS_QUERY_KEY` so every UI surface invalidates together.
- Update `TopWalletsCard` to import from the new feature location. Delete the old dashboard file.
- New `CopyTradeToggle` client component — styled after the dashboard's "N active" live-agents pill:
  - Tracked: green pill, pulsing `Radio` icon, text "Copy-trading". Click → deletes the row.
  - Untracked: muted pill, `Plus` icon, text "Copy-trade". Click → creates a target.
  - Pending: spinner + "Starting…" / "Stopping…".
  - Matches wallet address case-insensitively.
- Add `headerActions?: ReactNode` slot to `WalletAnalysisView` so the page can inject the toggle into the top-right of the header. Keeps the organism pure-props.
- `/research/w/[addr]/page.tsx` passes `<CopyTradeToggle addr={addr} />` into the slot.
- 4 unit tests via happy-dom + RTL + React Query provider.

Out:

- Drawer variant on `/dashboard` — next larger item.
- Dedicated "Wallets" dashboard redesign — design-first follow-up.
- Mode / mirror_usdc / source controls — v0 uses server defaults.

## Validation

- [ ] `/research/w/{addr}` renders the toggle top-right of the header card.
- [ ] Untracked: muted pill with `+`, text "Copy-trade". Clicking starts tracking.
- [ ] Tracked: green pill with pulsing `Radio`, text "Copy-trading". Clicking stops tracking.
- [ ] Flipping here immediately reflects on `/dashboard` Monitored Wallets (shared query key).
- [ ] Case-insensitive address match — pasting `0xAB…` finds the stored `0xab…` row.
- [ ] Pending state disables double-clicks.
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm check:docs`, `pnpm check:fast` all clean.
- [ ] 4 unit tests pass.

## Out of Scope

Checkpoint C drawer. Admin gating. Harvard-flagged-dataset check at click time (vNext per task.0329 design).
