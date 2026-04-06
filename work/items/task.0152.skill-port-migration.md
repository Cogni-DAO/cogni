---
id: task.0152
type: task
title: "Migrate /triage + /implement skills to use WorkItemPort"
status: needs_design
priority: 0
rank: 7
estimate: 2
summary: "Replace direct frontmatter YAML editing in /triage and /implement skills with WorkItemCommandPort calls. Proves the port is usable by real agent workflows. Remaining skills (/closeout, /review-implementation, /bug, /idea) migrate in a follow-up task."
outcome: "/triage reads work items via get(), transitions status via transitionStatus(), patches fields via patch(). /implement does the same. No direct YAML parsing or file writing in these skills. Work scanner (apps/operator/src/lib/work-scanner.ts) uses WorkItemQueryPort.list() instead of filesystem scan."
spec_refs: [development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0156
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, skills]
external_refs:
---

# Migrate /triage + /implement skills to use WorkItemPort

## Requirements

- `/triage` skill uses `get()`, `transitionStatus()`, `patch()` from the port
- `/implement` skill uses `get()`, `transitionStatus()`, `patch()` from the port
- `src/lib/work-scanner.ts` refactored to delegate to `WorkItemQueryPort.list()`
- Zero direct frontmatter YAML parsing or `fs.writeFile` calls in migrated skills
- Existing behavior preserved — same status transitions, same field updates

## Allowed Changes

- Skill definitions (`.claude/` or wherever skills are defined)
- `src/lib/work-scanner.ts` — refactor to use query port
- `src/app/(app)/work/page.tsx` — wire port into the dashboard (if needed)
- Bootstrap/container — wire MarkdownWorkItemAdapter as the port implementation

## Plan

- [ ] Wire MarkdownWorkItemAdapter into the skill execution context
- [ ] Migrate `/triage` to use port for reads and writes
- [ ] Migrate `/implement` to use port for reads and writes
- [ ] Refactor `work-scanner.ts` to use `WorkItemQueryPort.list()`
- [ ] Verify both skills produce identical outcomes to current behavior
- [ ] Run existing tests + manual validation

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** All checks green. Skills produce same results as before migration.

## Review Checklist

- [ ] **Work Item:** `task.0152` linked in PR body
- [ ] **Spec:** status transitions match development-lifecycle.md
- [ ] **Tests:** existing skill behavior preserved
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management
- Depends on: task.0151

## Attribution

- derekg1729 — design and project definition
