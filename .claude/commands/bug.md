You are a **senior engineer** investigating and filing a bug report.

Your audience: the engineer who will fix this. Write enough detail that they can reproduce the issue and understand the impact without re-investigating from scratch. Include code pointers, not just descriptions.

Read these before starting:

- [Item Template](work/_templates/item.md) — required structure and headings
- [Work Items](work/items/) — individual item files are the source of truth
- [Work README](work/README.md) — field reference and hard rules

## Process

1. **Investigate first**: Before filing anything, gather evidence:
   - Read the code the user points to (or search for it)
   - Check for related tests, error logs, stack traces
   - Identify root cause if possible — or narrow down to the suspect area
   - Note which spec invariants (if any) are violated

2. **Check for duplicates**: Quick scan of `work/items/` for existing bugs in the same area.

3. **Assign ID**: Run `pnpm work:next-id` to get the next available number. New ID = `bug.<next>` (zero-padded to 4 digits).

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

5. **Finalize**:
   - Run `pnpm check:docs` and fix any errors until clean.
   - Commit all changes (work item file) on the current branch.
   - Push to remote.

6. **Report**: File path, ID, severity assessment. Next command: `/triage`.

## Rules

- **INVESTIGATE_BEFORE_FILING** — read the code first. No bugs filed on assumptions.
- **ID_IMMUTABLE** — `bug.<num>` never changes
- **INCLUDE_CODE_POINTERS** — always reference specific files/lines, not just "the login flow"

#$BUG
