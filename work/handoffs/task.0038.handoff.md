---
id: task.0038.handoff
type: handoff
work_item_id: task.0038
status: active
created: 2026-02-12
updated: 2026-02-12
branch: task/0038-rename-integration-to-component
last_commit: 8226bf52
---

# Handoff: Rename tests/integration → tests/component

## Context

- `tests/integration/` was a misnomer — these tests use isolated docker testcontainers, not a full running stack
- Renamed to `tests/component/` with dependency-class subdirectories (db, docker, repo, ai, wallet)
- Subdirectory merges: `payments/` → `db/`, `brain/` → `repo/`, `sandbox/` → `docker/`
- Created `tests/external/` placeholder for future internet/3rd-party adapter tests
- 5 incremental commits on branch, rebased onto staging

## Current State

- All directory moves and reference updates are committed (5 commits)
- `pnpm test:component` passes, `pnpm test:comp` shorthand works
- `test:int` alias removed, zero references remain outside the task description file
- **Blocked on pre-push hook**: `vitest.component.config.mts` fails 3 checks that need fixing before push
- `biome/base.json` has a partial fix staged (added file to noDefaultExport override) but not committed
- Root-layout allowlist also needs updating

## Decisions Made

- Test scope name: "component" (not "adapter" or "db-ops") — [task.0038 design section](../items/task.0038.rename-integration-to-component-tests.md#design-decisions)
- `.int.test.ts` file suffix left unchanged — separate chore if desired
- `tests/external/` reserved for nightly/on-demand tests with secrets, not in default CI

## Next Actions

- [ ] Fix `vitest.component.config.mts` biome lint: add to `noDefaultExport` override in `biome/base.json` (partially done, uncommitted)
- [ ] Fix `vitest.component.config.mts` biome format: collapse `globalSetup` array to single line
- [ ] Fix `check:root-layout`: add `vitest.component.config.mts` to the root-layout allowlist in `scripts/check-root-layout.ts`
- [ ] Commit the biome + root-layout fixes (amend into build commit or new commit)
- [ ] `git push -u origin task/0038-rename-integration-to-component`
- [ ] Create PR targeting `staging` via `gh pr create`
- [ ] Update task.0038 status to In Progress / Done

## Risks / Gotchas

- The pre-push hook runs `pnpm check` which includes biome lint, biome format, and root-layout — all three must pass
- `vitest.component.config.mts` was renamed from `vitest.integration.config.mts` but biome's `**/*.config.mts` glob does NOT match `*.component.config.mts` (extra dot segment) — must be added explicitly to the override list
- The root-layout allowlist (`scripts/check-root-layout.ts`) likely has explicit filenames — needs the new config name added
- Other uncommitted changes in the worktree (`services/sandbox-openclaw/AGENTS.md`, `work/items/bug.0005*`, `work/projects/proj.unified-graph-launch.md`) are unrelated — do not stage them

## Pointers

| File / Resource                                                 | Why it matters                                       |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `vitest.component.config.mts`                                   | The renamed config — source of pre-push failures     |
| `biome/base.json:196-213`                                       | `noDefaultExport` override list — needs the new file |
| `scripts/check-root-layout.ts`                                  | Root-layout allowlist — needs the new file           |
| `work/items/task.0038.rename-integration-to-component-tests.md` | Full task spec with phase checklist                  |
| `tests/component/AGENTS.md`                                     | Updated directory-level guidance                     |
| `tests/external/AGENTS.md`                                      | New placeholder for future external tests            |
