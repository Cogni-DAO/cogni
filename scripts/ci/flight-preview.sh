#!/usr/bin/env bash
set -euo pipefail

# flight-preview.sh — request a preview flight for a merged-PR SHA.
#
# This script does NOT perform the deploy — it is a gate + dispatcher. It
# reads the preview review-state lease, claims it atomically if unlocked,
# and then delegates the actual promote/deploy/verify/e2e work to
# promote-and-deploy.yml via `gh workflow run`.
#
# Called by flight-preview.yml after a PR merges to main (or via manual
# workflow_dispatch). The PR merge gate is authoritative — no external CI
# polling happens here.
#
# Preview review-state contract (files under .promote-state/ on deploy/preview):
#   unlocked   — no flight in progress; safe to claim the lease
#   dispatching— a flight has been dispatched but has not yet reached E2E success
#   reviewing  — last dispatched flight reached E2E success; human review pending
#
# On every invocation:
#   1. candidate-sha is updated unconditionally (high-water mark)
#   2. if review-state is reviewing|dispatching: queue only, no dispatch
#   3. if review-state is unlocked: atomically claim the lease (set review-state
#      = dispatching in the same commit as candidate-sha) and dispatch
#      promote-and-deploy env=preview. promote-and-deploy's lock-preview-on-success
#      step transitions dispatching → reviewing post-E2E.
#
# If two workers race the unlocked → dispatching transition, push_with_retry
# --reread-lease rebases and re-reads review-state. The loser sees dispatching
# and deterministically demotes to queue-only by setting FLIGHT_LEASE_LOST=1.
#
# Exit codes:
#   0 — flight dispatched (promote-and-deploy kicked off for the given SHA)
#   1 — hard failure (missing token, push retries exhausted, unexpected error)
#   2 — queued-only (lease locked; candidate-sha recorded but no dispatch).
#       Callers MUST treat this as distinct from 0; a non-dispatched run
#       should surface as a visibly-skipped deploy in the workflow UI, not
#       as a green success.
#
# Usage: flight-preview.sh <sha> <repo> <deploy-branch> <gh-token> <build-sha>
#
# GH Actions integration: when invoked inside a GitHub Actions step, the
# runner sets $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY. This script writes
# a `status=dispatched|queued` line to $GITHUB_OUTPUT and a markdown
# banner to $GITHUB_STEP_SUMMARY at every terminal path, so the workflow
# can gate downstream jobs on the output and operators get a visible
# outcome in the job summary. Workflow step becomes pure orchestration.
#
# Positional args 1–4 are required; arg 5 (build-sha = PR branch head SHA)
# is required for squash-merge correctness but has an env + arg-1 fallback
# to keep CLI/test callers working. If you add a new caller, pass build-sha
# explicitly — the bug.0361 SHA-mismatch regression returns if it silently
# falls back to SHA (the main merge commit).

SHA="${1:?Usage: flight-preview.sh <sha> <repo> <deploy-branch> <gh-token> <build-sha>}"
REPO="${2:?}"
DEPLOY_BRANCH="${3:-deploy/preview}"
GH_TOKEN="${4:-${GH_TOKEN:-}}"
# Explicit positional arg > env var > SHA fallback. The env-var leg keeps
# flight-preview.yml's current `BUILD_SHA:` step env working during migration;
# the SHA fallback is only correct on direct-push-to-main where source_sha
# and build_sha are the same commit.
BUILD_SHA="${5:-${BUILD_SHA:-$SHA}}"

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
    echo "- Deploy branch: \`${DEPLOY_BRANCH}\`"
    echo "- Detail: ${detail}"
  } >> "$GITHUB_STEP_SUMMARY"
}

if [ -z "$GH_TOKEN" ]; then
  echo "❌ GH_TOKEN required (arg 4 or env)"
  exit 1
fi
export GH_TOKEN

