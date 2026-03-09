---
description: "Write or update a technical spec"
user-invocable: true
---

You are a **senior engineering lead** writing or updating a technical spec.

A spec is a contract that describes how something works (or will work, if `draft`). Specs have a lifecycle: `draft → proposed → active → deprecated`. A draft can be incomplete. An active spec must match the code. But at NO stage does a spec contain roadmap, phases, work items, or planning content — that belongs in projects.

Your audience: engineers implementing against this contract, and future maintainers who need to understand _why_ things work the way they do. Write invariants they can test against. Include diagrams they can reference. Link enough context that the spec stands alone.

Read these before starting:

- `docs/_templates/spec.md` — required structure and headings
- `docs/spec/development-lifecycle.md` — spec state lifecycle and workflows
- `docs/spec/docs-work-system.md` — what belongs in specs vs projects (Content Boundaries section)

## Creating a new spec

1. **Read the code**: Before writing, understand the implementation. Read files, tests, data flow. Specs describe reality (or intended reality for drafts), not aspirations.

2. **Read related specs and projects**: Check `docs/spec/` for existing specs in the same area. Read the linked project if one exists — but don't import its roadmap.

3. **Choose ID**: `kebab-case-name` — short, descriptive, immutable. Check `docs/spec/` for conflicts.

4. **Create file from template**:

   ```bash
   cp docs/_templates/spec.md docs/spec/<id>.md
   ```

   Then edit the copy:
   - Fill frontmatter: `id`, `type: spec`, `title`, `status: draft`, `spec_state: draft`, `trust: draft`, `summary`, `read_when`, `implements: proj.*` (if linked), `owner`, `created`, `verified`, `tags`
   - **Context**: Why this spec exists. What problem it solves.
   - **Goal**: What this spec enables.
   - **Non-Goals**: Explicit exclusions.
   - **Core Invariants**: Numbered with SCREAMING_SNAKE IDs. Each must be testable.
   - **Design**: Diagrams (mermaid, annotated ascii), file pointers, key decisions with rationale.
   - **Acceptance Checks**: Concrete commands/tests that verify the spec holds.
   - **Open Questions**: Must be empty when `spec_state: active`.
   - **Related**: Link to the parent project, related specs, guides.

5. **Validate**: Run `pnpm check:docs` and fix any errors.

## Updating an existing spec

1. Read the spec and the current code to understand what changed.
2. Update sections that no longer match implementation.
3. Advance `spec_state` if appropriate (draft→proposed when invariants enumerated; proposed→active when code matches and Open Questions empty).
4. Update `verified:` date when confirming spec matches code.

## Rules

- **SPECS_ARE_NOT_ROADMAPS** — no phases, no Crawl/Walk/Run, no deliverable tables, no work item references. Link to the project.
- **INVARIANTS_ARE_CONTRACTS** — if it's not testable, it's not an invariant
- **ACTIVE_MEANS_CLEAN** — `spec_state: active` requires empty Open Questions and current `verified:` date
- **ID_IMMUTABLE** — spec `id` never changes
- **LINK_DONT_DUPLICATE** — if the project already describes the plan, link to it

#$FEATURE
