---
id: task.0259
type: task
title: "Unified rounded UI theming — buttons, cards, dialogs across all nodes"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Audit and update all interactive UI surfaces (buttons, cards, dialogs, badges, inputs) to use rounded borders with primary-color accents. The Connect/Sign-in button was updated as the reference — now align everything else."
outcome: "Consistent rounded, primary-accented UI across operator + all nodes. No more mixed sharp/round border styles."
spec_refs: []
assignees: derekg1729
credit:
project: proj.operator-plane
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [ui, theming, nodes]
external_refs: []
---

# Unified rounded UI theming

## Requirements

The Connect button was updated to `rounded-full border-primary/40 bg-primary/10`
as the reference style. All other interactive surfaces should follow.

### Components to audit and update

**Buttons (shadcn `button.tsx` variants):**

- `default` variant — should use rounded + primary styling
- `outline` variant — rounded borders
- `secondary`, `ghost` — rounded
- Sign-in dialog buttons (Ethereum Wallet, GitHub) — rounded + primary accent

**Cards:**

- Treasury badge — match rounded style
- Sidebar menu items — active state border radius
- Chat suggestion cards — rounded borders

**Dialogs:**

- SignInDialog — rounded card borders, rounded buttons inside
- Any modal/popover — consistent border radius

**Inputs:**

- Chat composer textarea — rounded borders
- Select/dropdown triggers — rounded

### Global approach

The `--radius` CSS variable was bumped from `0.5rem` to `0.75rem`. This helps
but many components use hardcoded `rounded-lg` or `rounded-md` classes that
don't reference `--radius`. The fix is:

1. Audit all `rounded-*` classes in the component library (`src/components/`)
2. Update to use `rounded-xl` or `rounded-2xl` where appropriate
3. Update button variants in `button.tsx` to use rounded + primary accent
4. Update card component base styling
5. Verify SignInDialog buttons get the rounded primary treatment

### Chat suggested messages

Each node should customize the chat welcome suggestions to its domain:

- Operator: generic Cogni prompts (current)
- Poly: prediction market prompts ("What markets are trending?")
- Resy: reservation prompts ("Find me a table at...")

File: `src/features/ai/components/ChatComposerExtras.tsx` per node.

## Allowed Changes

- `apps/operator/src/components/vendor/shadcn/button.tsx` — variant updates
- `apps/operator/src/components/vendor/shadcn/card.tsx` — border radius
- `apps/operator/src/components/kit/auth/SignInDialog.tsx` — button styling
- `apps/operator/src/styles/tailwind.css` — CSS variables
- `nodes/*/app/src/` — propagate changes to all nodes
- `nodes/*/app/src/features/ai/components/ChatComposerExtras.tsx` — per-node suggestions

## Validation

- [ ] All buttons use rounded borders across operator + nodes
- [ ] SignInDialog buttons have rounded + primary accent
- [ ] Cards and badges have consistent border radius
- [ ] Chat suggestions are customized per node
- [ ] `pnpm typecheck` + `pnpm typecheck:poly` + `pnpm typecheck:resy` pass
