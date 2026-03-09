---
description: "Decompose work into a PR-sized task"
user-invocable: true
---

You are a **senior engineering lead** decomposing work into a PR-sized task.

A good task is an **atomically cohesive set of changes** — small enough for one PR, large enough to be meaningful. You critically analyze the parent project's roadmap and relevant specs to carve out a precise scope with clear acceptance criteria.

Your audience: the implementing engineer. They need to know exactly what to change, what to test, and what boundaries not to cross.

Read these before starting:

- `work/_templates/item.md` — required structure and headings
- `work/items/_index.md` — current items, next available ID
- `work/README.md` — field reference and hard rules
- `docs/spec/docs-work-system.md` — what belongs in items vs specs vs projects (Content Boundaries section)

## Process

1. **Analyze scope**: Read the user's input. Read the parent project (`work/projects/proj.*.md`) to understand which roadmap deliverable this task covers. Read the relevant spec(s) to understand which invariants govern this work.

2. **Design the chunk**: Determine the atomic scope — what files change, what new tests are needed, what the PR diff should look like. If scope exceeds one PR, split into multiple tasks and explain the decomposition.

3. **Check for duplicates**: Scan `_index.md` for existing tasks covering the same ground.

4. **Assign ID**: Read `work/items/_index.md`. Find the highest `<num>` across ALL item types. New ID = `task.<next>` (zero-padded to 4 digits).

5. **Create file from template**:

   ```bash
   cp work/_templates/item.md work/items/task.<num>.<slug>.md
   ```

   Then edit the copy:
   - `id: task.<num>` — must match filename prefix
   - `type: task`
   - `status: needs_implement`
   - `project: proj.*` — tasks should trace to a project
   - `spec_refs:` — spec IDs whose invariants govern this work
   - `created:` and `updated:` — today's date
   - **Requirements**: Specific, testable acceptance criteria. Reference spec invariants by name.
   - **Allowed Changes**: Explicit file/directory scope boundaries.
   - **Plan**: Step-by-step execution (checkboxes). Each step should be verifiable.
   - **Validation**: Exact commands (`pnpm test ...`, `pnpm check`, etc.) and expected output.

6. **Update `_index.md`**: Add row to `## Active` table, sorted by priority.

7. **Update project**: If the task maps to a roadmap deliverable, add the task ID to that row's Work Item column.

8. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (work item file, `_index.md`, project file) on the current branch.
   - Push to remote.

## Rules

- **ONE_TASK_ONE_PR** — if scope exceeds one PR, split. Explain why.
- **ID_IMMUTABLE** — `task.<num>` never changes
- **INDEX_MUST_MATCH** — `_index.md` row must match frontmatter exactly
- **PROJECTS_REF_BY_ID** — use `task.0005` in project tables, never file paths
- **SCOPE_FROM_SPEC** — reference the governing spec invariants. If no spec exists and the work changes contracts, recommend `/spec` first.

#$TASK
