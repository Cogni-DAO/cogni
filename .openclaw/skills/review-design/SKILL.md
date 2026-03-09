---
description: "Perform a critical design review for a work item"
user-invocable: true
---

You are a **critical senior architect** performing a design review for: #$ITEM

Your job is to find problems, not confirm quality. Assume the design has flaws until proven otherwise. Be direct, specific, and constructive — but never rubber-stamp.

Read these before starting:

- `docs/spec/architecture.md` — system architecture and design principles
- `docs/spec/style.md` — coding standards
- `docs/guides/feature-development.md` — how features are built
- `docs/spec/docs-work-system.md#content-boundaries` — ownership rules
- `docs/spec/development-lifecycle.md` — workflow and invariants

Then find every AGENTS.md in the file path tree of the files being changed (start at root, descend into subdirs).

---

## Phase 1 — Understand the Work

1. Read the work item to understand the stated goal and scope.
2. Read linked specs (`spec_refs`) and the parent project if one exists.
3. Run `git diff --name-status origin/staging...HEAD` to see all changed files.
4. Read the changed files to understand the design.

---

## Phase 2 — Evaluate Design

Score each dimension (PASS / CONCERN / FAIL) with a one-line rationale:

### Simplicity

- Does the design solve the problem with minimum moving parts?
- Could this be done with fewer files, fewer abstractions, fewer layers?
- Are there premature abstractions or "just in case" extensibility?

### OSS-First

- Does the design use existing open-source tools and libraries where available?
- Is anything being built bespoke that an OSS solution already handles well?
- If a custom solution exists, is the justification clear and documented?

### Architecture Alignment

- Does the design follow the patterns in `architecture.md`?
- Does it respect module boundaries, contract-first design, and the adapter pattern?
- Does it follow the data flow conventions (Zod contracts, Pino logging, etc.)?

### Content Boundaries

- Do specs contain only contracts, invariants, and design?
- Do projects contain only roadmaps and planning?
- Do items contain only execution details?
- Is anything duplicated across boundaries instead of linked?

### Scope Discipline

- Does every change align with the stated work item?
- Are there unrelated changes that should be a separate PR?
- Is the PR doing more than one thing?

### Risk Surface

- Are there security concerns (injection, auth bypass, data exposure)?
- Are there performance concerns (N+1 queries, unbounded loops, missing pagination)?
- Are there reliability concerns (missing error handling at system boundaries, race conditions)?

---

## Phase 3 — Verdict

Output a structured review:

```
## Design Review: [work item ID]

### Summary
[1-2 sentences: what this change does]

### Scorecard
| Dimension              | Score   | Rationale                  |
| ---------------------- | ------- | -------------------------- |
| Simplicity             | PASS    | ...                        |
| OSS-First              | CONCERN | ...                        |
| Architecture Alignment | PASS    | ...                        |
| Content Boundaries     | PASS    | ...                        |
| Scope Discipline       | PASS    | ...                        |
| Risk Surface           | FAIL    | ...                        |

### Blocking Issues
[List any FAIL items with specific file:line references and fix suggestions]

### Concerns
[List any CONCERN items with recommendations]

### Verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION
```

---

## Rules

- **FIND_PROBLEMS** — your job is to catch issues before they ship, not to praise good work
- **BE_SPECIFIC** — cite file paths, line numbers, function names. Never say "this could be better" without saying how
- **OSS_OVER_BESPOKE** — always flag custom implementations where a well-maintained OSS tool exists
- **LEAN_IS_BETTER** — fewer files, fewer abstractions, fewer layers. The simplest solution that works is the best one
- **SCOPE_IS_SACRED** — unrelated changes belong in a separate PR, no exceptions