SHORT_SHA="${SHA:0:8}"
FLIGHT_LEASE_LOST=0

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "🔍 Flighting ${SHORT_SHA} to preview (cloning ${DEPLOY_BRANCH})..."
git clone --depth=1 --branch="$DEPLOY_BRANCH" \
  "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "$TMPDIR" 2>/dev/null
cd "$TMPDIR"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# -----------------------------------------------------------------------------
# Build the commit for this attempt. apply_intent is re-called on each rebase
# inside push_with_retry so the staged content always targets the latest tip.
# -----------------------------------------------------------------------------
apply_intent() {
  mkdir -p .promote-state
  echo "$SHA" > .promote-state/candidate-sha  # always high-water mark

  local state_on_tip
  state_on_tip=$(cat .promote-state/review-state 2>/dev/null || echo unlocked)

  if [ "$state_on_tip" = "unlocked" ] && [ "$FLIGHT_LEASE_LOST" = "0" ]; then
    # Claim the lease atomically with the candidate-sha update.
    echo "dispatching" > .promote-state/review-state
    COMMIT_MSG="promote-state: dispatch ${SHORT_SHA} to preview (lease claimed)"
    WILL_DISPATCH=1
  else
    # Already locked OR we lost a prior race — queue-only path.
    COMMIT_MSG="promote-state: queue candidate ${SHORT_SHA} (preview ${state_on_tip})"
    WILL_DISPATCH=0
  fi
}

# push_with_retry supports the --reread-lease contract described in task.0293:
# on conflict, rebase + re-apply; if someone else grabbed the lease, demote to
# queue-only so we don't double-dispatch.
push_with_retry() {
  local max=5
  for attempt in $(seq 1 $max); do
    apply_intent
    git add -A .promote-state/

    if git diff --cached --quiet; then
      echo "ℹ️  Converged: no state change needed on current tip"
      return 0
    fi

    git commit -m "$COMMIT_MSG" >/dev/null

    if git push origin "HEAD:${DEPLOY_BRANCH}" 2>&1; then
      return 0
    fi

    echo "push conflict (attempt ${attempt}/${max}), rebasing..."
    git fetch origin "$DEPLOY_BRANCH"
    git reset --hard "origin/$DEPLOY_BRANCH"

    # Re-read on the new tip. If the lease is now claimed by someone else,
    # the next apply_intent will see that and take the queue-only path.
    local new_state
    new_state=$(cat .promote-state/review-state 2>/dev/null || echo unlocked)
    if [ "$new_state" != "unlocked" ] && [ "$WILL_DISPATCH" = "1" ]; then
      echo "🏁 Lost lease race — ${new_state} already set. Demoting to queue-only."
      FLIGHT_LEASE_LOST=1
    fi
  done

  echo "❌ push_with_retry exhausted ${max} attempts"
  return 1
}

push_with_retry

if [ "${WILL_DISPATCH:-0}" = "1" ] && [ "$FLIGHT_LEASE_LOST" = "0" ]; then
  echo "🚀 Dispatching promote-and-deploy env=preview for ${SHORT_SHA}..."
  gh workflow run promote-and-deploy.yml \
    --repo "$REPO" \
    --ref main \
    -f environment=preview \
    -f source_sha="$SHA" \
    -f build_sha="$BUILD_SHA" \
    -f skip_infra=true
  echo "✅ Preview flight dispatched for ${SHORT_SHA}"
  emit_status "dispatched"
  emit_summary "dispatched" "promote-and-deploy kicked off; \`deploy-preview\` job in this workflow will run."
  exit 0
fi

echo "ℹ️  Queue-only: candidate-sha=${SHORT_SHA} recorded; no dispatch (review-state locked)"
emit_status "queued"
emit_summary "queued" "Preview lease was locked (a prior SHA is \`dispatching\` or \`reviewing\`). candidate-sha updated; no deploy fired this run. \`deploy-preview\` job will show as skipped."
exit 2
