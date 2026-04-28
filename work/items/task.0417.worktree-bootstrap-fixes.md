---
id: task.0417
type: task
title: "Fresh-worktree bootstrap fixes — drop `.env.local` from `db:check`, detect orphan-missing dist in scoped build"
status: needs_closeout
priority: 1
rank: 1
estimate: 1
summary: "Two surgical fixes that close the last gaps preventing agent self-bootstrap of a fresh worktree. (1) `db:check:*` scripts wrap drizzle-kit in `dotenv -e .env.local --` even though `drizzle-kit check` doesn't connect to a database; this requires `.env.local` to exist (gitignored) for no real reason. Inline a fake `DATABASE_URL` and drop the wrapper. (2) `scripts/run-scoped-package-build.mjs` exits early with `No workspace packages changed` when nothing has changed vs upstream — but a fresh worktree also has no `dist/` outputs, so subsequent test/typecheck phases fail importing workspace packages. Detect orphan-missing declaration outputs and rebuild them regardless of git diff."
outcome: |
  - `pnpm db:check` runs cleanly without `.env.local` (verified: drizzle-kit's `check` command validates migration files locally and doesn't connect).
  - `pnpm db:check:*` scripts no longer use `dotenv -e .env.local --`; each inlines `DATABASE_URL=postgres://check@localhost:0/check` to satisfy the config's `requireDatabaseUrl()` guard with a value drizzle-kit `check` ignores.
  - `scripts/run-scoped-package-build.mjs` correctly rebuilds any buildable workspace whose `dist/index.d.ts` is missing, even when no source files changed vs upstream. Verified by `pnpm packages:clean` (dist + tsbuildinfo) followed by `node scripts/run-scoped-package-build.mjs` — successfully rebuilds and emits all 34 declarations.
  - Fresh-worktree bootstrap reduces to: `git worktree add … && pnpm install --frozen-lockfile`. Subsequent `pnpm check:fast` succeeds without copying `.env.local` from another worktree.
spec_refs: []
assignees: []
credit:
project:
branch: task/0417-worktree-bootstrap-fixes
created: 2026-04-28
updated: 2026-04-28
labels: [dev-loop, monorepo, p1]
---

# task.0417 — Fresh-worktree bootstrap fixes

## Problem

Two gaps surfaced during task.0415 work that block agent self-bootstrap on a fresh worktree:

### Gap 1 — `db:check:*` requires `.env.local` for no real reason

```jsonc
"db:check:operator": "dotenv -e .env.local -- tsx … drizzle-kit check --config=…",
"db:check:poly":     "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_POLY tsx … drizzle-kit check …'",
"db:check:resy":     "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_RESY tsx … drizzle-kit check …'",
"db:check:poly:doltgres": "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DOLTGRES_URL_POLY tsx … drizzle-kit check --config=…'",
```

`drizzle-kit check` is a local-filesystem migration consistency check — it does not connect to a database. The drizzle config files call `requireDatabaseUrl()` at the top level, so they need _some_ `DATABASE_URL` env var to be set, but the value is never used by `check`. The `dotenv -e .env.local --` wrapper is cargo-culted from the `migrate`/`generate` scripts (which do connect).

Effect: a fresh worktree without `.env.local` cannot run `pnpm check:fast` because `db:check` fails on missing dotenv file.

### Gap 2 — Scoped package build skips on no-change but fresh worktrees have no `dist/`

`scripts/run-scoped-package-build.mjs` line 80:

```js
if (changedWorkspaceNames.length === 0) {
  console.log("No workspace packages changed.");
  process.exit(0);
}
```

On a fresh worktree branched from main with no source changes, this exits without building anything. But the fresh worktree also has no `dist/` outputs anywhere — every workspace package's declaration files are missing. Subsequent `tsc --noEmit` (typecheck) and `vitest run` (tests) then fail with `Could not find a declaration file for module '@cogni/…'`.

The script already has `hasDeclarationOutput()` and uses it inside the `closure` walk, but only for packages that are dependencies of _changed_ packages. There's no orphan-missing detection.

## Fixes

### Fix 1 — Drop dotenv wrapper from `db:check:*` (4 scripts)

Replace `dotenv -e .env.local -- … DATABASE_URL=…` with inline fake:

```jsonc
"db:check:operator":      "DATABASE_URL=postgres://check@localhost:0/check tsx … drizzle-kit check --config=nodes/operator/drizzle.config.ts",
"db:check:poly":          "DATABASE_URL=postgres://check@localhost:0/check tsx … drizzle-kit check --config=nodes/poly/drizzle.config.ts",
"db:check:resy":          "DATABASE_URL=postgres://check@localhost:0/check tsx … drizzle-kit check --config=nodes/resy/drizzle.config.ts",
"db:check:poly:doltgres": "DATABASE_URL=postgres://check@localhost:0/check tsx … drizzle-kit check --config=nodes/poly/drizzle.doltgres.config.ts",
```

