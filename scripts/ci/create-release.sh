#!/usr/bin/env bash
set -euo pipefail

# create-release.sh — Human-initiated singleton release PR from preview.
#
# Reads current-sha from .promote-state/ on the deploy branch, creates a
# release/* branch from that SHA, and opens a PR to main. Closes any
# existing release PR with a "Superseded" comment before creating a new one.
#
# Usage: create-release.sh <repo> <deploy-branch> <gh-token>

REPO="${1:?Usage: create-release.sh <repo> <deploy-branch> <gh-token>}"
DEPLOY_BRANCH="${2:-deploy/preview}"
GH_TOKEN="${3:-$GH_TOKEN}"

export GH_TOKEN

echo "📋 Reading current preview SHA from ${DEPLOY_BRANCH}..."

# Read current-sha from deploy branch
git fetch origin "$DEPLOY_BRANCH" --depth=1 2>/dev/null || true
CURRENT_SHA=$(git show "origin/${DEPLOY_BRANCH}:.promote-state/current-sha" 2>/dev/null || true)

if [ -z "$CURRENT_SHA" ]; then
  echo "❌ No current-sha found on ${DEPLOY_BRANCH}. Nothing to release."
  exit 1
fi

SHORT_SHA=$(echo "$CURRENT_SHA" | cut -c1-8)
DATE=$(date -u +%Y%m%d)
RELEASE_BRANCH="release/${DATE}-${SHORT_SHA}"

echo "📦 Creating release from preview SHA: ${SHORT_SHA}"

# Close any existing release/* PRs to main (superseded by this dispatch)
EXISTING_PRS=$(gh pr list \
  --repo "$REPO" \
  --base main \
  --state open \
  --json number,headRefName \
  --jq '.[] | select(.headRefName | startswith("release/")) | .number' 2>/dev/null || true)

for PR_NUM in $EXISTING_PRS; do
  echo "🔄 Closing superseded release PR #${PR_NUM}"
  gh pr close "$PR_NUM" \
    --repo "$REPO" \
    --comment "Superseded by re-dispatch. New release: ${RELEASE_BRANCH}" || true
done

# Create release branch from the preview SHA (release.yml uses fetch-depth: 0, so SHA is available)
git checkout -B "$RELEASE_BRANCH" "$CURRENT_SHA"
git push origin "$RELEASE_BRANCH"

echo "📝 Creating PR..."

# Build PR body with commit list
BODY=$(cat <<EOF
## Release Promotion

**Preview SHA**: \`${CURRENT_SHA}\`
**Created by**: manual dispatch of \`release.yml\`

### Commits in this release

$(git log --oneline origin/main.."$CURRENT_SHA" 2>/dev/null || echo "(could not compute delta)")
EOF
)

# Derive title: single commit = use its subject, multiple = timestamp
COMMITS=$(git log --pretty=%s origin/main.."$CURRENT_SHA" 2>/dev/null || true)
COUNT=$(printf "%s\n" "$COMMITS" | grep -c . 2>/dev/null || echo "0")
if [ "$COUNT" -eq 1 ]; then
  TITLE=$(printf "%s\n" "$COMMITS" | head -n1 | sed 's/ (#[0-9]\+)$//')
else
  TITLE="release: ${DATE}-${SHORT_SHA}"
fi

gh pr create \
  --repo "$REPO" \
  --base main \
  --head "$RELEASE_BRANCH" \
  --title "$TITLE" \
  --body "$BODY"

echo "✅ Release PR created: ${RELEASE_BRANCH} → main"
