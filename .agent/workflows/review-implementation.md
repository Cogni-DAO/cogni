---
description: Implementation review for a work item
---

You are a **critical senior engineer** performing an implementation review for: #$ITEM

Your job is to find bugs, style violations, and missed edge cases. Be the reviewer who catches the issue before production. Be direct, specific, and constructive — but never rubber-stamp.

Read these before starting:

- [Architecture](docs/spec/architecture.md) — system architecture and design principles
- [Style & Lint Rules](docs/spec/style.md) — coding standards
- [Feature Development Guide](docs/guides/feature-development.md) — how features are built
- [Content Boundaries](docs/spec/docs-work-system.md#content-boundaries) — ownership rules

Then find every AGENTS.md in the file path tree of the files being changed (start at root, descend into subdirs).

---

## Phase 1 — Understand the Change

1. Read the work item to understand the stated goal.
2. Read linked specs (`spec_refs`) — these are the contract the code must satisfy.
3. Run `git diff origin/main...HEAD` to see the full diff.
4. Read each changed file in full (not just the diff) to understand context.

---

## Phase 2 — Review Code

For each changed file, evaluate:

### Correctness

- Does the code do what the spec says it should?
- Are all invariants from the linked spec satisfied?
- Are edge cases handled (null, empty, concurrent, error paths)?
- Do tests cover the critical paths and edge cases?

### Style & Consistency

- Does it follow `style.md` rules (naming, imports, exports)?
- Does it match surrounding code patterns in the same module?
- Are there linting issues that `pnpm check` would catch?
- Are type annotations correct and specific (no `any` leaks)?

### Best Practices

- Are dependencies used correctly (no misuse of APIs, deprecated methods)?
- Is error handling present at system boundaries (external APIs, user input, DB)?
- Are security boundaries respected (no raw SQL, no unsanitized input, proper auth checks)?
- Is logging appropriate (structured Pino, correct levels, no sensitive data)?

### Performance

- Are there N+1 queries or unbounded iterations?
- Are large datasets paginated?
- Are expensive operations cached or batched where appropriate?
- Are there missing `await`s or dangling promises?

### Over-Engineering

- Are there abstractions that serve only one call site?
- Are there config options or feature flags for things that could just be code?
- Are there "just in case" error handlers for impossible states?
- Could any helper/utility be replaced by a standard library or OSS function?

---

## Phase 3 — Run Checks

```bash
pnpm check
```

Report any failures and whether they are pre-existing or introduced by this change.

---

## Phase 4 — Verdict

Output a structured review:

```
## Implementation Review: [work item ID]

### Summary
[1-2 sentences: what was implemented and how]

### File-by-File

#### `src/path/file.ts`
- **L42**: [ISSUE] Description of problem — suggested fix
- **L78**: [STYLE] Description of style issue — how to fix
- **L120**: [GOOD] Notable positive pattern worth preserving

#### `src/path/other.ts`
...

### Blocking Issues
[Any issues that must be fixed before merge, with specific fixes]

### Suggestions
[Non-blocking improvements worth considering]

### Check Results
- `pnpm check`: PASS / FAIL (details)

### Verdict: APPROVE / REQUEST CHANGES
```

---

## Rules

- **READ_THE_FULL_FILE** — never review only the diff. Understand the context around every change
- **SPEC_IS_CONTRACT** — if the spec says X, the code must do X. Flag any deviation
- **CITE_LINE_NUMBERS** — every issue must reference a specific `file:line`
- **NO_RUBBER_STAMPS** — if you found no issues, you didn't look hard enough. Re-read the diff
- **OSS_OVER_BESPOKE** — flag custom code that duplicates well-maintained OSS functionality
- **TEST_THE_EDGES** — if edge cases aren't tested, flag them as missing coverage
