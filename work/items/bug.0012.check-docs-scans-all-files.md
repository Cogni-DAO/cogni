---
id: bug.0012
type: bug
title: "pre-commit check:docs validates all files, not just staged — blocks unrelated commits"
status: needs_triage
priority: 2
estimate: 1
summary: The pre-commit hook runs `pnpm check:docs` on the entire work/ and docs/ tree when any .md file is staged. Untracked or unstaged files with validation errors block commits that don't touch those files.
outcome: pre-commit check:docs only validates staged .md files, matching lint-staged behavior
spec_refs:
assignees: unassigned
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [dx, pre-commit]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 3
---

# pre-commit check:docs validates all files, not just staged — blocks unrelated commits

## Requirements

### Observed

`.husky/pre-commit:3-5` triggers `pnpm check:docs` when any `.md` file is staged:

```bash
if git diff --cached --name-only | grep -q '\.md$'; then
  pnpm check:docs
fi
```

All three validators scan the full tree via `fast-glob`, not just staged files:

- `scripts/validate-docs-metadata.mjs:504` — `fg(["work/items/**/*.md", ...])`
- `scripts/validate-doc-headers.ts:282` — `glob(INCLUDE, { ignore: EXCLUDE })`
- `scripts/validate-agents-md.mjs:405` — `fg(["**/AGENTS.md", ...])`

**Result:** An untracked file like `work/items/task.0009.sandbox-repo-refresh.md` with invalid frontmatter (`status: Not Started`) blocks a commit that only stages `route.ts` + `bug.0011.md`.

### Expected

Pre-commit doc validation should only check staged `.md` files, the same way `lint-staged` only lints staged `.ts`/`.js` files. Unstaged and untracked files should not block commits.

### Reproduction

1. Have any untracked `.md` file in `work/items/` with invalid frontmatter
2. Stage a different `.md` file: `git add work/items/bug.0011.md`
3. `git commit` → hook fails on the untracked file

### Impact

Blocks any developer from committing when another dev's WIP files exist in the working tree. Workaround is `--no-verify` which skips ALL hooks.

## Allowed Changes

- `.husky/pre-commit` — pass staged file list to validators
- `scripts/validate-docs-metadata.mjs` — accept file list argument (or stdin) instead of globbing
- `scripts/validate-doc-headers.ts` — same
- `scripts/validate-agents-md.mjs` — same

## Plan

- [ ] Add `--files` flag (or positional args) to each validator script to accept explicit file list
- [ ] Keep existing glob behavior as default (for `pnpm check:docs` in CI)
- [ ] In `.husky/pre-commit`, pipe `git diff --cached --name-only -- '*.md'` to the validators
- [ ] Alternatively: add `*.md` entries to `.lintstagedrc` and remove the custom `if grep` block entirely

## Validation

**Command:**

```bash
# With an invalid untracked .md file in work/:
git add src/app/api/v1/ai/chat/route.ts work/items/bug.0011.gateway-streaming-truncation.md
git commit -m "test"
```

**Expected:** Commit succeeds — untracked file is not validated.

## Review Checklist

- [ ] **Work Item:** `bug.0012` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
