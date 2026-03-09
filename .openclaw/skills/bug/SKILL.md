---
description: "Investigate and file a bug report"
user-invocable: true
---

You are a **senior engineer** investigating and filing a bug report.

Your audience: the engineer who will fix this. Write enough detail that they can reproduce the issue and understand the impact without re-investigating from scratch. Include code pointers, not just descriptions.

Read these before starting:

- `work/_templates/item.md` — required structure and headings
- `work/items/_index.md` — current items, next available ID
- `work/README.md` — field reference and hard rules

## Process

1. **Investigate first**: Before filing anything, gather evidence:
   - Read the code the user points to (or search for it)
   - Check for related tests, error logs, stack traces
   - Identify root cause if possible — or narrow down to the suspect area
   - Note which spec invariants (if any) are violated

2. **Check for duplicates**: Scan `_index.md` for existing bugs in the same area.

3. **Assign ID**: Read `work/items/_index.md`. Find the highest `<num>` across ALL item types. New ID = `bug.<next>` (zero-padded to 4 digits).

4. **Create file from template**:

   ```bash
   cp work/_templates/item.md work/items/bug.<num>.<slug>.md
   ```

   Then edit the copy:
   - `id: bug.<num>` — must match filename prefix
   - `type: bug`
   - `status: needs_triage`
   - `priority: 1` default; `0` for security/data-loss bugs
   - `project:` — leave empty (routing happens in `/triage`)
   - `spec_refs:` — spec IDs whose invariants are violated
   - `created:` and `updated:` — today's date
   - **Requirements** must include:
     - **Observed**: What actually happens (with code pointers)
     - **Expected**: What should happen
     - **Reproduction**: Steps or file:line where the bug manifests
     - **Impact**: Who is affected and how severely
   - **Allowed Changes**: Narrow scope to the affected area
   - **Validation**: Exact command that should pass after the fix

5. **Update `_index.md`**: Add row to `## Active` table, sorted by priority.

6. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (work item file, `_index.md`) on the current branch.
   - Push to remote.

7. **Report**: File path, ID, severity assessment. Next command: `/triage`.

## Rules

- **INVESTIGATE_BEFORE_FILING** — read the code first. No bugs filed on assumptions.
- **ID_IMMUTABLE** — `bug.<num>` never changes
- **INDEX_MUST_MATCH** — `_index.md` row must match frontmatter exactly
- **INCLUDE_CODE_POINTERS** — always reference specific files/lines, not just "the login flow"

#$BUG
