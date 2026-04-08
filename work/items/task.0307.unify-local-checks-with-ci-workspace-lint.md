---
id: task.0307
type: task
title: "Unify local checks with CI workspace lint"
status: needs_merge
priority: 1
rank: 11
estimate: 1
summary: "Ensure Husky-verified code can't fail CI due to per-workspace lint/format drift by running the same workspace-scoped lint locally as CI (turbo lint)."
outcome: "`pnpm check:fast` runs workspace-scoped lint via Turborepo (affected on feature branches), matching CI. Agents and developers catch node-specific Biome/ESLint issues before push."
spec_refs:
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/dry-local-ci-lint
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-08
updated: 2026-04-08
labels: [ci, devex, turbo, lint]
external_refs:
---

## Context

CI runs per-workspace lint via Turborepo (e.g. `turbo run lint --affected`), which can catch issues in a node workspace even when repo-root checks or Husky hooks appear green.

This causes a recurring failure mode: **agents push Husky-verified commits that later fail CI** because CI executes a different lint/format scope.

## Plan

- Update `scripts/check-fast.sh` (Husky pre-push) to also run `workspace:lint` via `scripts/run-turbo-checks.sh lint`.
- Update `scripts/check-all.sh` to include the same `workspace:lint` step for parity.
- Add a `check:prepush` entrypoint that runs non-fixing checks (no `lint:fix`) so Husky can't "pass" by applying local-only fixes that CI never sees.
- Ensure `check:prepush` uses `origin/canary` as the `--affected` base so it doesn't accidentally become a no-op on branches tracking their own remote head.
- Ensure `check:prepush` runs a full `pnpm packages:build` (CI parity) so root `pnpm test:ci` doesn't fail in fresh clones due to missing built workspace package outputs.
- Document the intent in `scripts/AGENTS.md`.

## Validation

```bash
pnpm check:fast
pnpm check:docs
```