Same value for all four because `check` ignores it. `migrate`/`generate` scripts keep their dotenv wrappers (they actually need the real URL).

### Fix 2 — Augment scoped-build with orphan-missing detection

Remove the early-exit at line 80; let `createBuildPlan` handle the empty-changes case. Inside `createBuildPlan`, after computing `closureMissing`, scan ALL workspaces and add any buildable package with a missing declaration output to `missingBootstrapDeps`. If after that the target list is empty (everything has dist), the existing `if (buildPlan.targets.length === 0)` early-exit handles it.

## Design

### Outcome

Fresh-worktree bootstrap reduces to `git worktree add … && pnpm install`. No copying `.env.local`. No manual `pnpm packages:build`. `pnpm check:fast` (the husky pre-push gate) just works.

### Approach

**Solution**: Two tiny script changes — 4 lines of `package.json` and ~15 lines of `scripts/run-scoped-package-build.mjs`. No new files. No new tooling.

**Reuses**: existing `hasDeclarationOutput()` helper; existing `workspaceGraph.byName` traversal; existing `createBuildPlan` / `runBuildTargets` flow.

**Rejected**:

- _Make `drizzle.config.ts` use a default URL when env is absent_ — touches every node's drizzle config; invasive for one missing convenience.
- _Add a `pnpm bootstrap:env` that copies `.env.local` from another worktree_ — fragile, needs path knowledge, doesn't help CI runners.
- _Always run full `packages:build` on every check:fast_ — defeats the scoped-build's whole purpose.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] DB_CHECK_NO_ENV_FILE: `pnpm db:check` succeeds with no `.env.local` and no `.env.test` present. Verified: ran in worktree without env files and got `Everything's fine 🐶🔥` from all 4 drizzle configs.
- [ ] DB_CHECK_FAKE_URL_HARMLESS: the inlined `postgres://check@localhost:0/check` value is never used by `drizzle-kit check`; it only satisfies the config's top-level `requireDatabaseUrl()` guard.
- [ ] ORPHAN_MISSING_REBUILDS: when source has no changes vs upstream but a buildable workspace's `dist/index.d.ts` is missing, scoped build rebuilds it. Verified: `pnpm packages:clean && rm -rf nodes/*/packages/*/dist nodes/*/packages/*/*.tsbuildinfo` then `node scripts/run-scoped-package-build.mjs` — emits 34/34 declarations.
- [ ] NO_REGRESSION_ON_NORMAL_FLOW: when dist/ is already populated, scoped build still hits the existing "All required package declarations already exist" early-exit. Verified.
- [ ] MIGRATE_GENERATE_UNCHANGED: only `db:check:*` scripts touched. `db:migrate:*` and `db:generate:*` keep their dotenv wrappers (they connect to real databases).

### Files

- Modify: `package.json` — 4 `db:check:*` script lines.
- Modify: `scripts/run-scoped-package-build.mjs` — remove early-exit at L80, add orphan-missing filter in `createBuildPlan`.

## Validation

### exercise

```bash
# Verify Fix 1 — db:check works without .env.local:
git worktree add /tmp/test-bootstrap -b test/bootstrap main
cd /tmp/test-bootstrap
pnpm install --frozen-lockfile
test ! -f .env.local && echo "no env file"
pnpm db:check   # expect: 4 × "Everything's fine 🐶🔥"

# Verify Fix 2 — orphan-missing rebuild:
pnpm packages:clean
rm -rf nodes/*/packages/*/dist nodes/*/packages/*/*.tsbuildinfo
node scripts/run-scoped-package-build.mjs
# expect: "Bootstrap missing declarations: …" then "All 34 packages have declarations"

# End-to-end:
pnpm check:fast   # green, no .env.local needed
```

### observability

Local-only task — no Loki signal needed. Validation is pre-merge: PR CI green + manual fresh-worktree exercise above.

## Notes

Discovered while implementing task.0415 (turbo DAG for check:fast). Originally proposed in that work item's recommendation but split out to keep the turbo PR reviewable.

Earlier in this session I incorrectly concluded these fixes were blocked by deeper infra issues — that was a self-inflicted error from `rm -rf dist/` without also wiping `.tsbuildinfo`, which left tsc's incremental cache lying about its state. Once I used the existing `pnpm packages:clean` (which wipes both), the rebuild path worked cleanly. Both fixes here are correct and tested.
