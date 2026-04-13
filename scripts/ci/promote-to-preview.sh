#!/usr/bin/env bash
set -euo pipefail

# promote-to-preview.sh — CI-gated preview promotion with locked snapshot model.
#
# Called by e2e.yml after canary E2E passes. Checks CI status (single call,
# no polling), then either deploys to preview or records a candidate SHA.
#
# Preview is a locked snapshot lane for human review:
#   - unlocked: deploy this SHA, lock for review
#   - reviewing: record as candidate, don't disturb current review
#
# State stored in .promote-state/ on deploy/preview branch.
# Written via git commit+push.
#
# Usage: promote-to-preview.sh <sha> <repo> <deploy-branch> <gh-token>

SHA="${1:?Usage: promote-to-preview.sh <sha> <repo> <deploy-branch> <gh-token>}"
REPO="${2:?}"
DEPLOY_BRANCH="${3:-deploy/preview}"
GH_TOKEN="${4:-$GH_TOKEN}"

export GH_TOKEN

echo "🔍 Checking CI status for SHA ${SHA:0:8}..."

# Single gh run list call — no polling. Filter by headSha (--commit filters by message, not SHA).
CI_CONCLUSION=$(gh run list \
  --repo "$REPO" \
  --workflow=ci.yaml \
  --branch=canary \
  --status=completed \
  --json headSha,conclusion \
  --jq '[.[] | select(.headSha == "'"$SHA"'")] | .[0].conclusion // empty' 2>/dev/null || true)

if [ -z "$CI_CONCLUSION" ]; then
  echo "⏳ CI not yet completed for ${SHA:0:8} — skipping. Next canary push retries."
  exit 0
fi

if [ "$CI_CONCLUSION" != "success" ]; then
  echo "❌ CI failed ($CI_CONCLUSION) for ${SHA:0:8} — not eligible. Skipping."
  exit 0
fi

echo "✅ CI passed for ${SHA:0:8}. Checking preview state..."

# Read review-state from deploy branch (no full checkout, just git show)
git fetch origin "${DEPLOY_BRANCH}:refs/remotes/origin/${DEPLOY_BRANCH}" --depth=1 2>/dev/null || true

REVIEW_STATE=$(git show "origin/${DEPLOY_BRANCH}:.promote-state/review-state" 2>/dev/null || echo "unlocked")

if [ "$REVIEW_STATE" = "reviewing" ]; then
  echo "🔒 Preview is locked for review. Recording ${SHA:0:8} as candidate."

  # Clone deploy branch to temp dir, write candidate, push
  TMPDIR=$(mktemp -d)
  git clone --depth=1 --branch="$DEPLOY_BRANCH" "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$TMPDIR" 2>/dev/null
  mkdir -p "$TMPDIR/.promote-state"
  echo "$SHA" > "$TMPDIR/.promote-state/candidate-sha"

  cd "$TMPDIR"
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git add .promote-state/candidate-sha
  if ! git diff --cached --quiet; then
    git commit -m "promote-state: candidate ${SHA:0:8} (preview locked)"
    git push origin HEAD
    echo "✅ Candidate SHA written to ${DEPLOY_BRANCH}"
  else
    echo "ℹ️  Candidate SHA unchanged"
  fi
  rm -rf "$TMPDIR"
  exit 0
fi

# Preview is unlocked — deploy this SHA
echo "🚀 Preview unlocked. Deploying ${SHA:0:8} to preview..."

TMPDIR=$(mktemp -d)
git clone --depth=1 --branch="$DEPLOY_BRANCH" "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$TMPDIR" 2>/dev/null
mkdir -p "$TMPDIR/.promote-state"
echo "$SHA" > "$TMPDIR/.promote-state/current-sha"
echo "reviewing" > "$TMPDIR/.promote-state/review-state"
# Clear candidate — this SHA is now current
rm -f "$TMPDIR/.promote-state/candidate-sha"

cd "$TMPDIR"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A .promote-state/
git commit -m "promote-state: deploy ${SHA:0:8} to preview (reviewing)"
git push origin HEAD
rm -rf "$TMPDIR"

echo "✅ Preview state updated. Dispatching promote-and-deploy..."

# Dispatch promote-and-deploy for preview environment
gh workflow run promote-and-deploy.yml \
  --repo "$REPO" \
  --ref main \
  -f environment=preview \
  -f source_sha="$SHA"

echo "✅ Preview promotion dispatched for ${SHA:0:8}"
