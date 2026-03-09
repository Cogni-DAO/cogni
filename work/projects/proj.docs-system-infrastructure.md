---
id: proj.docs-system-infrastructure
type: project
primary_charter:
title: Docs + Work System Infrastructure
state: Active
priority: 0
estimate: 4
summary: CI-validated docs system with Fumadocs publishing inside the existing Next.js app
outcome: Searchable docs site at /docs/* rendering all /docs and /work markdown, CI enforcement of structure, branch preview via deploys
assignees: derekg1729
created: 2026-02-06
updated: 2026-02-13
labels: [docs, infra, tooling]
---

# Docs + Work System Infrastructure

## Goal

Build the tooling infrastructure that enforces and publishes our docs + work system:

- CI gates that validate docs structure and frontmatter
- Fumadocs-powered docs site within the existing Next.js app (replaces MkDocs plan)
- Branch preview via standard CI preview deployments (agent pushes → preview URL)
- Future: in-app branch switching, Plane as canonical work tracker

## Roadmap

### Crawl (P0) — Validator + CI Gates

**Goal:** Standardize identifiers, headings, and enforceability before publishing anything.

| Deliverable                                                        | Status      | Est | Work Item |
| ------------------------------------------------------------------ | ----------- | --- | --------- |
| Templates finalized (spec, project, charter, item)                 | Done        | 1   | task.0001 |
| Classify all 97 legacy docs                                        | Done        | 2   | task.0001 |
| Migrate legacy docs to typed directories                           | Not Started | 4   | task.0001 |
| CI check: required frontmatter props                               | Done        | 1   | task.0001 |
| CI check: IDs unique + type↔dir match                             | Done        | 1   | task.0001 |
| CI check: `spec_state` validation                                  | Not Started | 1   | —         |
| CI check: stable headings for specs                                | Done        | 1   | —         |
| Migrate all specs to new template (design-first, table invariants) | Not Started | 3   | —         |
| Harden validator: enforce new spec heading order                   | Not Started | 1   | —         |

### Walk (P1) — Fumadocs Integration

**Goal:** Ship a searchable docs site at `/docs/*` that renders all `/docs` and `/work` markdown within the existing Next.js app.

| Deliverable                                              | Status      | Est | Work Item      |
| -------------------------------------------------------- | ----------- | --- | -------------- |
| Install fumadocs-core, fumadocs-ui, fumadocs-mdx         | Not Started | 1   | task.0043      |
| Content source config mapping /docs and /work trees      | Not Started | 1   | task.0043      |
| `(docs)` route group with DocsLayout + catch-all page    | Not Started | 1   | task.0043      |
| Sidebar generation from directory hierarchy              | Not Started | 1   | task.0043      |
| Flexsearch integration (built-in, no external deps)      | Not Started | 1   | task.0043      |
| Exclude `_templates/`, `archive/`, `_index.md` from site | Not Started | 0   | task.0043      |
| Link checking (`lychee`)                                 | Not Started | 1   | (P1 follow-up) |
| Verify Next.js 16 compatibility with Fumadocs            | Not Started | 0   | task.0043      |

**Why Fumadocs over MkDocs:**

- Renders inside existing Next.js App Router — no separate build pipeline or subdomain
- Reads plain markdown with YAML frontmatter as-is — zero migration
- Ships Flexsearch, sidebar, TOC, breadcrumbs, dark mode OOTB
- Content source is a pluggable seam — filesystem now, git API later

### Run (P2) — Branch Preview + Polish

**Goal:** Agent-pushed branches produce preview docs; frontmatter metadata rendered as visual affordances.

| Deliverable                                          | Status      | Est | Work Item            |
| ---------------------------------------------------- | ----------- | --- | -------------------- |
| CI preview deploy builds docs from branch filesystem | Not Started | 1   | (create at P2 start) |
| Status/trust/priority badges from frontmatter        | Not Started | 2   | (create at P2 start) |
| Cross-reference rendering (clickable spec_refs)      | Not Started | 2   | (create at P2 start) |
| Filtered views (all active specs, in-progress tasks) | Not Started | 2   | (create at P2 start) |
| PR reference format + CI gate on PR body             | Not Started | 2   | (create at P2 start) |

### Sprint (P3) — In-App Branch Switching + Plane

**Goal:** Users switch between git branches in the docs UI; Plane replaces `/work` markdown.

| Deliverable                                              | Status      | Est | Work Item            |
| -------------------------------------------------------- | ----------- | --- | -------------------- |
| GitHub API content source (swap filesystem for git API)  | Not Started | 3   | (create at P3 start) |
| Branch picker UI component                               | Not Started | 2   | (create at P3 start) |
| Plane GitHub integration (PR merge → issue state update) | Not Started | 2   | (create at P3 start) |
| `/work` becomes Plane export-only                        | Not Started | 1   | (create at P3 start) |
| Plane MCP server for agent CRUD                          | Not Started | 3   | (create at P3 start) |

## CI Enforcement

### P0 Checks (Current)

| Check                                              | Script                               | Failure Mode  |
| -------------------------------------------------- | ------------------------------------ | ------------- |
| Required YAML frontmatter properties               | `scripts/validate-docs-metadata.mjs` | Merge blocked |
| Stable headings (Design/Goal/Non-Goals/Invariants) | `scripts/validate-docs-metadata.mjs` | Merge blocked |
| Unique `id` values                                 | Existing validator                   | Merge blocked |
| Valid arrays in tags/labels fields                 | Existing validator                   | Merge blocked |

### P2 Checks (Planned)

| Check                             | Implementation                | Failure Mode  |
| --------------------------------- | ----------------------------- | ------------- |
| PR body contains Spec + Work Item | GitHub Action parsing PR body | Merge blocked |
| Link checking                     | `lychee` CI step              | Merge blocked |

## Constraints

- Zero changes to existing markdown files — Fumadocs must render them as-is
- Docs routes must coexist with `(app)` and `(public)` route groups
- No external search dependencies (Algolia, Typesense, etc.)
- Content source must be isolated and swappable (filesystem → git API)

## Dependencies

- [x] `yaml` package for YAML parsing in validator
- [ ] `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` npm packages (P1)
- [ ] Next.js 16 compatibility verification (P1)
- [ ] GitHub Action for PR body validation (P2)
- [ ] Plane workspace setup (P3)

## As-Built Specs

- [docs-work-system.md](../../docs/spec/docs-work-system.md) — document taxonomy and conventions
- [docs-site.md](../../docs/spec/docs-site.md) — Fumadocs integration design (draft)

## Design Notes

**MkDocs → Fumadocs decision (2026-02-13):**

MkDocs was the original plan for docs publishing. Fumadocs replaces it because:

- MkDocs requires a separate Python build pipeline and subdomain/deployment
- Fumadocs renders natively inside the existing Next.js App Router
- Fumadocs reads the exact markdown + YAML frontmatter format we already use
- The content source abstraction makes future branch switching a loader swap, not a rewrite

**Branch preview strategy:**

Build-time filesystem source means every branch gets its own docs via CI preview deploys. This is the zero-code path for agent-pushed doc previews. In-app branch switching (P3) swaps the content loader from filesystem to GitHub API with a `ref` param — rendering layer stays identical.

**Open questions:**

- Should the docs site be public or behind auth?
- Which `/work` subdirs to render (items + projects? handoffs? charters?)
