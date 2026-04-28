---
id: task.0347
type: task
title: "Poly wallet — minimal policy UI for grants caps"
status: needs_implement
priority: 1
rank: 6
estimate: 3
summary: "Surface the existing `poly_wallet_grants` row as an editable Money-page card and a read-only per-target view on Research wallets. Reusable `<PolicyControls>` component, two numeric inputs (per-trade cap, per-day cap), no schema changes. Today caps can only be changed via raw SQL — derek hit this on task.0404 candidate-a validation."
outcome: "From the Money page a user reads + edits their `polyWalletGrants.{perOrderUsdcCap,dailyUsdcCap}` and the change takes effect on the next mirror tick. From a Research wallet detail (when copy-trade is on) the same component renders read-only with a link back to Money. No SQL required to bump caps."
spec_refs:
  - poly-trader-wallet-port
  - poly-multi-tenant-auth
assignees: [derekg1729]
project: proj.poly-bet-sizer
branch: feat/task-0347-policy-ui
pr: https://github.com/Cogni-DAO/node-template/pull/1103
created: 2026-04-21
updated: 2026-04-28
labels: [poly, polymarket, wallets, ui, grants, money-page]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - work/items/task.0404.poly-bet-sizer-v0.md
  - work/projects/proj.poly-bet-sizer.md
  - docs/spec/poly-trader-wallet-port.md
  - docs/design/poly-policy-ui/desired-policy-ui.png
  - nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx
  - nodes/poly/packages/db-schema/src/wallet-grants.ts
---

# task.0347 — Minimal policy UI for grants caps

## Why this exists

Task.0404 validation surfaced the user pain in production form: the user hit `cap_exceeded_per_order` on candidate-a, and the only way to lift the cap was for an agent to SSH into the VM and run a raw SQL `UPDATE poly_wallet_grants`. Nobody who isn't on the dev team can do that. v1 of the v0 bet sizer is meaningfully shippable to a non-Derek user only after this surface lands.

Earlier scope of this task bundled three concerns (funding suggestions, balance reads, sizing config). Two of those are now handled: balance reads ship via `/api/v1/poly/wallet/balances` (task.0353), and sizing math is a discriminated union variant (task.0404). The remaining pain — caps editing — is what this task ships.

## Context

- `polyWalletGrants` table exists with `per_order_usdc_cap`, `daily_usdc_cap`, `hourly_fills_cap` (numeric/int), one active row per tenant, RLS-enforced via `tenant_isolation` policy. Schema is right; what's missing is the edit surface.
- Today the only writers are `provisionWithGrant()` at wallet-onboarding time and ad-hoc SQL.
- `authorizeIntent` reads the grant row fresh per call (no in-process cache) — config changes take effect on the next mirror tick.
- Per-target overrides are explicitly **out of scope** for this task. v1 = single global policy; per-target variable allocation is `proj.poly-bet-sizer` Walk phase.

## Design

### Outcome

A user opens **Money** → **Trading wallet** card → sees `Per trade $X · Per day $Y` row → clicks edit → adjusts → save persists to `polyWalletGrants` and the new caps gate the very next placement attempt. From any Research wallet detail (when that target is in copy-trade), the same `<PolicyControls>` shows read-only with "Edit on Money" link. No raw SQL.

### Approach

**Solution.** One reusable component, two numeric inputs, two routes, zero schema changes:

1. **`<PolicyControls>`** — pure presentational React component, props `{values, onSave?, readonly}`. When `readonly`, renders just the numbers + "Edit on Money" link. When editable, renders inline edit (numeric `Input` from `kit/inputs/Input.tsx` × 2) + Save button (`kit/inputs/Button.tsx`). No sliders for v1 — numeric input is denser, more honest about precision, and matches the existing AI-credits panel pattern. Sliders land in vNext when the value is a percentage of a known budget (allocation %).

2. **Routes.**
   - `GET /api/v1/poly/wallet/grants` — return active grant row for the calling tenant
   - `PUT /api/v1/poly/wallet/grants` — partial update of `{per_order_usdc_cap, daily_usdc_cap}` (intentionally NOT `hourly_fills_cap` — keeping the editable surface to the two numbers users actually feel)
   - Both authed via session, RLS-clamped via `appDb`. No service-DB writes.

3. **Contract.** `poly.wallet.grants.v1` — Zod, mirrors the schema's CHECK constraints (`per_order > 0`, `daily >= per_order`, both `numeric(10,2)`). Lives in `packages/node-contracts`.

