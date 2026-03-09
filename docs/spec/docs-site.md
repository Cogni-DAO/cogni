---
id: docs-site
type: spec
title: Docs Site
status: draft
spec_state: draft
trust: draft
summary: Fumadocs-powered docs site rendering /docs and /work markdown within the existing Next.js app
read_when: Adding docs routes, modifying content sources, or understanding how markdown gets rendered on the website
implements: proj.docs-system-infrastructure
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [docs, ui, infra]
---

# Docs Site

> Render the existing `/docs` and `/work` markdown trees as a public, navigable, searchable docs site within the Next.js app — using Fumadocs as the OSS rendering layer.

### Key References

|             |                                                                                           |                                   |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| **Project** | [proj.docs-system-infrastructure](../../work/projects/proj.docs-system-infrastructure.md) | Roadmap and planning              |
| **Spec**    | [Docs + Work System](./docs-work-system.md)                                               | Type taxonomy, frontmatter schema |

## Design

### Data Flow

```
docs/**/*.md ──┐                    summary→description
               ├──▶ source.ts ──▶  metadata plugin  ──▶ /docs/[...slug] ──▶ rendered page
work/**/*.md ──┘    multiple()       (build-time)        (App Router)        (Fumadocs UI)
```

### Route Structure

```
src/app/
├── (public)/          # existing landing page
├── (app)/             # existing protected routes (chat, credits, etc.)
└── (docs)/            # NEW — public docs site (no auth)
    ├── layout.tsx     # Fumadocs DocsLayout (sidebar, search, breadcrumbs)
    └── [...slug]/
        └── page.tsx   # Fumadocs DocsPage (renders any doc by path)
```

The `(docs)` route group is **public** (no auth guard). It uses its own layout (Fumadocs DocsLayout) independent of the `(app)` layout. The root layout (`src/app/layout.tsx`) wraps both, providing shared font, theme, and header.

Public routing enables:

- Static generation and aggressive caching
- SEO indexing (docs are already in a public git repo)
- Zero auth overhead for doc readers

### Content Source

One unified source using `multiple()` to combine both content roots:

```typescript
// src/lib/docs-source.ts
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";

export const source = loader({
  source: createMDXSource(/* combined */),
  // multiple() merges /docs and /work into one tree
  // with top-level sections: specs, guides, research, projects, items, etc.
});
```

A single `source` object is consumed by both the layout (sidebar) and the page (content). No separate loaders.

### Metadata Plugin

Our frontmatter uses `summary`; Fumadocs expects `description` for sidebar items and search results. A loader plugin maps this at build time:

```typescript
// inside source config
{
  // remap summary → description so Fumadocs search/sidebar picks it up
  transformMetadata: (meta) => ({
    ...meta,
    description: meta.summary ?? "",
  }),
}
```

No changes to the markdown files — the mapping is in the source config only.

### Sidebar Generation

Fumadocs auto-generates sidebar structure from directory hierarchy:

```
/docs/spec/*       → "Specs" section
/docs/guides/*     → "Guides" section
/docs/research/*   → "Research" section
/docs/postmortems/* → "Postmortems" section
/work/projects/*   → "Projects" section
/work/items/*      → "Work Items" section
```

`meta.json` files in each directory control ordering and display names. The existing `_templates/` and `archive/` directories are excluded via source config.

### Search

Fumadocs ships Flexsearch integration — full-text search across all content, zero external services. Indexed at build time. The `description` field (mapped from `summary`) feeds search result snippets.

### Version Requirements

| Package         | Min Version    | Reason                            |
| --------------- | -------------- | --------------------------------- |
| `next`          | 16.x           | App Router, RSC, current stack    |
| `react`         | 19.2           | Fumadocs UI peer dependency       |
| `fumadocs-ui`   | pin at install | Must support Next 16 + React 19.2 |
| `fumadocs-core` | pin at install | Core source/loader APIs           |
| `fumadocs-mdx`  | pin at install | MDX compilation plugin            |

Version compatibility must be verified at install time. If Fumadocs does not yet support Next 16, either pin Next or wait for Fumadocs release.

### Branch Preview

The content source reads from the **filesystem at build time**. Branch preview works via standard CI preview deployments:

1. Agent pushes doc changes to a branch
2. CI builds from that branch's filesystem
3. Preview URL renders that branch's docs

No in-app branch switching. No GitHub API loader. Preview deploys are the mechanism.

## Goal

Ship a public, navigable, searchable docs site at `/docs/*` that renders the existing 266 markdown files from `/docs` and `/work` — with zero changes to the markdown files, zero bespoke rendering code, and coexistence with the existing app routes.

## Non-Goals

- In-app git branch switching UI or GitHub API content loader (use preview deploys)
- Custom frontmatter rendering (status badges, cross-reference links) beyond what Fumadocs provides OOTB
- Editing docs through the website (agents edit via git)
- Replacing the existing frontmatter validator or CI pipeline
- Serving docs from a separate application or subdomain
- Auth-gated docs (docs are public; the repo is public)

## Invariants

| Rule                    | Constraint                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| ZERO_MARKDOWN_CHANGES   | Docs site must render existing markdown as-is; no file format migration required            |
| COEXIST_WITH_APP        | `(docs)` route group must not affect `(app)` or `(public)` routes                           |
| DOCS_ARE_PUBLIC         | `(docs)` routes require no authentication; statically generatable and SEO-indexable         |
| SINGLE_UNIFIED_SOURCE   | One `loader()` with `multiple()` — not separate loaders per content root                    |
| SUMMARY_TO_DESCRIPTION  | Frontmatter `summary` mapped to Fumadocs `description` via metadata plugin, not file edits  |
| FILESYSTEM_SOURCE       | Content is read from the repo filesystem at build time, not from a database or API          |
| SEARCH_NO_EXTERNAL_DEPS | Search uses Fumadocs Flexsearch (built-in); no Algolia, Typesense, or external index        |
| EXCLUDE_NON_CONTENT     | `_templates/`, `archive/`, `_index.md` files are excluded from the rendered site            |
| VERSION_FLOOR           | Fumadocs packages must be verified compatible with the project's Next.js and React versions |

### File Pointers

| File                                | Purpose                                                 |
| ----------------------------------- | ------------------------------------------------------- |
| `src/app/(docs)/layout.tsx`         | Fumadocs DocsLayout — sidebar, search, nav              |
| `src/app/(docs)/[...slug]/page.tsx` | Fumadocs DocsPage — catch-all doc renderer              |
| `src/lib/docs-source.ts`            | Unified content source — `multiple()` + metadata plugin |
| `docs/**/meta.json`                 | Sidebar ordering per directory (optional)               |

## Open Questions

- [ ] Should `/work/handoffs/` and `/work/charters/` be rendered, or only `items/` and `projects/`?
- [ ] Does Fumadocs support Next.js 16 + React 19.2 today? (must verify at install time)

## Related

- [Docs + Work System](./docs-work-system.md) — frontmatter schema and type taxonomy
- [UI Implementation](./ui-implementation.md) — kit-first component rules (applies to any custom UI in docs layout)
- [Architecture](./architecture.md) — route group conventions and layer boundaries
