#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# promote-to-production.sh — Open a PR that promotes deploy/preview state
# into deploy/production.
#
# Contract:
#   - Reads image digests from deploy/preview overlays
#   - Writes those digests into deploy/production overlays (env-specific
#     fields like namespace / APP_ENV are preserved on production)
#   - Syncs infra/k8s/base and infra/catalog from main (code-truth)
#   - Copies .promote-state/source-sha-by-app.json forward from preview →
#     production so verify-buildsha.sh can assert per-app contract on
#     production's cross-PR mixed-SHA overlay (bug.0321 Fix 4). Silently
#     skipped on first-deploy bootstrap when the file is absent on preview.
#   - Writes the single-SHA marker .promote-state/source-sha for
#     promote-and-deploy.yml's push trigger
#   - Opens a review PR against deploy/production with a commit delta and
#     validation notes so a human can inspect before promoting
#
# Usage: promote-to-production.sh <repo> <gh-token>

set -euo pipefail

REPO="${1:?Usage: promote-to-production.sh <repo> <gh-token>}"
GH_TOKEN="${2:-${GH_TOKEN:-}}"
export GH_TOKEN

PREVIEW_BRANCH="deploy/preview"
PRODUCTION_BRANCH="deploy/production"
# Apps promoted by digest. sandbox-openclaw is intentionally excluded —
# it still rides a mutable `:latest` tag (proj.cicd-services-gitops blocker #10).
# Keep in sync with the overlay directories under infra/k8s/overlays/preview/
# whenever a new node is introduced.
APPS=(operator poly resy scheduler-worker)

# Extract the first and (optional) second image digest from a preview
# overlay kustomization.yaml. The first entry is the app image; the
# second, when present, is the migrator image.
extract_digests() {
  local file="$1"
  python3 - "$file" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
# Match image entries with a digest line under the `images:` block.
matches = re.findall(
    r'-\s+name:\s*(\S+)\s+newName:\s*(\S+)\s+digest:\s*"([^"]+)"',
    text,
)
for name, new_name, digest in matches:
    print(f"{new_name}@{digest}")
PY
}

echo "📋 Fetching deploy branches"
git fetch origin "$PREVIEW_BRANCH" --depth=1
git fetch origin "$PRODUCTION_BRANCH" --depth=1
git fetch origin main --depth=50

PREVIEW_SHA=$(git rev-parse "origin/${PREVIEW_BRANCH}")
PRODUCTION_SHA=$(git rev-parse "origin/${PRODUCTION_BRANCH}")

# Source-artifact SHA = preview's current-sha (the PR head that was
# flighted + reviewed). Fall back to the preview branch tip if the
# file is missing (bootstrap case).
SOURCE_SHA=$(git show "origin/${PREVIEW_BRANCH}:.promote-state/current-sha" 2>/dev/null || true)
if [ -z "$SOURCE_SHA" ]; then
  echo "⚠️  No .promote-state/current-sha on ${PREVIEW_BRANCH} — using branch tip"
  SOURCE_SHA="$PREVIEW_SHA"
fi
SHORT_SHA=$(echo "$SOURCE_SHA" | cut -c1-8)
DATE=$(date -u +%Y%m%d)
PROMOTE_BRANCH="promote-prod/${DATE}-${SHORT_SHA}"

echo "📦 Preview current-sha: ${SOURCE_SHA}"
echo "📦 Production tip:      ${PRODUCTION_SHA}"
echo "📦 Promotion branch:    ${PROMOTE_BRANCH}"

# The helper script we're about to invoke lives on `main`, not on the
# `deploy/production` tree (which holds only infra state). Save it out
# before we reset the working tree so we can still invoke it after the
# branch switch.
TOOLS_DIR=$(mktemp -d)
cp scripts/ci/promote-k8s-image.sh "$TOOLS_DIR/promote-k8s-image.sh"
chmod +x "$TOOLS_DIR/promote-k8s-image.sh"

# Check out production as the base and reset our workspace to it.
git checkout -B "$PROMOTE_BRANCH" "origin/${PRODUCTION_BRANCH}"

# Sync base/catalog from main — these are code-truth and must not diverge
# between preview and production. `git rm -rf` first so deletions on main
# propagate into the promotion PR.
echo "🔄 Syncing infra/k8s/base + infra/catalog from main"
git rm -rf --quiet --ignore-unmatch infra/k8s/base infra/catalog
git checkout "origin/main" -- infra/k8s/base infra/catalog