4. **UI integration.**
   - **Money page** (`TradingWalletPanel.tsx`): add `<PolicyControls editable />` row below "Trading enabled" badge, above the existing `Fund/Withdraw` row. React Query reads `/grants`, mutation invalidates on save.
   - **Research wallet detail** (existing `CopyTradedWalletsCard.tsx` row click → wallet detail): when the wallet is an active copy-trade target, render `<PolicyControls readonly />` with the same values + a `<Link href="/credits">` "Edit on Money".

5. **Hourly-fills cap** stays at its provisioned default; no UI surface in v1. If we ever need to lift it, that's another row.

**Reuses.**

- Existing `polyWalletGrants` schema + RLS policy + `provisionWithGrant()` defaults.
- Existing `Card`, `HintText`, `AddressChip` from `@/components/kit`.
- Existing React Query setup in `TradingWalletPanel.tsx`.
- Existing `authorizeIntent` cap enforcement — caps are read fresh per call so updates take effect immediately.

**Rejected.**

- **Sliders for v1 caps.** User sketch suggested "1-2 sliders/toggles". Caps are dollar amounts with no natural anchor (range $0 → $∞), so sliders need an arbitrary max → wrong abstraction. Numeric input is honest about the cents-precision the schema enforces. The toggle half of the user's ask IS satisfied — it's the per-target `<TargetActiveToggle>`. Sliders return for v2 when allocation % lands and the range is implicitly 0-100%.
- **Per-target cap overrides in v1.** Requires either a new `poly_copy_trade_target_grants` table or per-target columns on `polyCopyTradeTargets` — meaningful schema lift. Walk-phase concern. v1 ships single global cap surfaced in two places.
- **Touching `poly_copy_trade_config` for caps.** Caps live on `polyWalletGrants`, full stop. The original task.0347 design predated grants shipping.
- **Polygon RPC balance read on `/connect`.** Already shipped via `/wallet/balances` (task.0353). Out of scope here.
- **Editing `hourly_fills_cap`.** Sane default already provisioned; another control adds clutter without measurable user value at MVP.

### Invariants

- [ ] **CAPS_LIVE_IN_GRANT**: edits flow to `polyWalletGrants`, never to `polyCopyTradeConfig`. (spec: poly-multi-tenant-auth)
- [ ] **TENANT_ISOLATION**: routes use `appDb` (RLS-clamped) — never `serviceDb`. A tenant cannot read or write another tenant's grant. (spec: poly-multi-tenant-auth)
- [ ] **CHECK_CONSTRAINTS_AT_WIRE**: Zod contract enforces `per_order > 0`, `daily >= per_order` so a malformed PUT is rejected before hitting the DB CHECK constraint. (spec: schema)
- [ ] **REUSABLE_COMPONENT**: `<PolicyControls>` is a single component with `readonly` mode; Money page mounts it editable, Research wallet detail mounts it read-only with a Money-page link. No two divergent implementations of the same row.
- [ ] **SIMPLE_SOLUTION**: two routes, two numeric inputs, one component, zero schema changes.

### Files

- **Create:** `packages/node-contracts/src/poly.wallet.grants.v1.contract.ts` — Zod contract (Get/Put input + output, plus typed error codes `invalid_caps | not_authenticated | no_active_grant`).
- **Create:** `nodes/poly/app/src/app/api/v1/poly/wallet/grants/route.ts` — GET + PUT, session-required, appDb-scoped, RLS-clamped.
- **Create:** `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/[id]/route.ts` (PATCH) — toggle `disabled_at` for one of the calling user's targets. Uses existing `polyCopyTradeTargets` row, no schema change.
- **Create:** `nodes/poly/app/src/app/_facades/poly/wallet-grants.server.ts` — facade owning DB read/write + error translation. Throws `{code: 'invalid_caps'}` on PG `23514` so the component can render the inline message.
- **Create (done — committed):** `nodes/poly/app/src/components/kit/policy/PolicyControls.tsx` — reusable two-row caps component, props `{values, onSave?, readonly}`. Editable mode = numeric inputs with `inputMode="decimal"` (NOT sliders — see Rejected). Readonly mode = values + `Edit on Money →` link.
- **Create (done — committed):** `nodes/poly/app/src/components/kit/policy/TargetActiveToggle.tsx` — sibling toggle for the per-target view. Props `{active, onToggle}`. The toggle the user's sketch called for; pairs with `<PolicyControls readonly />` on the Research wallet detail.
- **Create (done — committed):** `nodes/poly/app/src/components/kit/policy/AGENTS.md` — directory scope.
- **Modify:** `nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx` — mount `<PolicyControls />` (editable) below the "Trading enabled" badge. Uses React Query (`/grants` query + mutation), invalidates on save.
- **Modify:** `nodes/poly/app/src/features/wallet-analysis/components/WalletAnalysisSurface.tsx` — when this wallet is an active copy-trade target, render `<TargetActiveToggle />` + `<PolicyControls readonly />` near the existing `CopyWalletButton`. Reuses the same `/grants` query.
- **Test:** unit (`PolicyControls.test.tsx`, `TargetActiveToggle.test.tsx`) + contract round-trip (`poly.wallet.grants.v1.contract.test.ts`) + route happy path + `daily < per_order` → 422 with `code: 'invalid_caps'`.

