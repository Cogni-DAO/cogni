---
id: task.0038
type: task
title: "Rename tests/integration → tests/component with dependency-class subdirs"
status: needs_design
priority: 1
estimate: 2
summary: "Rename tests/integration/ to tests/component/, rename sandbox/ to docker/, rename script/config/CI references, and reserve tests/external/ for future internet-dependent tests."
outcome: "All test paths, configs, CI, docs, and AGENTS.md files reference tests/component/; pnpm test:component runs green; pnpm test:int alias preserved temporarily; no broken imports or dead references."
spec_refs: system-test-architecture
assignees: derekg1729
credit:
project: proj.ci-cd-reusable
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [dx, tests, rename]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 22
---

# Rename tests/integration → tests/component

## Context

`tests/integration/` is a misnomer — these tests exercise individual adapters/components against real infrastructure (testcontainers Postgres, Docker, git/rg binaries) but never boot the application stack. The correct test-scope name is **component**. A separate `tests/external/` bucket is reserved for true internet/3rd-party adapter tests (run nightly/on-demand, not in default CI).

## Requirements

- `tests/integration/` directory renamed to `tests/component/`
- `tests/component/sandbox/` renamed to `tests/component/docker/` (dependency-class name)
- Vitest config renamed: `vitest.integration.config.mts` → `vitest.component.config.mts`
- `pnpm test:component` is the primary script; `pnpm test:int` kept as temporary alias
- CI job name updated from `integration` to `component`
- All 44 files referencing `tests/integration` updated to `tests/component`
- All internal test file imports resolve correctly after move
- `.int.test.ts` file suffix is **unchanged** (separate chore if desired)
- `tests/external/` directory created with a placeholder AGENTS.md (scope marker only)

## Design Decisions

Subdirectory mapping under `tests/component/`:

| Old         | New       | Rationale                                          |
| ----------- | --------- | -------------------------------------------------- |
| `db/`       | `db/`     | unchanged — testcontainers Postgres                |
| `payments/` | `db/`     | merge — also testcontainers Postgres adapter tests |
| `repo/`     | `repo/`   | unchanged — git/rg binaries                        |
| `sandbox/`  | `docker/` | rename — dependency class is Docker daemon         |
| `brain/`    | `repo/`   | merge — uses temp git repo + real binaries         |
| `ai/`       | `ai/`     | unchanged                                          |
| `wallet/`   | `wallet/` | unchanged (stub)                                   |
| `setup/`    | `setup/`  | unchanged                                          |

## Allowed Changes

- `tests/integration/` → `tests/component/` (full tree)
- `vitest.integration.config.mts` → `vitest.component.config.mts`
- `vitest.config.mts` (exclude path)
- `package.json` (script names)
- `.github/workflows/ci.yaml` (job name, step name)
- `scripts/check-full.sh`
- All AGENTS.md files (inside and outside the directory)
- All docs/spec files with prose references
- All AI prompt/workflow files (`.agent/`, `.github/prompts/`, `.clinerules/`, `.claude/`, `.cursor/`, `.gemini/`)
- Work items and project files with prose references
- Test fixture files with import paths
- `tests/external/AGENTS.md` (new file — placeholder only)

## Plan

### Phase 1: Directory moves (git mv)

- [ ] `git mv tests/integration tests/component`
- [ ] `git mv tests/component/sandbox tests/component/docker`
- [ ] Merge `tests/component/payments/` into `tests/component/db/` (move files, update imports)
- [ ] Merge `tests/component/brain/` into `tests/component/repo/` (move files, update imports)
- [ ] Remove empty `payments/` and `brain/` dirs
- [ ] Create `tests/external/AGENTS.md` placeholder

### Phase 2: Config files (4 files)

- [ ] Rename `vitest.integration.config.mts` → `vitest.component.config.mts`
  - Update `include` glob: `tests/component/**/*.int.test.ts`
  - Update `globalSetup` path: `./tests/component/setup/testcontainers-postgres.global.ts`
  - Update module header comment
- [ ] `vitest.config.mts` line 42: `tests/integration/**` → `tests/component/**`
- [ ] `package.json` line 99:
  - `"test:component": "vitest run --config vitest.component.config.mts"`
  - `"test:int": "pnpm test:component"` (temporary alias)
