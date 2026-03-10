---
id: task.0151
type: task
title: "packages/work-items — MarkdownWorkItemAdapter + contract tests"
status: needs_design
priority: 0
rank: 6
estimate: 3
summary: "Implement MarkdownWorkItemAdapter in packages/work-items/src/adapters/markdown/, co-located with the port interfaces. Includes YAML frontmatter parsing, atomic read-modify-write with optimistic concurrency (SHA-256 revision), centralized ID allocation, status transition enforcement, and an adapter-agnostic contract test suite."
outcome: "MarkdownWorkItemAdapter passes all contract tests. get/list/create/patch/transitionStatus work against real markdown files. Optimistic concurrency rejects stale writes. ID allocation prevents collisions. Validator updated to accept relations and external_refs frontmatter."
spec_refs: [identity-model-spec, development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0149
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, infrastructure, adapters]
external_refs:
---

# packages/work-items — MarkdownWorkItemAdapter + contract tests

## Requirements

- `MarkdownWorkItemAdapter` implementing `WorkItemQueryPort` and `WorkItemCommandPort`
- Read path: parse YAML frontmatter from `work/items/*.md` and `work/projects/*.md`
- Write path: atomic read-modify-write preserving markdown body (round-trip safe)
- Revision: SHA-256 of frontmatter YAML, checked on every write
- ID allocation: atomic counter using existing `next-work-id.mjs` logic
- Status transitions validated against the transition table from `@cogni/work-items`
- Relations stored in frontmatter as `relations: [{to: "task.0042", type: "blocks"}]`
- External refs stored in frontmatter as `external_refs: [{system: "github", kind: "pull_request", url: "..."}]`
- Unknown frontmatter keys preserved on write (round-trip safety)
- Contract test suite that validates port invariants (reusable for future adapters)
- Cursor pagination: markdown adapter ignores cursor, returns all matching results

## Allowed Changes

- `packages/work-items/src/adapters/markdown/` (NEW) — adapter implementation
- `packages/work-items/tests/` — contract test suite (adapter-agnostic)
- `scripts/validate-docs-metadata.mjs` — accept `relations` and `external_refs` fields
- Root config files — tsconfig reference, workspace dep, biome overrides

## Plan

- [ ] Add `src/adapters/markdown/` directory inside `packages/work-items/`
- [ ] Implement read path: `get()`, `list()`, `listRelations()`
- [ ] Implement write path: `create()` with ID allocation
- [ ] Implement `patch()` with optimistic concurrency
- [ ] Implement `transitionStatus()` with state machine validation
- [ ] Implement `setAssignees()`, `claim()`, `release()`
- [ ] Implement `upsertRelation()`, `removeRelation()`
- [ ] Implement `upsertExternalRef()`
- [ ] Write contract test suite (adapter-agnostic, parameterized by adapter factory)
- [ ] Update validator to accept new frontmatter fields
- [ ] Verify `pnpm check` passes

## Validation

**Command:**

```bash
pnpm test packages/work-items/tests/
pnpm check
```

**Expected:** All contract tests pass with markdown adapter. Existing checks green.

## Review Checklist

- [ ] **Work Item:** `task.0151` linked in PR body
- [ ] **Spec:** round-trip safety — unknown frontmatter keys preserved
- [ ] **Spec:** optimistic concurrency rejects stale writes
- [ ] **Tests:** contract tests cover all port methods + edge cases (missing file, collision, stale revision)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management
- Depends on: task.0149

## Attribution

- derekg1729 — design and project definition