### Sketch

The desired UX layout (sketch by user, 2026-04-28):
[`docs/design/poly-policy-ui/desired-policy-ui.png`](../../docs/design/poly-policy-ui/desired-policy-ui.png)

Reference current state:

- [`docs/design/poly-policy-ui/current-money-desktop.png`](../../docs/design/poly-policy-ui/current-money-desktop.png) — desktop Money page (no policy row today)
- [`docs/design/poly-policy-ui/current-money-mobile.png`](../../docs/design/poly-policy-ui/current-money-mobile.png) — mobile Trading wallet tab

Visual target (verbatim from sketch, expressed in our existing kit):

```
TRADING WALLET                         0x9A9e…160A  ⧉
  USDC.E 16.52        POL 124.7385
  ✓ Trading enabled  · Approvals signed in-app

  POLICY                                            edit
  Per trade   $5.00       Per day  $50.00
  ─────────────────────────────────────────
  → Next — pick a wallet to copy on Research
  Fund                Withdraw
```

Per-target view (Research wallet detail, when copy-trade active):

```
COPY TRADE
  ✓ Active                                          toggle
  Per trade  $5.00       Per day  $50.00
  Edit on Money →
```

## Validation

### exercise

- **Unit:** `pnpm test nodes/poly/app/src/components/kit/wallet/PolicyControls.test.tsx` — render in both modes, save calls `onSave` with parsed numbers.
- **Component:** `pnpm test:component grants-editor` — full Money-page card mount with React Query, save → mutation hits PUT, refetch shows new values.
- **Stack:** existing wallet-onboarding stack tests pass unchanged. Add one case: a fresh tenant's grant row reads back `per_order_usdc_cap=5, daily_usdc_cap=50` (the new default — confirms `provisionWithGrant` defaults match the UI's initial state).
- **Candidate-a:** load https://poly-test.cognidao.org/credits, the Trading wallet card shows my actual cap values; click edit, change `per_order` to $7, save, then trigger a mirror tick — observe an order placed at the new ceiling on a market with `minUsdcNotional ≤ 7`.

### observability

- Pino log line `poly.wallet.grants.read` (route_id) and `poly.wallet.grants.write` with `billing_account_id`, `delta` (which fields changed, NOT the values).
- Loki query at the deployed SHA: `{namespace="cogni-candidate-a"} |= "poly.wallet.grants.write"` returns my own edit.
- Existing `poly.authorize.outcome` already logs `intent_usdc` + `reason` — verifies the cap edit took effect.

## Risks

- **Stale grant value visible in UI.** React Query default `staleTime` is 0; on save we invalidate. Mostly fine, but if multiple tabs are open one tab won't see the other's edit until refetch. Acceptable v1.
- **CHECK constraint violations server-side** despite Zod. Belt-and-suspenders: route catches PG error code `23514` and returns a 422 with the specific constraint name in the response body so the UI can show "daily must be ≥ per-trade".
- **Ledger pollution still real.** Editing the cap doesn't retroactively clean up the 4,246 `placement_failed` rows on candidate-a from task.0404 validation. Separate bug: filter out `error`-status fills from the daily-sum query (already excluded — confirmed in validation; status filter holds).

## Review Checklist

- [ ] **Work Item:** `task.0347` linked in PR body
- [ ] **Spec:** `CAPS_LIVE_IN_GRANT` + `TENANT_ISOLATION` upheld
- [ ] **Tests:** unit + component + one stack case
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
