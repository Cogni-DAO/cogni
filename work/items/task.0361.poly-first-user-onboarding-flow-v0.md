---
id: task.0361
type: task
title: "Poly — first-user onboarding flow v0 (sign-on → provision → fund → select targets)"
status: done
priority: 0
rank: 1
estimate: 3
created: 2026-04-23
updated: 2026-04-24
summary: "Stitch the disjoint poly pieces (sign-on, Privy wallet provisioning via task.0318, funding, Enable Trading approvals via task.0355, target selection via /research) into one continuous, scrappy end-to-end onboarding flow that an external aspiring user can walk through without Derek on the call. No new capabilities — only flow, routing, copy, empty states, and missing glue UI. Poly-specific; do NOT extract reusable primitives for other nodes yet (Node #2 consumer does not exist)."
outcome: "One real non-Derek user — the aspiring poly user Derek has lined up — completes the full flow unaided: signs in, provisions a Privy trading wallet, funds it with USDC.e + POL, enables trading (token approvals), selects at least one target wallet to copy-trade, and sees their first mirrored fill appear in their dashboard. Observed by Derek (concierge) for the first run, confirmed in Loki at the deployed candidate-a SHA. This is the project's MVP validation gate — the first time anything Cogni has built is used end-to-end by someone other than Derek."
spec_refs:
  - docs/spec/poly-multi-tenant-auth.md
  - docs/spec/poly-trader-wallet-port.md
assignees: []
credit:
project: proj.poly-copy-trading
branch: design/task-0361-poly-first-user-onboarding-v0
pr: https://github.com/Cogni-DAO/node-template/pull/1030
reviewer:
revision: 0
blocked_by: []
labels:
  [poly, onboarding, ui, mvp, first-user, deploy-verified, user-validation]
---

# task.0361 — Poly first-user onboarding flow v0

## Context

