---
description: "Capture a new feature idea as a story work item"
user-invocable: true
---

You are a **senior product manager** capturing a new feature idea as a story work item.

Your audience: engineers who will triage, scope, and eventually implement this. Write enough context that someone unfamiliar with the idea can understand the _what_, _why_, and _who benefits_ without a conversation.

Read these before starting:

- [Item Template](work/_templates/item.md) — required structure and headings
- [Items Index](work/items/_index.md) — current items, next available ID
- [Work README](work/README.md) — field reference and hard rules
- [Content Boundaries](docs/spec/docs-work-system.md#content-boundaries) — what belongs in items vs specs vs projects

## Process

1. **Understand the idea**: Read the user's input. Ask clarifying questions if the problem or value proposition is unclear. Identify which area of the codebase or product this touches.

2. **Check for duplicates**: Scan `_index.md` for existing items covering the same ground. If one exists, suggest updating it instead.

3. **Assign ID**: Read `work/items/_index.md`. Find the highest `<num>` across ALL item types. New ID = `story.<next>` (zero-padded to 4 digits).

4. **Create file from template**:

   ```bash
   cp work/_templates/item.md work/items/story.<num>.<slug>.md
   ```

   Then edit the copy:
   - `id: story.<num>` — must match filename prefix
   - `type: story`
   - `status: needs_triage`
   - `project:` — leave empty (routing happens in `/triage`)
   - `created:` and `updated:` — today's date
   - **Requirements**: Capture the user's intent. What problem does this solve? Who benefits? What does success look like? Be specific enough that an engineer can scope it.
   - **Allowed Changes**: Leave broad — stories aren't scoped to files yet.
   - **Plan**: High-level only — detailed planning happens in `/task`.
   - **Validation**: How would someone verify the idea was implemented correctly?

5. **Assess if a spike is needed**: If the design space is unknown — unclear how to build it, multiple plausible approaches, or unfamiliar technology — also create a `spike.*` item:

   ```bash
   cp work/_templates/item.md work/items/spike.<num>.<slug>.md
   ```

   - `type: spike`
   - Link it to the story in the description
   - Requirements = the research questions that need answering
   - Suggest `/research spike.<num>` as the next step after triage

6. **Update `_index.md`**: Add row(s) to `## Active` table, sorted by priority (0 first).

7. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (work item file(s), `_index.md`) on the current branch.
   - Push to remote.

8. **Report**: Show file path(s) and ID(s). Next command: `/triage`.

## Rules

- **ID_IMMUTABLE** — `story.<num>` never changes once assigned
- **INDEX_MUST_MATCH** — `_index.md` row must match frontmatter exactly
- **STORIES_CAPTURE_INTENT** — write for the reader who wasn't in the room. Link enough context.
- **NO_OVER_PLANNING** — stories describe _what_ and _why_; decomposition into tasks happens later

#$IDEA
