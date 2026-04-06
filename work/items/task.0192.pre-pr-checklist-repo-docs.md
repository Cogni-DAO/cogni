---
id: task.0192
type: task
title: "Codify the accepted pre-PR checklist into repo contributor guidance"
status: needs_implement
priority: 2
rank: 99
estimate: 1
summary: Add one bounded work item plus minimal repo guidance so nontrivial PRs follow Cogni's accepted pre-PR checklist without relying on project-home memory
outcome: Contributors and agents can discover, before opening a nontrivial PR, the required work-item linkage, hand-finished PR body, local validation evidence, and reviewable PR scope
spec_refs:
assignees: []
credit:
project:
branch: docs/pre-pr-checklist-repo-docs
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels: [docs, process, contributor]
external_refs:
---

# Codify the Accepted Pre-PR Checklist into Repo Guidance

## Requirements

- Add a repo-local work item that scopes this contributor-guidance change as one PR-sized documentation task.
- Update the minimal repo guidance so a contributor can discover, before opening a nontrivial PR, that the PR must reference exactly one primary work item from `work/items/`.
- Update the minimal repo guidance so a contributor can discover that nontrivial PRs need a hand-finished PR body, explicit local validation evidence, and reviewable scope aligned to existing work-management rules.
- Keep the docs guidance concise and point back to the existing work-management guide instead of duplicating the full checklist.

## Allowed Changes

- `work/items/task.0192.pre-pr-checklist-repo-docs.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- Read-only support: `work/README.md`, `work/_templates/item.md`

## Plan

- [ ] Create the bounded work item at the next available `task.*` id for this docs/process change.
- [ ] Add concise contributor-facing guidance in `CONTRIBUTING.md` covering one primary work item, hand-finished PR body, explicit local validation evidence, and reviewable scope.
- [ ] Add matching agent-facing guidance in `AGENTS.md` so automated contributors follow the same pre-PR gate.
- [ ] Validate the touched docs with the narrowest relevant docs checks and confirm the diff stays limited to this item plus minimal guidance files.

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Touched guidance files pass docs validation and the work index regenerates cleanly.

## Review Checklist

- [ ] **Work Item:** PR references exactly one primary Work Item ID
- [ ] **Guidance:** contributor-facing docs mention work-item linkage, hand-finished PR body, validation evidence, and reviewable scope
- [ ] **Validation:** `pnpm check:docs` passes after the bounded docs changes
- [ ] **Scope:** diff is limited to this work item and minimal repo guidance files

## PR / Links

- `work/README.md`
- `/data/workspace/projects/cogni-node-template/pre-pr-checklist-2026-03-25.md` (accepted source checklist; read-only)

## Attribution

- Approved coding executor