**This is the MVP validation gate for the entire Cogni project.** Per constraint evaluation 2026-04-23 (Eval #5c, `work/charters/CONSTRAINTS.md`), the binding constraint is M03 (zero validated end-to-end user flows). Derek has one aspiring poly user lined up. Until that person walks the full flow unaided, every other project investment is faith-based.

Almost every _capability_ needed already exists, landed across the last month's commits — but the **flow** does not. Today a real user hits disjoint pages, empty states, and dead-ends between steps. The job of this task is not to build new capabilities; it is to make the existing capabilities feel like one thing.

## Problem

An aspiring user arriving at candidate-a today cannot self-serve. Concretely, the flow breaks at the seams:

| Step                          | Capability shipped                                                  | Flow shipped?                                                              |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Sign on                    | ✅ existing auth                                                    | ✅ but no post-sign-on routing toward poly                                 |
| 2. Provision trading wallet   | ✅ task.0318 Phase B (`/api/v1/poly/wallet/connect`, Privy custody) | ❌ no visible call-to-action; buried on Money page                         |
| 3. Fund wallet (USDC.e + POL) | ✅ wallet address shown on Money page                               | ❌ no copy/instructions for a user who has never bridged to Polygon before |
| 4. Enable Trading (approvals) | 🟡 task.0355 (PR #992) in review                                    | 🟡 1-click modal exists but isn't wired into an onboarding sequence        |
| 5. Select target wallet(s)    | ✅ `/research` wallet browse + clickable rows                       | ❌ no link from onboarding; user has to discover `/research` themselves    |
| 6. See first mirrored fill    | ✅ per-tenant trade execution (task.0318 Phase B3)                  | ❌ no "you're live — watch here" confirmation state                        |

Every individual piece works. None of them point to the next one.

## Scope

> **Superseded by `## Design` below.** The original scope (a dedicated `/onboarding` route with 5 wizard-style steps, auto-advance polling, QR codes, and post-sign-on redirect middleware) was rejected during design in favor of in-place progressive disclosure on `/credits` + `/dashboard`. The original text is retained below for historical context — do NOT use it as a build spec. Read `## Design`.

<details>
<summary>Original (rejected) scope — historical</summary>

**In (poly-specific, not reusable):**

- **Single `/onboarding` entry point** — one page rendering current step based on wallet state, 5 conditional blocks.
- **Step state derived from real wallet state**, not a separate onboarding-progress table.
- **Funding step copy + checklist** with Bridge link, pasteable address + QR code, 10s poll, auto-advance on balance threshold.
- **Enable Trading step** reuses task.0355 1-click modal verbatim.
- **Target selection step** — thin wrapper around existing `/research` wallet browse.
- **Confirmation step** + dashboard "waiting for first fill" empty state.
- **Post-sign-on routing** — redirect to `/onboarding` when wallet missing.
- **One-line copy/content pass** across all 5 steps.

**Explicitly OUT of scope** (still holds under the new design):

- Reusable onboarding components for other nodes.
- Polish beyond "non-technical user can finish without assistance."
- Analytics instrumentation.
- Multi-user onboarding concurrency.
- Password reset / account recovery.
- New capabilities (new API routes, port methods, DB columns).
- Funding UX that actually does the bridge.

</details>

## Validation

**This task's `deploy_verified: true` gate IS the MVP validation gate for the project.**

- `exercise:` Derek's aspiring poly user completes the full flow on candidate-a — signs in, provisions wallet, funds with real USDC.e + POL on Polygon mainnet, enables trading (approvals land on-chain), selects ≥1 target wallet from `/research`, and sees their first mirrored fill appear on the dashboard. Derek watches (screen-share or in-person) but does not touch keyboard.
- `observability:` Loki query confirms the user's request path at the deployed SHA: sign-on → `connect` → `enable-trading` → copy-trade target insert → first `mirror-fill` entry for their `billing_account_id`. Include the user's anonymized `billing_account_id` and the candidate-a SHA in the PR comment.

If anything breaks mid-flow for this user, the break is not a concierge-fix-and-move-on — it's a gating bug to be filed and resolved before this task closes. The whole point is "works unaided."

## Execution notes for the next dev

1. Read Derek's aspiring-user context first. What's their Polygon/crypto fluency level? That dictates the funding-step copy.
2. **Walk the current flow yourself as a new user** before touching code. Wipe your session, sign in from scratch on candidate-a, try to provision + fund + enable + copy. Write down exactly what you had to know-from-outside-the-UI to complete each step. That list is your scope.
3. Scrappy means scrappy: one route, one component, shadcn defaults, Tailwind classes inline. No design system extraction. No new packages.
4. Poll-based state detection (10s interval) is fine for funding + approvals steps; no websockets needed. Use TanStack Query with `refetchInterval`.
5. If you find yourself adding a new capability (new API route, new port method, new DB column) — STOP. That's out of scope. File a bug, land onboarding around the gap, ship.
6. Aim: land PR within 3-5 days of starting. Concierge user through it within 7.

## Design

### Outcome

One real non-Derek user walks sign-on → fund-and-trade on a single page (`/credits`) → pick targets on `/research` → first mirrored fill on `/dashboard`, unaided. No new route, no wizard, no new capabilities — just delete the dead-end bounce and let the Money page progressively reveal the steps as wallet state evolves.

### Approach

**Solution**: Collapse the flow onto existing pages. Make `/credits` the single page that hosts the entire wallet lifecycle (create → fund → enable → trade), and make `/dashboard` the post-sign-on landing hub that points users at `/credits` and `/research` when they haven't completed those steps.

Concretely:

1. **Move `TradingWalletConnectFlow` (create-wallet + caps sliders) from `/profile` into `credits/TradingWalletPanel`.** When `status.configured=true && !status.connected`, `TradingWalletPanel` renders the connect flow in place of today's "Create a wallet in Profile → [Profile]" dead-end button. On success, the same panel mounts balances + `TradingReadinessSection` + fund/withdraw stubs — no navigation. This is the heart of the task.

2. **Remove the trading-wallet row from `/profile` entirely.** Profile is identity (display name, avatar, OAuth, AI providers, ownership). Money lives on `/credits`. Leaving it in two places was the original bug. `/profile` loses ~100 lines; `TradingWalletConnectFlow` + `GrantCapSlider` move into `nodes/poly/app/src/app/(app)/credits/TradingWalletConnectFlow.tsx`.

3. **Tighten funding copy on `TradingWalletPanel`.** After connect, the USDC.e/POL balance row gets a one-line sub-caption with two external links: "Send USDC.e on Polygon (any wallet or [Polygon Portal bridge](https://portal.polygon.technology/bridge)). Needs ~0.2 POL for gas." Polls already in place (20s `refetchInterval`). No new API, no auto-advance logic — the CTAs on the page already gate correctly (Enable Trading needs POL ≥ 0.1; trade execution needs USDC.e; both enforced by existing components).

4. **Dashboard = hub, via extending existing cards (no new components).** The dashboard already has two cards that cover the user's wallet + copy-trade state; extend them instead of stacking a separate hint strip above them:
   - `TradingWalletCard` (`dashboard/_components/TradingWalletCard.tsx`) already renders "No trading wallet connected yet → [Connect →]" → `/credits` when `!connected`. Add one branch: when `connected && !trading_ready`, render "Trading not enabled → [Enable trading →]" → `/credits`. Same card, same visual slot, one extra conditional.
   - `CopyTradedWalletsCard` already renders on the dashboard. Add two empty-state branches driven off existing `dashboard-copy-targets` query: `trading_ready && 0 targets` → "Pick a wallet to copy →" linking to `/research`; `targets > 0 && 0 fills` → "Waiting for your first mirrored fill. Targets: […]" (no link, informational). Verify the card's current empty state during implement; replace or add, don't duplicate.

5. **No separate `OnboardingHint` component.** Considered during design; rejected — it would stack a second "Connect →" CTA directly above `TradingWalletCard`'s existing one. Extending the two cards that already own those states is strictly fewer moving parts.

6. **No post-sign-on redirect.** Users land on `/dashboard` as today; the extended cards pull them to the right page. Simpler than routing middleware; keeps the dashboard as the "home" affordance.

7. **`/research` target-selection path verified.** Each wallet row has a dedicated `+` (follow) control that registers a copy-trade target; the row body opens a research drawer for that wallet. No wrapper UI needed — the link target from `CopyTradedWalletsCard`'s empty state takes the user to a page where the primary action is one click on a `+`. No change to `/research` in this task.

8. **No new `/onboarding` route, no wizard component, no onboarding-progress table, no poll-and-advance state machine.** Wallet state already IS the onboarding state; the UI just reads it.

**Reuses**:

- `TradingWalletConnectFlow` + `GrantCapSlider` (from `profile/view.tsx`, moved verbatim)
- `TradingReadinessSection` (already in `TradingWalletPanel`, task.0355)
- `poly.wallet.status.v1`, `poly.wallet.balances.v1`, `poly.wallet.enable-trading.v1` contracts
- Existing React Query keys `poly-wallet-status`, `poly-wallet-balances`, `dashboard-copy-targets`
- shadcn/ui + Tailwind inline — no new design system primitives

**Rejected**:

- **Dedicated `/onboarding` route with 5-step conditional render (the task's original scope).** Duplicates state the Money page already computes; adds a route and component shell for zero user-visible value. The whole point of MVP-scrappy is not building a second surface.
- **Wizard framework (e.g. `react-stepper`).** Two interactive steps (create, enable) plus informational fund-waiting state. Not five. Not a wizard.
- **New `poly_onboarding_progress` table + server state machine.** Wallet state already answers "what step are you on?" via `status.v1` + `balances.v1` + copy-targets count. Adding a table re-derives state that already exists in the DB.
- **Post-sign-on redirect middleware** (`/dashboard` → `/credits` when no wallet). Pulls users away from the hub before they see the rest of the product; makes /dashboard feel gated. The extended cards are the softer, more legible nudge.
- **Dedicated `OnboardingHint` dashboard strip.** Would stack a second "Connect →" CTA above `TradingWalletCard`'s existing one and a second "Waiting for fills…" line above `CopyTradedWalletsCard`'s empty state. Extending those two cards in place is strictly fewer components and avoids on-screen duplication.
- **Reusable `<OnboardingChecklist />` primitive for other nodes.** Explicitly out of scope (Node #2 consumer does not exist; per project charter).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_NEW_CAPABILITIES — no new API routes, port methods, DB columns, or contracts (spec: task scope)
- [ ] NO_URL_RENAME — `/credits` route stays stable (spec: `credits/CreditsPage.client` invariant)
- [ ] ENABLE_TRADING_VISIBLE — `TradingReadinessSection` remains the primary above-the-fold CTA when connected && !trading_ready (spec: `TradingWalletPanel`)
- [ ] PROFILE_IS_IDENTITY_ONLY — `/profile` owns identity (name, OAuth, AI providers, ownership); wallet lifecycle lives on `/credits`
- [ ] STATE_DRIVEN_UI — step a user is "on" is derived from `poly.wallet.status.v1` + `balances.v1` + copy-target count; no onboarding-progress persistence
- [ ] POLY_SPECIFIC — no shared/extracted onboarding primitives (wait for Node #2)
- [ ] SIMPLE_SOLUTION — leverages existing components/queries over bespoke code (spec: architecture)
- [ ] ARCHITECTURE_ALIGNMENT — client components under `nodes/poly/app/src/app/(app)/…`; contracts via `@cogni/node-contracts` (spec: architecture)

### Files

- **Create**: `nodes/poly/app/src/app/(app)/credits/TradingWalletConnectFlow.tsx` — moved from `profile/view.tsx`; exports `TradingWalletConnectFlow` and its internal `GrantCapSlider`. ~130 LOC relocation, no logic change.
- **Modify**: `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx` — replace the `!connected` branch (currently a link to `/profile`) with an inline render of `TradingWalletConnectFlow`; on `onConnected`, invalidate `poly-wallet-status` so the panel flips to the balances/enable-trading view without a reload. Add funding sub-caption with Bridge + USDC.e links beneath the balance grid.
- **Modify**: `nodes/poly/app/src/app/(app)/profile/view.tsx` — delete `TradingWalletConnectFlow`, `GrantCapSlider`, the Polymarket Trading Wallet `SettingRow`, and all related `tradingWallet*` state + fetch. Profile drops to identity + OAuth + AI providers + ownership. Pre-delete: `grep -r` for component/stack tests asserting on the trading-wallet row in profile and update/remove.
- **Modify**: `nodes/poly/app/src/app/(app)/dashboard/_components/TradingWalletCard.tsx` — add a `connected && !trading_ready` branch alongside the existing `!connected` branch. Text: "Trading not enabled"; CTA: "Enable trading →" linking to `/credits`. Reuses the same layout/classes as the existing `!connected` branch. Reads `trading_ready` off the existing `fetchTradingWallet` response (if not already exposed there, off `poly-wallet-status` query — check first).
- **Modify**: `nodes/poly/app/src/app/(app)/dashboard/_components/CopyTradedWalletsCard.tsx` — extend the empty/zero-state branches: `trading_ready && 0 targets` → "Pick a wallet to copy →" linking to `/research`; `targets > 0 && 0 fills` → "Waiting for your first mirrored fill. Targets: […]" (informational, no link). Read wallet readiness off the existing `poly-wallet-status` query. Verify current empty state during implement — replace, don't duplicate.
- **Test**: `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.test.tsx` (component) — disconnected state renders the connect flow inline; after mocked `onConnected`, balances branch renders. Keep small; this is a smoke test, not a re-test of the moved component.
- **Test**: `nodes/poly/app/src/app/(app)/dashboard/_components/TradingWalletCard.test.tsx` — three-state render check: `!connected`, `connected && !trading_ready`, `connected && trading_ready`. Only the CTA label / link target needs assertion.

Out-of-scope deletions (file on sight, don't fix here): funding auto-advance polling, bridge-UX inside app, target-selection wrapper on `/research` (the existing `+ (follow)` control on each row is the one-click register; no wrapper needed).

## Plan

- [ ] **Checkpoint 1 — Wallet creation on /credits, /profile slimmed**
  - Milestone: user can create a trading wallet from `/credits` without bouncing to `/profile`; `/profile` no longer owns wallet lifecycle.
  - Invariants: NO_URL_RENAME, ENABLE_TRADING_VISIBLE, PROFILE_IS_IDENTITY_ONLY, NO_NEW_CAPABILITIES.
  - Todos:
    - [ ] Create `nodes/poly/app/src/app/(app)/credits/TradingWalletConnectFlow.tsx` (moved from `profile/view.tsx`).
    - [ ] Modify `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx` — replace `!connected` "go to Profile" branch with inline render of the moved component; invalidate `poly-wallet-status` on success; add funding sub-caption with Polygon bridge link.
    - [ ] Modify `nodes/poly/app/src/app/(app)/profile/view.tsx` — delete the Polymarket Trading Wallet `SettingRow`, the `TradingWalletConnectFlow` + `GrantCapSlider` functions, and all `tradingWallet*` state + fetch.
  - Validation: `pnpm check:fast`; manual smoke optional in dev.

- [ ] **Checkpoint 2 — Dashboard nudges**
  - Milestone: dashboard guides first-time users toward `/credits` (enable trading) and `/research` (pick targets) via in-place card extensions.
  - Invariants: STATE_DRIVEN_UI, SIMPLE_SOLUTION.
  - Todos:
    - [ ] Modify `nodes/poly/app/src/app/(app)/dashboard/_components/TradingWalletCard.tsx` — add `connected && !trading_ready` branch, CTA "Enable trading →" to `/credits`.
    - [ ] Widen `nodes/poly/app/src/app/(app)/_components/wallets-table/WalletsTable.tsx` `emptyMessage` prop to `ReactNode`.
    - [ ] Modify `nodes/poly/app/src/app/(app)/dashboard/_components/CopyTradedWalletsCard.tsx` — empty-state message becomes a real clickable link to `/research` ("Pick a wallet to copy — browse top traders →").
  - Validation: component tests below + `pnpm check:fast`.

- [ ] **Checkpoint 3 — Tests + finalize**
  - Milestone: guard-rail tests for the two extended cards; `pnpm check` green; status flipped to `needs_closeout`.
  - Todos:
    - [ ] Add `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.test.tsx` (disconnected renders connect flow inline; connected + trading_ready renders readiness branch).
    - [ ] Add `nodes/poly/app/src/app/(app)/dashboard/_components/TradingWalletCard.test.tsx` (three CTA-state render check).
    - [ ] `pnpm check`; flip frontmatter `status: needs_closeout`, bump `updated`, push.

## Worktree

`/Users/derek/dev/cogni-template-task-0361-poly-onboarding-v0` (created 2026-04-23, branched off main).
