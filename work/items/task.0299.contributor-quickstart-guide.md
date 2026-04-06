---
id: task.0299
type: task
title: "Contributor quickstart — 'update a node graph and see it on canary'"
status: needs_closeout
priority: 1
rank: 5
estimate: 2
summary: "Add a quickstart guide for the simplest meaningful contribution: update a node graph package, validate locally, push, see it deploy to canary."
outcome: "An external AI agent or human contributor can follow the quickstart and ship a graph update to canary in under 30 minutes."
spec_refs:
  - langgraph-patterns-spec
assignees: derekg1729
credit:
project:
branch: feat/task-0299-contributor-quickstart
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [contributor, onboarding, langgraph, dx]
external_refs:
---

# Contributor Quickstart — "Update a Node Graph and See It on Canary"

## Requirements

- Quickstart guide at `docs/guides/contributor-quickstart.md` under 80 lines
- Concrete walkthrough: "add knowledge_search tool to poly's brain graph"
- The One Gotcha documented: `pnpm packages:build` before `pnpm check:fast`
- CONTRIBUTING.md links to quickstart at top
- CONTRIBUTING.md branch references updated from staging → canary

## Allowed Changes

- `docs/guides/contributor-quickstart.md` — NEW
- `CONTRIBUTING.md` — quickstart link + staging→canary fix
- `work/items/task.0299.contributor-quickstart-guide.md` — this file

## Plan

- [x] Create `docs/guides/contributor-quickstart.md` with 9-step path
- [x] Add quickstart link to top of CONTRIBUTING.md
- [x] Fix CONTRIBUTING.md staging→canary references
- [ ] Run `pnpm check:docs` — clean
- [ ] Push + PR

## Validation

```bash
pnpm check:docs
```

**Expected:** All doc checks pass.

## Review Checklist

- [ ] **Work Item:** `task.0299` linked in PR body
- [ ] **Spec:** langgraph-patterns-spec invariants referenced
- [ ] **Tests:** doc validation passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: PR #716 (contributor CLI + skill)
- Spec: langgraph-patterns-spec

## Attribution

-
