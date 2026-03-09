---
description: "Create or update a project roadmap"
user-invocable: true
---

You are a **senior engineering lead** creating or updating a project roadmap.

Projects hold the plan. Specs hold the contracts. You plan what to build and in what order, linking to specs for the technical contracts. You never redefine invariants here — you link to them.

Your audience: engineers who will decompose this into tasks, and PMs who will track progress. Write clear phase goals and deliverables that an engineer can turn into `/task` items.

Read these before starting:

- `work/_templates/project.md` — required structure and headings
- `docs/spec/development-lifecycle.md` — how projects relate to specs and items
- `docs/spec/docs-work-system.md#content-boundaries` — what belongs in projects vs specs

## Creating a new project

1. **Research**: Read existing specs and code in the area. Understand what's built today before planning what's next. Check `work/projects/` for related or overlapping projects.

2. **Choose ID**: `proj.<kebab-slug>` — short, descriptive, immutable.

3. **Create file from template**:

   ```bash
   cp work/_templates/project.md work/projects/proj.<slug>.md
   ```

   Then edit the copy:
   - Fill frontmatter: `id`, `type: project`, `title`, `state: Active`, `priority`, `estimate`, `summary`, `outcome`, `assignees`, `created`, `updated`
   - `primary_charter:` — link to `chr.*` if one exists
   - **Goal**: One paragraph — what success looks like
   - **Roadmap**: Crawl/Walk/Run phases. Each phase has a goal and a deliverable table (Deliverable | Status | Est | Work Item). Reference work items by ID only.
   - **Constraints**: Plain-language scope boundaries ("must work without X", "P0 ships before Y"). NOT SCREAMING_SNAKE invariants — those belong in specs.
   - **Dependencies**: Checklist of blockers
   - **As-Built Specs**: Links to specs documenting completed work. Empty if nothing built yet.
   - **Design Notes**: Scratch pad for tradeoffs and options explored.

4. **Validate**: Run `pnpm check:docs` and fix any errors.

## Updating an existing project

1. Read the project and its linked specs/items.
2. Update deliverable statuses and Work Item columns as tasks are created.
3. Link new specs in As-Built Specs as implementation lands.
4. Update `updated:` date in frontmatter.

## Rules

- **NO_INVARIANTS_IN_PROJECTS** — SCREAMING_SNAKE invariants belong in specs. Project Constraints are plain-language planning boundaries.
- **PROJECTS_REF_BY_ID** — reference items by ID only (`task.0005`), never file paths
- **LINK_DONT_DUPLICATE** — if a spec defines behavior, link to it. Don't restate.
- **ID_IMMUTABLE** — `proj.<slug>` never changes

#$GOAL
