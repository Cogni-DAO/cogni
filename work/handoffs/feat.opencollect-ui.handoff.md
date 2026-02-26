---
id: "feat.opencollect-ui.handoff"
type: handoff
work_item_id: "feat.opencollect-ui"
status: active
created: 2026-02-25
updated: 2026-02-25
branch: "feat/opencollect-ui"
last_commit: "5fd03538"
---

# Handoff: Sidebar Navigation + Mobile UI Polish

## Context

- Adopting a left-side vertical sidebar (like OpenCollective/ChatGPT) for authenticated `(app)` pages
- Public pages keep `AppHeader` + `AppFooter`; authenticated pages get `AppSidebar` + `AppTopBar`
- Chat threads are always visible in the sidebar as a collapsible menu item (like OC's "Settings" pattern) — threads fetch independently via `useThreads`, not gated to the chat page
- Mobile views improved: model/agent picker dialogs render as compact cards with margins (not full-screen), work table hides non-essential columns, filters use 2-column grid
- OpenCollective frontend (`/Users/derek/dev/opencollective-frontend/`) is the reference codebase for UI patterns — sidebar, table responsiveness, collapsible menus, drawer details

## Current State

- **Build passes** (`pnpm build` — zero type errors)
- **Lint passes** (`pnpm lint:fix` — zero errors, zero warnings after biome-ignore on vendor cookie)
- **`check:docs` passes**
- **Auth guard test**: `tests/unit/app/app-layout-auth-guard.test.tsx` has mocks added but may need verification
- **3 unstaged files** with partial fixes: `AuthRedirect.tsx`, `(public)/page.tsx` (doc header fixes), `app-layout-auth-guard.test.tsx`
- **Visual regression: flashy redirect on logo click** — clicking Cogni logo → `/` → public layout flashes → `AuthRedirect` fires → navigates to `/chat`. See Risks.

## Decisions Made

- **Zustand store** bridges chat thread state (active key, callbacks) from `chat/page.tsx` to sidebar. Thread _list_ is fetched directly by the sidebar via `useThreads` hook — no dependency on chat page mount.
- **Collapsible threads** use plain React state + conditional render (no Radix Collapsible installed). `SidebarMenuSub`/`SidebarMenuSubButton` for sub-items match OC's pattern.
- **Threads positioned last** in nav so expansion scrolls within `SidebarContent` (has `overflow-auto`), not past the GitHub/Discord footer.
- **Model/agent picker dialogs**: mobile = centered card with `inset-3` margins + `--max-height-dialog-mobile: 70vh` token; desktop = centered modal. Native `overflow-y-auto` replaces Radix ScrollArea for reliable scroll.
- **Work table**: edge-to-edge on mobile (`-mx-4 border-t border-b`), rounded on `md+`. Est/ID/Updated/Branch columns hidden on mobile via `hidden md:table-cell`.
- **`sidebar_state` cookie**: vendor sidebar persists open/collapsed via `document.cookie` — suppressed with `biome-ignore` comment.

## Next Actions

- [ ] **More mobile UI polish** — continue reviewing pages at 360px; chat composer area, gov page, activity page may need attention
- [ ] **Fix the flashy redirect on logo click** — options: (a) logo links to `/chat` in sidebar, (b) Next.js middleware redirect, (c) loading gate
- [ ] **Consider Radix Collapsible** for animated open/close on threads (currently instant show/hide). Install `@radix-ui/react-collapsible` if animation is desired.
- [ ] **Thread deep links** — clicking a thread from non-chat pages navigates to `/chat?thread={stateKey}`, but the chat page doesn't yet read the `thread` query param on mount
- [ ] **Commit the 3 unstaged files** once verified
- [ ] **Verify mobile sidebar** — opens as Sheet at <768px from SidebarTrigger
- [ ] **Verify sidebar collapse** — icon-only mode via rail/trigger
- [ ] **Run `pnpm check`** — full validation before PR
- [ ] **Open PR to staging**

## Risks / Gotchas

- **Logo redirect flash** is the most user-visible regression. Two-layout architecture means cross-layout navigation briefly shows the wrong shell. Next.js middleware may be cleanest fix.
- **`exactOptionalPropertyTypes: true`** — optional props must include `| undefined`. Previously bit with `ThreadSummary.title`.
- **Chat Zustand store** registers/unregisters on mount/unmount — thread callbacks are null when off `/chat`. Sidebar handles this by falling back to direct `useDeleteThread` mutation and `<Link>` navigation.
- **Thread `?thread=` param not wired** — sidebar generates these links for off-page navigation but chat page doesn't consume the param yet.

## Pointers

| File / Resource                                               | Why it matters                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/Users/derek/dev/opencollective-frontend/`                   | Reference codebase for all UI patterns (sidebar, tables, collapsible menus, drawers) |
| `src/features/layout/components/AppSidebar.tsx`               | Cogni sidebar — nav items + collapsible ChatThreadsSidebarGroup                      |
| `src/features/ai/chat/components/ChatThreadsSidebarGroup.tsx` | Collapsible threads menu item — fetches via useThreads, renders SidebarMenuSub       |
| `src/features/ai/chat/components/ChatSidebarContext.tsx`      | Zustand store bridging active thread key + callbacks to sidebar                      |
| `src/features/ai/components/ModelPicker.tsx`                  | Model picker dialog — mobile card + scroll fix                                       |
| `src/features/ai/components/GraphPicker.tsx`                  | Agent picker dialog — same pattern as ModelPicker                                    |
| `src/app/(app)/work/view.tsx`                                 | Work table — responsive columns, edge-to-edge mobile, filter grid                    |
| `src/app/(app)/layout.tsx`                                    | Wires SidebarProvider + AppSidebar + SidebarInset + AppTopBar                        |
| `src/app/(public)/layout.tsx`                                 | Wires AppHeader + AppFooter for public pages                                         |
| `src/components/vendor/shadcn/sidebar.tsx`                    | Vendor sidebar primitives (adapted from OC)                                          |
| `src/styles/tailwind.css`                                     | Sidebar tokens, `--max-height-dialog-mobile`, `--app-header-h`                       |
| `scripts/eslint/plugins/ui-governance.cjs`                    | ESLint token allowlist (sidebar-\* tokens added)                                     |
| `work/handoffs/archive/feat.opencollect-ui/`                  | Previous handoff versions                                                            |
