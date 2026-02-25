---
id: "feat.opencollect-ui.handoff"
type: handoff
work_item_id: "feat.opencollect-ui"
status: active
created: 2026-02-25
updated: 2026-02-25
branch: "feat/opencollect-ui"
last_commit: "e9e7df1c"
---

# Handoff: Sidebar Navigation + Header Reorganization

## Context

- Adopting a left-side vertical sidebar (like OpenCollective / ChatGPT) for authenticated `(app)` pages
- Homepage and public pages keep the existing full-width horizontal `AppHeader`
- Sidebar component copied from OpenCollective's `Sidebar.tsx` and adapted to our import conventions
- Chat thread history (previously an inline `<aside>` + `<Sheet>` in the chat page) moves into the global sidebar as a collapsible group
- A new `AppTopBar` replaces the header for app pages (sidebar trigger + treasury badge + socials + wallet + theme)

## Current State

- **Build passes** (`pnpm build` — zero type errors, all pages compile)
- **Lint has 6 ESLint errors remaining** (see Next Actions)
- **Unit tests, check:docs not yet verified** — may have regressions
- **Visual regressions observed** — chat page infinite scrolling, awkward layout in activity/gov pages (not investigated yet)
- All 8 implementation phases are code-complete (CSS tokens, vendor components, AppSidebar, AppTopBar, layout rewiring, chat sidebar migration, AppFooter, barrel exports)
- No commits made yet — all changes are unstaged on the branch

## Decisions Made

- **Zustand store** bridges chat thread state from `chat/page.tsx` to `AppSidebar.tsx` (can't use React context because sidebar is a sibling of the content tree, not an ancestor)
- **`ThreadSummary`** type imported from `@/contracts/ai.threads.v1.contract` — follows project's "contracts are source of truth" rule
- **`chat-viewport` CSS class removed** — the old `calc(100dvh - var(--app-header-h))` approach replaced with `flex flex-1 overflow-hidden` since the chat area is now inside `SidebarInset`
- **`--app-header-h` CSS var** still exists in `tailwind.css` (not removed) — may be used elsewhere; verify before deleting
- Sidebar uses `collapsible="icon"` mode (collapses to icon-only strip, not offcanvas)

## Next Actions

- [ ] **Fix 3 `no-restricted-imports` ESLint errors**: `AppSidebar.tsx`, `AppTopBar.tsx`, and `ChatThreadsSidebarGroup.tsx` import `@/components/vendor/shadcn/sidebar` directly — must import through `@/components` barrel instead
- [ ] **Fix 2 `ui-governance/token-classname-patterns` errors**: `ChatThreadsSidebarGroup.tsx` uses `bg-sidebar-accent` / `hover:bg-sidebar-accent` — either add sidebar tokens to the ESLint allowlist or replace with `bg-accent` equivalents
- [ ] **Fix 1 Biome warning**: `noDocumentCookie` in `sidebar.tsx` line 80 — consider suppressing with `// biome-ignore` for vendor code
- [ ] **Fix chat page infinite scrolling** — likely the flex/overflow chain changed when the inline sidebar was removed; the chat area `div` may need height constraints
- [ ] **Fix activity/gov page layout** — these pages may assume full-width without a sidebar; check their padding/max-width
- [ ] **Run `pnpm test` and `pnpm check:docs`** — fix any regressions
- [ ] **Verify mobile behavior** — sidebar should open as Sheet from trigger; test at <768px
- [ ] **Verify sidebar collapse** — click rail/trigger to toggle icon-only mode
- [ ] **Consider: remove MobileNav from AppHeader** — nav links now live in sidebar for app pages; public AppHeader still has them which is correct, but MobileNav overlap may be confusing
- [ ] **Commit and open PR**

## Risks / Gotchas

- The `SidebarInset` component renders a `<main>` tag, and root layout also has `<main id="main">` — this produces nested `<main>` elements (HTML validation issue). May need to change one to `<div>`.
- Chat Zustand store (`useChatSidebarStore`) registers callbacks on mount and unregisters on unmount — if the chat page unmounts before sidebar reads, thread group may flash empty. Test navigation away from `/chat`.
- The `exactOptionalPropertyTypes: true` tsconfig setting means optional props must explicitly include `| undefined` — this bit us once already with `ThreadSummary.title`.
- `SidebarProvider` sets a cookie (`sidebar_state`) for persistence — Biome warns about `document.cookie`. OC does the same; acceptable for vendor code but may want a `// biome-ignore` directive.
- The footer renders `new Date().getFullYear()` at build time for static pages — this is fine for SSR but will show build-year for ISR/static pages.

## Pointers

| File / Resource                                               | Why it matters                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/vendor/shadcn/sidebar.tsx`                    | Core sidebar component (adapted from OC) — all sub-components exported here             |
| `src/features/layout/components/AppSidebar.tsx`               | Cogni-specific sidebar composition — nav items, chat threads group                      |
| `src/features/layout/components/AppTopBar.tsx`                | Top bar for app pages — replaces AppHeader in (app) routes                              |
| `src/features/ai/chat/components/ChatSidebarContext.tsx`      | Zustand store bridging chat page thread state to AppSidebar                             |
| `src/features/ai/chat/components/ChatThreadsSidebarGroup.tsx` | Thread list rendered as a SidebarGroup                                                  |
| `src/app/(app)/layout.tsx`                                    | Wires SidebarProvider + AppSidebar + SidebarInset + AppTopBar                           |
| `src/app/(public)/layout.tsx`                                 | Wires AppHeader + AppFooter for public pages                                            |
| `src/app/layout.tsx`                                          | Root layout — AppHeader removed (now in public layout)                                  |
| `src/styles/tailwind.css`                                     | Sidebar CSS tokens added to `@theme`, `:root`, `.dark`                                  |
| `src/contracts/ai.threads.v1.contract.ts`                     | Source of truth for `ThreadSummary` type used by chat sidebar                           |
| `.eslintrc.cjs` (or equivalent)                               | Contains `no-restricted-imports` and `token-classname-patterns` rules that need updates |