# Copy digests from preview → production overlays, one app at a time.
echo "🔄 Copying image digests from ${PREVIEW_BRANCH} → ${PRODUCTION_BRANCH}"
for APP in "${APPS[@]}"; do
  PREVIEW_FILE=$(mktemp)
  git show "origin/${PREVIEW_BRANCH}:infra/k8s/overlays/preview/${APP}/kustomization.yaml" \
    > "$PREVIEW_FILE" 2>/dev/null || { echo "  ⚠️  skip ${APP} (no preview overlay)"; rm -f "$PREVIEW_FILE"; continue; }

  mapfile -t DIGESTS < <(extract_digests "$PREVIEW_FILE")
  rm -f "$PREVIEW_FILE"

  if [ "${#DIGESTS[@]}" -eq 0 ]; then
    echo "  ⚠️  skip ${APP} (no digests found on preview)"
    continue
  fi

  APP_DIGEST="${DIGESTS[0]}"
  MIGRATOR_DIGEST="${DIGESTS[1]:-}"

  echo "  ➜ ${APP}: ${APP_DIGEST}"
  if [ -n "$MIGRATOR_DIGEST" ]; then
    echo "    migrator: ${MIGRATOR_DIGEST}"
    "$TOOLS_DIR/promote-k8s-image.sh" --no-commit \
      --env production \
      --app "$APP" \
      --digest "$APP_DIGEST" \
      --migrator-digest "$MIGRATOR_DIGEST"
  else
    "$TOOLS_DIR/promote-k8s-image.sh" --no-commit \
      --env production \
      --app "$APP" \
      --digest "$APP_DIGEST"
  fi
done

# Record the source-artifact SHA for promote-and-deploy.yml's push trigger.
mkdir -p .promote-state
echo "$SOURCE_SHA" > .promote-state/source-sha

# Copy the per-app source-SHA map forward from preview → production
# (bug.0321 Fix 4). Production promotions are cross-PR: different nodes
# may have been built from different PR head SHAs (affected-only CI).
# verify-buildsha.sh reads this map in SOURCE_SHA_MAP mode to assert each
# node's /version.buildSha matches the SHA that built that node's digest.
# On first-deploy bootstrap, preview may not yet have the file — skip
# silently; verify-buildsha.sh falls back to single-SHA mode.
if git show "origin/${PREVIEW_BRANCH}:.promote-state/source-sha-by-app.json" > .promote-state/source-sha-by-app.json 2>/dev/null; then
  echo "🔄 Copied .promote-state/source-sha-by-app.json from ${PREVIEW_BRANCH}"
else
  echo "⚠️  No .promote-state/source-sha-by-app.json on ${PREVIEW_BRANCH} (first-deploy / pre-Fix-4)"
  rm -f .promote-state/source-sha-by-app.json
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A

if git diff --cached --quiet; then
  echo "ℹ️  Production already matches preview — nothing to promote."
  exit 0
fi

git commit -m "promote: production ${SHORT_SHA}"
git push --force-with-lease "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" \
  "${PROMOTE_BRANCH}:${PROMOTE_BRANCH}"

# Close any prior open promote-prod/* PRs — superseded by this dispatch.
EXISTING=$(gh pr list --repo "$REPO" --base "$PRODUCTION_BRANCH" --state open \
  --json number,headRefName \
  --jq '.[] | select(.headRefName | startswith("promote-prod/")) | .number' 2>/dev/null || true)
for PR in $EXISTING; do
  echo "🔄 Closing superseded promote-prod PR #${PR}"
  gh pr close "$PR" --repo "$REPO" \
    --comment "Superseded by ${PROMOTE_BRANCH}" || true
done

# Build the PR body. Commit delta = main commits between production
# current-sha and preview current-sha.
PREV_CURRENT=$(git show "origin/${PRODUCTION_BRANCH}:.promote-state/source-sha" 2>/dev/null || true)
COMMITS_SECTION="(no prior production source-sha — first promotion)"
if [ -n "$PREV_CURRENT" ]; then
  DELTA=$(git log --oneline "${PREV_CURRENT}..${SOURCE_SHA}" 2>/dev/null || echo "(could not compute delta)")
  if [ -n "$DELTA" ]; then
    COMMITS_SECTION="$DELTA"
  fi
fi

BODY=$(cat <<EOF
## Production Promotion

Promotes validated preview digests → \`deploy/production\`.

- **Source SHA**: \`${SOURCE_SHA}\` (preview current-sha)
- **Previous production source**: \`${PREV_CURRENT:-none}\`
- **Dispatched by**: \`promote-to-production.yml\`

### Commits since last production promotion

\`\`\`
${COMMITS_SECTION}
\`\`\`

### Validation on preview

- Preview deploy SHA: \`${PREVIEW_SHA}\`
- Grafana preview dashboard: fill in after first prod run
- Candidate-flight scorecard: fill in after first prod run

Merging this PR pushes to \`${PRODUCTION_BRANCH}\`; \`promote-and-deploy.yml\`
fires on that push and rolls production via Argo CD.
EOF
)

TITLE="promote: production ${DATE}-${SHORT_SHA}"

gh pr create --repo "$REPO" \
  --base "$PRODUCTION_BRANCH" \
  --head "$PROMOTE_BRANCH" \
  --title "$TITLE" \
  --body "$BODY"

echo "✅ Promotion PR opened: ${PROMOTE_BRANCH} → ${PRODUCTION_BRANCH}"
