---
id: task.0365
type: task
title: "Poly onboarding UX polish (v0.1) — Money page layout, funding tip, approval-state design"
status: needs_design
priority: 1
rank: 2
estimate: 3
created: 2026-04-24
updated: 2026-04-24
summary: "Follow-up polish after task.0361's first-user onboarding flow shipped. The flow is now functionally continuous, but Derek's own walkthrough on candidate-a flagged real UX issues: the two-column Money page layout crams the wallet panel (text wraps awkwardly, Enable Trading button feels tight), there is no prominent 'send 1 POL to this address' tip for users new to Polygon, and the post-approval 'Trading enabled' row + Polymarket 6-approval checklist are not visually polished. Separately, the first `pnpm test` pass at root shows a `mcp-real-server.test.ts` bootstrap fragility that bit the initial QA loop — not strictly in scope but worth flagging."
outcome: "A non-technical aspiring user lands on /credits, sees a single column that reads top-to-bottom (balance + prominent fund tip → Enable Trading → Next step), and never thinks 'this looks broken'. Includes a tested 'Send 1 POL on Polygon' funding affordance with a one-click address copy. Passes Derek's manual walkthrough with zero 'ugly' or 'formatting' feedback."
spec_refs: []
assignees: []
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0361]
labels: [poly, onboarding, ui, polish, frontend-design]
---

# task.0365 — Poly onboarding UX polish (v0.1)

## Context

task.0361 shipped the _flow_ (wallet create on /credits, dashboard nudges, /research follow). Derek walked it on candidate-a at `c1a8219f6`; the flow is continuous but the **visual and copy polish is noticeably lacking** on the Money page. This task lifts the flow from "works" to "doesn't look broken for a non-technical user".

## Problem (from Derek's walkthrough, 2026-04-24)

- **Money page two-column layout** cramps the trading-wallet panel; "Authorize trading" button crowds against "Enable trading" label, text wraps mid-word.
- **No prominent funding tip.** The Polygon Portal bridge link exists but a new user has no obvious "send 1 POL to this exact address" affordance. Most aspiring users have never bridged to Polygon.
- **"Authorize trading" step** (task.0355's existing section) looks crowded inside the narrow right column; button + label compete for the same vertical space.
- **Post-approval 6-checkmark Polymarket approvals list** lacks hierarchy — reads as a wall of hex addresses.
- **Compact "Trading enabled · Approvals signed in-app" row** looks disconnected from the balances above it.
- **No onboarding tips elsewhere** (no coachmark, no progress dots, no "Step 2 of 4" breadcrumb). A new user has no sense of where they are in the flow.

## Scope

**In (/frontend-design pass on `/credits` TradingWalletPanel):**

- **Single-column layout on narrow viewports**, or reflow the two-column grid at a wider breakpoint so the wallet card is never narrower than ~480px.
- **Prominent Funding tip card**: headline "Send ~1 POL + USDC.e on Polygon to this address" with the funder address in a one-click copy pill + Polygon Portal link. Always visible while `trading_ready=false`.
- **Redesign Authorize trading block**: button + label stacked, not side-by-side; approval checklist becomes a compact "6/6 signed" chip with a "Show approvals" expander (or a simple "✓ All 6 approvals on-chain" summary with tx links).
- **Balances + readiness unified**: the "Trading enabled" confirmation visually continues the balance grid (shared container, shared rhythm), not a detached badge.
- **One-line progress breadcrumb at the top of /credits**: `● Create wallet → ● Fund → ○ Enable trading → ○ Pick a wallet`. Derived from wallet state only (STATE_DRIVEN_UI, same as task.0361).

**Out of scope:**

- Redesigning `/research` or `/dashboard` visual language.
- New API routes / port methods / DB columns.
- Reusable onboarding primitives for other nodes.
- Replacing `TradingReadinessSection` internals (task.0355 owns that section).

## Validation

- `exercise`: Derek re-walks the same flow (same sequence as task.0361's walkthrough) on candidate-a. No "ugly / poor formatting / missing tip" call-outs.
- `observability`: none new; this is a UX pass.

## Execution notes

1. Use `/frontend-design` skill with `ui-ux-pro-max` for the `/credits` layout + funding tip. Keep poly-specific (task.0361 charter).
2. Keep the new `OnboardingCta` helper in `dashboard/_components/TradingWalletCard.tsx` (extracted in task.0361 follow-up) — promote to a shared `_components/` location if the same treatment is used on /credits.
3. The "Send 1 POL + USDC.e" tip should live _inside_ `TradingWalletPanel` when `trading_ready=false`, not as a separate toast/coachmark — persistent, not ephemeral.
4. Prefer shadcn primitives + Tailwind over custom components. No new design system tokens.

## Related

- **task.0361** (merged — wallet creation flow on /credits, dashboard nudges).
- **task.0355** (shipped — owns `TradingReadinessSection`; this task may ask for a compact variant).
- **pre-existing test fragility** — `packages/langgraph-graphs/tests/inproc/mcp-real-server.test.ts` fails at root `pnpm test` on at least one worktree without the proper bootstrap; bootstrap docs may need a follow-up. Not this task's scope; noting for an `/idea` if it bites again.