- [ ] `scripts/check-full.sh`: update any `test:int` references

### Phase 3: CI (1 file)

- [ ] `.github/workflows/ci.yaml`:
  - Job key line 136: `integration:` → `component:`
  - Step name line 172: `Integration tests (testcontainers)` → `Component tests (testcontainers)`
  - Step command line 173: `pnpm test:int` → `pnpm test:component`

### Phase 4: AGENTS.md files inside tests/component/ (4 files)

- [ ] `tests/component/AGENTS.md` — update title, CLI examples, self-references
- [ ] `tests/component/repo/AGENTS.md` — update self-references (now includes brain tests)
- [ ] `tests/component/docker/AGENTS.md` — update title from sandbox to docker, self-references
- [ ] Remove stale `brain/AGENTS.md` (merged into repo/)

### Phase 5: AGENTS.md files outside (11 files)

- [ ] `AGENTS.md` (root) — update `pnpm test:int` → `pnpm test:component`, path references
- [ ] `tests/AGENTS.md`
- [ ] `src/adapters/AGENTS.md`
- [ ] `src/adapters/server/sandbox/AGENTS.md`
- [ ] `src/adapters/server/ai/AGENTS.md`
- [ ] `src/adapters/server/db/AGENTS.md`
- [ ] `src/adapters/server/accounts/AGENTS.md`
- [ ] `src/adapters/test/ai/AGENTS.md`
- [ ] `src/adapters/test/AGENTS.md`
- [ ] `tests/_fixtures/db/AGENTS.md`
- [ ] `tests/_fixtures/sandbox/AGENTS.md`

### Phase 6: Documentation and spec files (7 files)

- [ ] `docs/spec/sandboxed-agents.md`
- [ ] `docs/spec/database-rls.md`
- [ ] `docs/spec/architecture.md`
- [ ] `docs/spec/system-test-architecture.md`
- [ ] `docs/spec/node-ci-cd-contract.md`
- [ ] `docs/spec/check-full.md`
- [ ] `docs/archive/PAYMENTS_TEST_DESIGN.md`

### Phase 7: Source and fixture files (4 files)

- [ ] `src/features/ai/README.md`
- [ ] `tests/_fixtures/auth/db-helpers.ts`
- [ ] `tests/_fixtures/auth/siwe-helpers.ts`
- [ ] `tests/_fixtures/db/seed-client.ts`

### Phase 8: AI prompt/workflow files (6 files)

- [ ] `.agent/workflows/test.md`
- [ ] `.github/prompts/test.prompt.md`
- [ ] `.clinerules/workflows/test.md`
- [ ] `.claude/commands/test.md`
- [ ] `.cursor/commands/test.md`
- [ ] `.gemini/commands/test.toml`

### Phase 9: Work items with prose references (3 files)

- [ ] `work/projects/proj.sandboxed-agents.md`
- [ ] `work/projects/proj.ci-cd-reusable.md`
- [ ] `work/items/bug.0021.ws-event-isolation-heartbeat-contamination.md`

### Phase 10: Verify

- [ ] `pnpm test:component` — all tests pass
- [ ] `pnpm test:int` — alias works, same result
- [ ] `pnpm test` — unit tests still exclude component tests
- [ ] `pnpm check:docs` — no validation errors
- [ ] `grep -r "tests/integration" .` — zero hits (excluding .git/)
- [ ] No broken TypeScript imports: `pnpm typecheck`

## Validation

**Commands:**

```bash
# All component tests pass
pnpm test:component

# Alias still works
pnpm test:int

# Unit tests still exclude component dir
pnpm test

# No stale references
grep -r "tests/integration" --include='*.ts' --include='*.md' --include='*.yaml' --include='*.mts' --include='*.sh' --include='*.toml' .

# Docs system happy
pnpm check:docs

# Types resolve
pnpm typecheck
```

**Expected:** All commands pass. Zero grep hits for `tests/integration`.

## Review Checklist

- [ ] **Work Item:** `task.0038` linked in PR body
- [ ] **Spec:** system-test-architecture invariants upheld
- [ ] **Tests:** no test logic changed — pure rename/move
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0038.handoff.md)

## Attribution

-
