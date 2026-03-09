#!/usr/bin/env bash
set -euo pipefail

# Usage: heartbeat-sync.sh <branch> <worktree-dir>
# Example: heartbeat-sync.sh gov/ideas /workspace/ideas-repo
#
# Bootstrap creates worktrees that own each gov branch:
#   /workspace/ideas-repo  → gov/ideas
#   /workspace/dev-repo    → gov/development
# Worktrees share .git with parent — fetch/push use the same authenticated remote.

TARGET_BRANCH="${1:?Usage: heartbeat-sync.sh <branch> <worktree-dir>}"
WORKTREE_DIR="${2:?Usage: heartbeat-sync.sh <branch> <worktree-dir>}"

cd "$WORKTREE_DIR" || { echo "BLOCKED: $WORKTREE_DIR not found — run bootstrap"; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "BLOCKED: $WORKTREE_DIR is not a git repo — run bootstrap"; exit 1; }

git fetch --all --prune || { echo "FAIL: git fetch failed"; exit 1; }
git rev-parse --verify "origin/staging" >/dev/null || { echo "FAIL: origin/staging not found"; exit 1; }
git rev-parse --verify "origin/$TARGET_BRANCH" >/dev/null || { echo "FAIL: origin/$TARGET_BRANCH not found"; exit 1; }

git reset --hard "origin/$TARGET_BRANCH" || { echo "FAIL: reset to origin/$TARGET_BRANCH failed"; exit 1; }

if git merge --no-edit origin/staging; then
  git push origin "$TARGET_BRANCH" || { echo "FAIL: push $TARGET_BRANCH failed"; exit 1; }
  AHEAD=$(git rev-list --count origin/staging..HEAD)
  echo "OK: $TARGET_BRANCH merged with staging and pushed ($AHEAD ahead)"
else
  git merge --abort 2>/dev/null || true
  echo "CONFLICT: $TARGET_BRANCH has merge conflicts with staging — needs manual resolution"
  exit 2
fi
