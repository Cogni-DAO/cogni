---
id: handoff.task.0043
type: handoff
work_item_id: task.0043
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/task-0040-ai-sdk-streaming
last_commit: 3b7ad0d8
---

# Handoff: Wire Fumadocs docs site

## Context

- Cogni has 266 markdown files across `/docs` (specs, guides, research, postmortems) and `/work` (projects, items, handoffs) with strict YAML frontmatter validated by CI
- The website is a Next.js 16 App Router app (chat, credits, DAO) — zero docs rendering infrastructure exists today
- Goal: render all docs as a public, searchable site at `/docs/*` using Fumadocs (OSS), coexisting with existing routes
- Future direction: agents push doc edits to git branches → CI preview deploys show those docs; eventually in-app branch switching

## Current State

- Spec written and reviewed: `docs/spec/docs-site.md` (draft, with feedback incorporated)
- Project roadmap rewritten: `work/projects/proj.docs-system-infrastructure.md` (MkDocs replaced with Fumadocs)
- Task created: `work/items/task.0043.fumadocs-docs-site.md` (status: Todo)
- No code written yet — this is a planning-complete handoff

## Decisions Made

- **Fumadocs over MkDocs**: renders inside existing Next.js app, no separate pipeline — see [docs-site spec Design Notes](../../docs/spec/docs-site.md)
- **Public routes (no auth)**: `(docs)` route group sits alongside `(public)`, enables static generation + SEO — invariant `DOCS_ARE_PUBLIC`
- **Single unified source**: one `loader()` with `multiple()`, not separate loaders — invariant `SINGLE_UNIFIED_SOURCE`
- **summary→description mapping**: metadata plugin remaps at build time, no markdown file changes — invariant `SUMMARY_TO_DESCRIPTION`
- **Branch preview via CI deploys**: no in-app branch switching or GitHub API loader — explicit Non-Goal

## Next Actions

- [ ] Verify Fumadocs supports Next.js 16 + React 19.2 (check changelog/issues, try `pnpm add`)
- [ ] Install `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` with pinned versions
- [ ] Create `src/lib/docs-source.ts` — unified source via `multiple()` + `summary→description` metadata plugin
- [ ] Create `src/app/(docs)/layout.tsx` — Fumadocs DocsLayout with sidebar
- [ ] Create `src/app/(docs)/[...slug]/page.tsx` — catch-all page renderer
- [ ] Configure exclusions: `_templates/`, `archive/`, `_index.md`
- [ ] Wire Fumadocs Tailwind plugin if required by fumadocs-ui
- [ ] Manual verify: `/docs/spec/architecture` renders, search works, `/chat` unaffected
- [ ] `pnpm build && pnpm check` passes

## Risks / Gotchas

- Fumadocs may not yet support Next.js 16 — check peer deps before installing; if blocked, this is a hard blocker
- The wikilink validator flags `[[...slug]]` in markdown — use `[...slug]` in docs (already handled in spec)
- Frontmatter uses `summary` not `description` — Fumadocs search/sidebar will show empty descriptions without the metadata plugin
- Pre-commit hook runs `check:docs` against all files, not just staged — pre-existing failures may block commits (tracked as bug.0012)

## Pointers

| File / Resource                                    | Why it matters                                          |
| -------------------------------------------------- | ------------------------------------------------------- |
| `docs/spec/docs-site.md`                           | Spec: invariants, data flow, content source design      |
| `work/items/task.0043.fumadocs-docs-site.md`       | Task: requirements, plan, validation commands           |
| `work/projects/proj.docs-system-infrastructure.md` | Project: P1 Walk phase = this task                      |
| `docs/spec/docs-work-system.md`                    | Frontmatter schema for both /docs and /work             |
| `src/app/layout.tsx`                               | Root layout — shared by (public), (app), and new (docs) |
| `next.config.ts`                                   | May need MDX plugin config for Fumadocs                 |
| `scripts/validate-docs-metadata.mjs`               | CI validator — must still pass after Fumadocs wiring    |
