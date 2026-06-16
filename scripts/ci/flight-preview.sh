#!/usr/bin/env bash
set -euo pipefail

# flight-preview.sh — request a preview flight for a merged-PR SHA.
#
# This script does NOT perform the deploy — it is a dispatcher. It delegates
# the actual promote/deploy/verify/e2e work to promote-and-deploy.yml via
# `gh workflow run`, scoped to env=preview.
#
# Called by flight-preview.yml after a PR merges to main (or via manual
# workflow_dispatch). The PR merge gate is authoritative — no external CI
# polling happens here. Serialization of bursty merges is handled by the
# `flight-preview` workflow concurrency group and promote-and-deploy.yml's
# own per-env concurrency group; preview always tracks the latest merged SHA
# (latest-wins), with no human-review hold.
#
# Exit codes:
#   0 — flight dispatched (promote-and-deploy kicked off for the given SHA)
#   1 — hard failure (missing token, unexpected error)
#
# Usage: flight-preview.sh <sha> <repo> <deploy-branch> <gh-token> <build-sha> [nodes-csv]
#
# GH Actions integration: when invoked inside a GitHub Actions step, the
# runner sets $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY. This script writes a
# `status=dispatched` line to $GITHUB_OUTPUT and a markdown banner to
# $GITHUB_STEP_SUMMARY so the workflow can gate downstream jobs on the output
# and operators get a visible outcome in the job summary.
#
# Positional args 1–4 are required; arg 5 (build-sha = PR branch head SHA)
# is required for squash-merge correctness but has an env + arg-1 fallback
# to keep CLI/test callers working. If you add a new caller, pass build-sha
# explicitly — the bug.0361 SHA-mismatch regression returns if it silently
# falls back to SHA (the main merge commit). Arg 3 (deploy-branch) is retained
# for caller/signature compatibility but is no longer used (the lease it once
# guarded was removed).

SHA="${1:?Usage: flight-preview.sh <sha> <repo> <deploy-branch> <gh-token> <build-sha> [nodes-csv]}"
REPO="${2:?}"
DEPLOY_BRANCH="${3:-deploy/preview}"  # retained for compat; unused
GH_TOKEN="${4:-${GH_TOKEN:-}}"
BUILD_SHA="${5:-${BUILD_SHA:-$SHA}}"
# task.0376: scope promote-and-deploy.yml's matrix to affected nodes.
# Empty (legacy callers) → promote-and-deploy.yml falls back to ALL_TARGETS.
NODES_CSV="${6:-${NODES_CSV:-}}"

# Emit `status=<value>` to $GITHUB_OUTPUT when running under Actions.
# No-op from a plain shell so CLI/test callers aren't surprised.
emit_status() {
  local value="$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "status=${value}" >> "$GITHUB_OUTPUT"
  fi
}

# Append a markdown outcome block to $GITHUB_STEP_SUMMARY when running
# under Actions.
emit_summary() {
  local outcome="$1" detail="$2"
  if [ -z "${GITHUB_STEP_SUMMARY:-}" ]; then
    return 0
  fi
  {
    echo "## Flight Preview"
    echo ""
    echo "- Outcome: **${outcome}**"
    echo "- SHA: \`${SHORT_SHA:-unknown}\`"
    echo "- Detail: ${detail}"
  } >> "$GITHUB_STEP_SUMMARY"
}

if [ -z "$GH_TOKEN" ]; then
  echo "❌ GH_TOKEN required (arg 4 or env)"
  exit 1
fi
export GH_TOKEN

SHORT_SHA="${SHA:0:8}"

echo "🚀 Dispatching promote-and-deploy env=preview for ${SHORT_SHA} (nodes=${NODES_CSV:-all})..."
gh workflow run promote-and-deploy.yml \
  --repo "$REPO" \
  --ref main \
  -f environment=preview \
  -f source_sha="$SHA" \
  -f build_sha="$BUILD_SHA" \
  -f nodes="$NODES_CSV" \
  -f skip_infra=true
echo "✅ Preview flight dispatched for ${SHORT_SHA}"
emit_status "dispatched"
emit_summary "dispatched" "promote-and-deploy kicked off; \`deploy-preview\` job in this workflow will run."
exit 0
