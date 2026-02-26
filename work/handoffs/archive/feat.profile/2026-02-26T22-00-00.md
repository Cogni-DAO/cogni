---
id: "feat.profile.handoff"
type: handoff
work_item_id: "feat.profile"
status: active
created: 2026-02-25
updated: 2026-02-25
branch: "feat/profile"
last_commit: "7c306d6e"
---

# Handoff: Frontend Profile & UI Polish

## Context

- Continuing frontend polish started in `feat/opencollect-ui` (merged as #482 to staging)
- Branch created off latest staging which includes sidebar layout, OC-inspired tables, mobile-first charts, and profile backend (user API, avatar menu, profile page scaffolding)
- Goal: finish UI tweaks — footer improvements, profile page polish, and remaining mobile refinements
- Reference UI: OpenCollective frontend at `/Users/derek/dev/opencollective-frontend/`

## Current State

- **Footer partially updated** (uncommitted): background color changed to `bg-muted/40`, bottom bar restructured for full-width social icons, brand SVGs for GitHub/Discord added — but import path needs verification (`.ts` → `.tsx` rename)
- **Profile page exists** (`src/app/(app)/profile/page.tsx`) from staging but has 2 pre-existing lint errors (inline styles, ring token)
- **UserAvatarMenu** component added from staging (dropdown in AppTopBar)
- **All sidebar/table/chart/mobile work from #482** is in staging and merged into this branch
- Build status unknown — footer changes are uncommitted and may have import issues from the `.ts` → `.tsx` rename

## Decisions Made

- Footer uses `bg-muted/40` for subtle background differentiation (not full `bg-muted`)
- Social icons use proper brand SVGs (GitHub octocat, Discord logo) instead of Lucide generic icons
- Footer bottom bar (copyright + social icons) extends full viewport width with its own `border-t`, while link columns stay within `max-w-7xl`
- `footer-items.ts` renamed to `footer-items.tsx` to support JSX icon components
- Icon type changed from `LucideIcon` to `ComponentType<{ className?: string }>` for flexibility

## Next Actions

- [ ] **Fix footer import** — verify `footer-items.tsx` import works (may need to drop `.tsx` extension from import path)
- [ ] **Lint the footer** — run `pnpm lint:fix` and fix any class sorting or token issues
- [ ] **Commit footer changes** — stage AppFooter.tsx, footer-items.tsx, and the deleted footer-items.ts
- [ ] **Fix profile page lint errors** — inline styles and ring token issues in `profile/page.tsx`
- [ ] **Review profile page UI** — check mobile appearance, ensure consistent padding/margins with other (app) pages
- [ ] **Additional mobile polish** — check chat composer area, gov sub-pages at 360px
- [ ] **Fix logo redirect flash** — clicking Cogni logo → `/` → public layout flashes → redirects to `/chat` (from #482 known issue)
- [ ] **Run `pnpm check`** before PR

## Risks / Gotchas

- **`footer-items.ts` → `.tsx` rename**: git mv was done but the import in AppFooter.tsx uses `./footer-items.tsx` (explicit extension) — Next.js/TypeScript usually wants extensionless imports
- **Pre-existing lint errors** in `profile/page.tsx` are from staging, not this branch's changes
- **Logo redirect flash** remains from the sidebar work — two-layout architecture means cross-layout nav briefly shows wrong shell
- **`exactOptionalPropertyTypes: true`** — optional props must include `| undefined`

## Pointers

| File / Resource                                     | Why it matters                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/features/layout/components/AppFooter.tsx`      | Footer component — partially updated, needs commit                             |
| `src/features/layout/components/footer-items.tsx`   | Footer data + brand SVG icons (renamed from .ts)                               |
| `src/app/(app)/profile/page.tsx`                    | Profile page — has pre-existing lint errors to fix                             |
| `src/features/layout/components/UserAvatarMenu.tsx` | User avatar dropdown in AppTopBar (from staging)                               |
| `src/features/layout/components/AppSidebar.tsx`     | Sidebar — has duplicate DiscordIcon SVG that could be shared with footer-items |
| `src/features/layout/components/AppTopBar.tsx`      | Top bar with avatar menu wired in                                              |
| `/Users/derek/dev/opencollective-frontend/`         | Reference codebase for UI patterns                                             |
| `work/handoffs/feat.opencollect-ui.handoff.md`      | Previous handoff covering sidebar + table work                                 |
