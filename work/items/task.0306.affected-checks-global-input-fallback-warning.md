---
id: task.0306
type: task
title: "Affected checks: warn on global-input full-build fallback"
status: needs_merge
priority: 1
rank: 10
estimate: 1
summary: "When affected-scoped local checks fall back to a full packages build due to global build inputs changing (tsconfig*, lockfile, root package.json), emit an explicit red warning so developers notice the scope expansion."
outcome: "Fallback path prints a red WARN(task.0306) with scope refs; local check scripts remain affected-by-default but fail-safe on global build input changes."
spec_refs:
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: worktree-cicd-check
pr: https://github.com/Cogni-DAO/node-template/pull/828
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-08
updated: 2026-04-08
labels: [ci, devex, turbo]
external_refs:
---

## Context

Affected-only local checks are the right default, but global build input changes can force a safe full build. That scope expansion should be loud to avoid confusion about run time and behavior.

## Notes

- Current change addresses the **affected-scope fallback visibility** (global inputs → full `packages:build`) but does **not** address the separate issue where **format/lint scopes differ between CI and local runs** (e.g., CI running `biome check .` in a subdirectory while local runs use root-level scripts/config). If we want this fully DRY and consistent, CI and local should both call the same `scripts/check-*.sh` entrypoints (or share a single underlying formatter/linter runner script) so file targeting is identical.

## Validation

```bash
pnpm check:fast
pnpm check:docs
```
