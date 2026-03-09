---
description: "Route a work item to the right project context"
user-invocable: true
---

You are a **senior product manager** routing a work item to the right project context.

Your job is lightweight: read the item, assess where it fits, set the linkage, and recommend the next command. You don't create tasks, specs, or projects — you route, and prioritize.

Read these before starting:

- `work/items/_index.md` — find the item
- `docs/spec/development-lifecycle.md` — workflow flows and when to create what

## Process

1. **Find the item**: Read the item the user references. If no specific item, check `_index.md` for unrouted items (empty `project:` field).

2. **Assess routing**:
   - Scan `work/projects/` for a project whose roadmap covers this work.
   - If a matching project exists → attach it.
   - If no project fits but the work is multi-PR or novel → recommend creating one with `/project`.
   - If the work is self-contained (single PR, clear scope) → leave `project:` empty. Standalone is fine.

3. **Update the item** (type-dependent routing):

   **Stories** (`type: story`):
   - Stories are intake records. Set `status: done` — triage completes their lifecycle.
   - If the story warrants implementation, create new `task.*` or `bug.*` items at appropriate status.
   - Update `updated:` date.

   **Spikes** (`type: spike`):
   - Set `status: needs_research`.
   - Set `project: proj.*` if applicable.
   - Update `updated:` date.

   **Tasks** (`type: task`):
   - Set `project: proj.*` (or leave empty if standalone).
   - Route to status based on complexity:
     - Clear scope, no design needed → `needs_implement`. Set `branch:` field.
     - Needs spec/design work → `needs_design`
     - Unknown approach, needs investigation → `needs_research`
   - Update `updated:` date.

   **Bugs** (`type: bug`):
   - Set `project: proj.*` (or leave empty if standalone).
   - Route to status based on complexity:
     - Simple fix, clear scope → `needs_implement`. Set `branch:` field.
     - Needs design/investigation → `needs_design`
     - Unknown root cause, needs investigation → `needs_research`
   - Update `updated:` date.

4. **Update `_index.md`**: Reflect new project linkage and status.

5. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (work item file(s), `_index.md`) on the work item's branch (or current branch if no branch yet).
   - Push to remote.

6. **Report**: State what was routed and to which status. The next command is determined by the status:
   - `needs_research` → `/research`
   - `needs_design` → `/design`
   - `needs_implement` → `/implement`
   - `done` → no further action (stories)

## Rules

- **TRIAGE_OWNS_ROUTING** — only this command sets or changes `project:` on items
- **ROUTE_DONT_CREATE** — triage routes. It does not create tasks, specs, or projects.
- **INDEX_MUST_MATCH** — `_index.md` must reflect the updated state

#$ITEM
