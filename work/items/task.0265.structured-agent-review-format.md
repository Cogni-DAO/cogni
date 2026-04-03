---
id: task.0265
type: task
title: Define and document structured agent review comment format with parseable metadata
status: needs_triage
priority: 1
rank: 99
estimate: 1
summary: Formalize the structured markdown format for agent-to-agent code review comments — machine-parseable JSON in HTML comments, typed issue categories, and GitHub suggestion blocks.
outcome: A documented review format spec that reviewing agents produce and implementing agents parse, enabling automated review feedback loops.
spec_refs:
  - development-lifecycle
project: proj.development-workflows
assignees:
  - cogni-dev
credit:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [agents, workflow, review, documentation]
external_refs:
  - docs/research/agent-contributor-protocol.md
---

# Structured Agent Review Comment Format

## Requirements

- Review comments contain machine-parseable JSON metadata in HTML comments
- Verdict field: `approved` or `changes_requested`
- Blocking issues use typed categories (ARCH_VIOLATION, MISSING_TEST, BREAKING_CHANGE, SECURITY, STYLE)
- Issue references include file path and line number
- GitHub `suggestion` blocks for auto-applicable fixes
- Non-blocking suggestions are clearly separated from blocking issues
- Format is both human-readable (GitHub PR UI) and agent-parseable

## Allowed Changes

- `docs/spec/` — new or updated spec for agent review format
- `.claude/commands/review-implementation.md` — update review command to produce structured format
- `work/items/` — this task item

## Plan

- [ ] Document the review comment schema (JSON metadata + markdown body)
- [ ] Define the category taxonomy (ARCH_VIOLATION, MISSING_TEST, etc.)
- [ ] Update `/review-implementation` command to output structured format
- [ ] Add a parser utility that extracts JSON metadata from review comments
- [ ] Validate format with example review on a test PR

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Review format spec passes validation. Example review comment parses correctly.

## Review Checklist

- [ ] **Work Item:** `task.0265` linked in PR body
- [ ] **Spec:** review format documented as spec
- [ ] **Tests:** parser utility has unit tests
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Research: [docs/research/agent-contributor-protocol.md](../../docs/research/agent-contributor-protocol.md)
- Parent story: [story.0262](story.0262.agent-contributor-protocol.md)

## Attribution

-
