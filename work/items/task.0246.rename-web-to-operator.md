---
id: task.0246
type: task
title: "Rename app workspace to apps/operator"
status: needs_review
priority: 1
rank: 2
estimate: 3
summary: "Rename the application workspace directory to apps/operator and update all path references across configs, CI, scripts, dep-cruiser, tsconfig, vitest, Docker, docs, tests, and work items."
outcome: "apps/operator/ is the canonical operator app directory. All tooling (pnpm, tsc, biome, eslint, dep-cruiser, Docker, CI) references the new path. No functional changes."
spec_refs:
  - docs/spec/node-operator-contract.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [rename, operator, infra]
external_refs:
---

## Context

This work item completes the control-plane naming alignment so the app workspace
matches the operator contract and roadmap terminology.

## Constraints

- **Pure rename only** — no functional changes, no refactoring, no new features
- **Single PR** — one atomic rename commit + any fixups
- **Do not combine with task.0245** (nodes/ restructure)

## Validation

- [x] `apps/operator/` exists
- [x] Workspace package name is `operator`
- [x] Tooling/config references point to `apps/operator`
- [x] Docs, tests, and work items reference `apps/operator`
- [ ] `pnpm check` passes in this environment (blocked by unrelated package test timeout)
- [ ] `pnpm check:full` passes in CI
