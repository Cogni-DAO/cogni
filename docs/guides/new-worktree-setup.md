---
id: new-worktree-setup
type: guide
title: Git Worktree Testing Setup
status: active
trust: draft
summary: How to set up a git worktree for isolated branch work with full test support.
read_when: Starting work on a new branch, setting up a clean development environment.
owner: derekg1729
created: 2026-02-12
verified: 2026-02-12
tags: [dev, git, testing]
---

# Git Worktree Testing Setup

When working on isolated branches (e.g., bug fixes, experiments) without disturbing your main checkout, use a git worktree.

## Setup

```bash
# 1. Create worktree with new branch off current HEAD
git worktree add ../cogni-template-worktrees/<branch-name> -b <branch-name> HEAD

# 2. Change to the worktree
cd ../cogni-template-worktrees/<branch-name>

# 3. Install dependencies (worktrees share .git but not node_modules)
pnpm install --offline --frozen-lockfile

# 4. Build workspace packages (required before tests can resolve @cogni/* imports)
pnpm packages:build

# 5. Verify
pnpm check
pnpm test
```

## Why `packages:build` is Required

Workspace packages (`packages/ai-core`, `packages/scheduler-core`, etc.) publish TypeScript declarations from `dist/`. Without building, Vite/vitest cannot resolve their entry points and tests fail with:

```
Error: Failed to resolve entry for package "@cogni/scheduler-core"
```

The main checkout usually has these built already. A fresh worktree does not.

## Cleanup

```bash
# Remove worktree when done (from main checkout)
git worktree remove ../cogni-template-worktrees/<branch-name>
```
