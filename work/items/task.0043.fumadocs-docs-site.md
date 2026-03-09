---
id: task.0043
type: task
title: Wire Fumadocs docs site — render /docs and /work at /docs/*
status: needs_design
priority: 1
estimate: 2
summary: Install Fumadocs, create (docs) route group, content source config, and verify all 266 markdown files render
outcome: Navigable, searchable docs site at /docs/* coexisting with existing (app) and (public) routes
spec_refs: docs-site, docs-work-system-spec
assignees: derekg1729
credit:
project: proj.docs-system-infrastructure
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [docs, ui, infra]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 18
---

# Wire Fumadocs docs site — render /docs and /work at /docs/\*

## Requirements

- Fumadocs renders all markdown from `/docs` and `/work` at website routes under `/docs/*`
- Existing `(app)` and `(public)` route groups are unaffected
- Sidebar auto-generated from directory hierarchy (specs, guides, research, postmortems, projects, items)
- Full-text search via Fumadocs Flexsearch (no external deps)
- `_templates/`, `archive/`, `_index.md` excluded from rendered site
- Zero changes to existing markdown files — YAML frontmatter renders as-is
- Dark mode works (already provided by root ThemeProvider)
- `pnpm check` passes

## Allowed Changes

- `package.json` — add fumadocs-core, fumadocs-ui, fumadocs-mdx deps
- `next.config.ts` — any required Fumadocs config (MDX plugin if needed)
- `src/app/(docs)/` — new route group (layout, catch-all page)
- `src/lib/docs-source.ts` — content source config
- `docs/**/meta.json` — optional sidebar ordering files
- `src/styles/tailwind.css` — Fumadocs Tailwind plugin if needed

## Plan

- [ ] Verify Fumadocs supports Next.js 16 (check docs/changelog, try install)
- [ ] Install `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` (and any peer deps)
- [ ] Create `src/lib/docs-source.ts` — content source mapping `/docs` and `/work` directories
- [ ] Create `src/app/(docs)/layout.tsx` — Fumadocs DocsLayout with sidebar config
- [ ] Create `src/app/(docs)/[...slug]/page.tsx` — catch-all doc page renderer
- [ ] Configure exclusions (`_templates/`, `archive/`, `_index.md`)
- [ ] Wire Fumadocs Tailwind plugin into `tailwind.css` if required
- [ ] Update `next.config.ts` if MDX compilation plugin needed
- [ ] Test: navigate to `/docs/spec/architecture` and verify it renders
- [ ] Test: sidebar shows correct directory groupings
- [ ] Test: search finds content across both /docs and /work trees
- [ ] Run `pnpm check` — ensure no regressions

## Validation

**Command:**

```bash
pnpm build && pnpm check
```

**Expected:** Build succeeds with docs routes. No lint/type errors. Existing routes unaffected.

**Manual:**

1. `pnpm dev` → navigate to `/docs/spec/architecture` — spec renders with sidebar
2. Search for "billing" — results from both docs and work trees
3. Navigate to `/chat` — existing app routes unaffected

## Review Checklist

- [ ] **Work Item:** task.0043 linked in PR body
- [ ] **Spec:** docs-site invariants upheld (ZERO_MARKDOWN_CHANGES, COEXIST_WITH_APP, FILESYSTEM_SOURCE, SEARCH_NO_EXTERNAL_DEPS, EXCLUDE_NON_CONTENT, SOURCE_IS_PLUGGABLE)
- [ ] **Tests:** build passes, manual nav verification
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0043.handoff.md)

## Attribution

-
