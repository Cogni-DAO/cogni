#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

##
# Script: scripts/ci/fetch_github_job_logs.sh
# Purpose: Fetch GitHub Actions job logs via API for CI failure telemetry
# Scope: Best-effort; always exits 0 and writes OUTPUT_FILE (with diagnostic on failure)
# Inputs:
#   GITHUB_TOKEN - GitHub token with actions:read permission
#   GITHUB_REPOSITORY - Repo in format owner/repo
#   GITHUB_RUN_ID - Current run ID
#   GITHUB_RUN_ATTEMPT - Current run attempt (default: 1)
#   GITHUB_JOB - Current job ID (YAML key)
#   OUTPUT_FILE - Path to write log tail
# Outputs: Writes bounded log tail to OUTPUT_FILE (max 1200 lines, ~256KB)
# Exit: Always 0 (best-effort; writes diagnostic on failure)
##

set -euo pipefail

# Best-effort: write diagnostic and exit 0 on any failure
fail_gracefully() {
  local reason="$1"
  echo "⚠️  $reason" >&2
  {
    echo ""
    echo "=== GitHub Actions Job Log (Unavailable) ==="
    echo "reason: $reason"
    echo "job: ${GITHUB_JOB:-unknown}"
    echo "run_id: ${GITHUB_RUN_ID:-unknown}"
    echo "run_attempt: ${GITHUB_RUN_ATTEMPT:-unknown}"
    echo "captured_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "${OUTPUT_FILE:-/dev/null}"
  exit 0
}

# Validate required env vars
[[ -z "${GITHUB_TOKEN:-}" ]] && fail_gracefully "GITHUB_TOKEN not set"
[[ -z "${GITHUB_REPOSITORY:-}" ]] && fail_gracefully "GITHUB_REPOSITORY not set"
[[ -z "${GITHUB_RUN_ID:-}" ]] && fail_gracefully "GITHUB_RUN_ID not set"
[[ -z "${GITHUB_JOB:-}" ]] && fail_gracefully "GITHUB_JOB not set"
[[ -z "${OUTPUT_FILE:-}" ]] && fail_gracefully "OUTPUT_FILE not set"

# Config
MAX_LOG_LINES=1200
MAX_LOG_BYTES=262144  # 256KB
API_BASE="https://api.github.com"
GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"

# Curl timeouts (seconds) to prevent hanging CI
CURL_CONNECT_TIMEOUT=10
CURL_MAX_TIME=30

# Check jq dependency
if ! command -v jq >/dev/null; then
  fail_gracefully "jq not found"
fi

echo "Fetching jobs for run $GITHUB_RUN_ID attempt $GITHUB_RUN_ATTEMPT" >&2

# Use attempt-scoped endpoint to avoid reruns/wrong jobs
JOBS_RESPONSE=$(mktemp)
trap "rm -f '$JOBS_RESPONSE'" EXIT

# Fetch first page with timeouts
HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$JOBS_RESPONSE" \
  --fail-with-body \
  --connect-timeout "$CURL_CONNECT_TIMEOUT" \
  --max-time "$CURL_MAX_TIME" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API_BASE}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100" \
  || echo "000")

if [[ "$HTTP_CODE" != "200" ]]; then
  fail_gracefully "Failed to list jobs (HTTP $HTTP_CODE)"
fi

# Check if pagination is incomplete (more than 100 jobs exist)
TOTAL_COUNT=$(jq -r '.total_count // 0' "$JOBS_RESPONSE")
JOBS_COUNT=$(jq -r '.jobs | length' "$JOBS_RESPONSE")
PAGINATION_INCOMPLETE=false

if [[ "$TOTAL_COUNT" -gt 100 ]]; then
  echo "⚠️  Workflow has $TOTAL_COUNT jobs (fetched first 100; pagination incomplete)" >&2
  PAGINATION_INCOMPLETE=true

  # Try to fetch more pages (bounded to 3 pages = 300 jobs max)
  for page in 2 3; do
    if [[ "$JOBS_COUNT" -ge "$TOTAL_COUNT" ]]; then
      break
    fi

    echo "Fetching page $page..." >&2
    NEXT_PAGE_RESPONSE=$(mktemp)
    trap "rm -f '$JOBS_RESPONSE' '$NEXT_PAGE_RESPONSE'" EXIT

    HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$NEXT_PAGE_RESPONSE" \
      --fail-with-body \
      --connect-timeout "$CURL_CONNECT_TIMEOUT" \
      --max-time "$CURL_MAX_TIME" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "${API_BASE}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=$page" \
      || echo "000")

    if [[ "$HTTP_CODE" == "200" ]]; then
      # Merge jobs arrays
      jq -s '.[0].jobs + .[1].jobs | {total_count: .[0].total_count, jobs: .}' \
        "$JOBS_RESPONSE" "$NEXT_PAGE_RESPONSE" > "$JOBS_RESPONSE.merged"
      mv "$JOBS_RESPONSE.merged" "$JOBS_RESPONSE"
      JOBS_COUNT=$(jq -r '.jobs | length' "$JOBS_RESPONSE")
      echo "Now have $JOBS_COUNT jobs" >&2
    else
      echo "⚠️  Failed to fetch page $page (HTTP $HTTP_CODE)" >&2
      break
    fi

    rm -f "$NEXT_PAGE_RESPONSE"
  done

  if [[ "$JOBS_COUNT" -lt "$TOTAL_COUNT" ]]; then
    PAGINATION_INCOMPLETE=true
  else
    PAGINATION_INCOMPLETE=false
  fi
fi

# Find job ID with robust matching (job_id or display name)
# GitHub API returns .name (display name), but GITHUB_JOB is the job_id (YAML key)
# Match either exact name or name starting with job_id (handles matrix jobs)
JOB_ID=$(jq -r --arg job "$GITHUB_JOB" \
  '.jobs[] | select(.name == $job or (.name | startswith($job))) | .id' \
  "$JOBS_RESPONSE" | head -n1)

if [[ -z "$JOB_ID" ]] || [[ "$JOB_ID" == "null" ]]; then
  # Debug: show available job names
  AVAILABLE_JOBS=$(jq -r '.jobs[].name' "$JOBS_RESPONSE" | tr '\n' ', ' | sed 's/,$//')
  PAGINATION_NOTE=""
  if [[ "$PAGINATION_INCOMPLETE" == "true" ]]; then
    PAGINATION_NOTE=" (pagination_incomplete: searched first $JOBS_COUNT of $TOTAL_COUNT jobs)"
  fi
  fail_gracefully "Could not find job '$GITHUB_JOB' (available: $AVAILABLE_JOBS)$PAGINATION_NOTE"
fi

echo "Found job ID: $JOB_ID" >&2

# Download job logs (GitHub returns 302 redirect to signed URL)
TEMP_LOG=$(mktemp)
trap "rm -f '$TEMP_LOG' '$JOBS_RESPONSE'" EXIT

echo "Downloading logs for job ID: $JOB_ID" >&2

# Use -L to follow 302 redirect; longer timeout for potentially large logs
HTTP_CODE=$(curl -sS -L -w "%{http_code}" -o "$TEMP_LOG" \
  --fail-with-body \
  --connect-timeout "$CURL_CONNECT_TIMEOUT" \
  --max-time 60 \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${API_BASE}/repos/${GITHUB_REPOSITORY}/actions/jobs/${JOB_ID}/logs" \
  || echo "000")

# After redirect, final response should be 200
if [[ "$HTTP_CODE" != "200" ]]; then
  fail_gracefully "Failed to download job logs (HTTP $HTTP_CODE)"
fi

# Verify content is text (not binary/corrupted)
if ! file "$TEMP_LOG" | grep -q "text"; then
  fail_gracefully "Downloaded logs are not plain text"
fi

# Extract tail of log (bounded by lines and bytes)
echo "Extracting log tail (max $MAX_LOG_LINES lines, $MAX_LOG_BYTES bytes)" >&2

{
  echo ""
  echo "=== GitHub Actions Job Log Tail ==="
  echo "job: $GITHUB_JOB"
  echo "job_id: $JOB_ID"
  echo "run_id: $GITHUB_RUN_ID"
  echo "run_attempt: $GITHUB_RUN_ATTEMPT"
  echo "pagination_incomplete: $PAGINATION_INCOMPLETE"
  echo "captured_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  tail -n "$MAX_LOG_LINES" "$TEMP_LOG" | head -c "$MAX_LOG_BYTES"
} > "$OUTPUT_FILE"

echo "✅ Job logs extracted to $OUTPUT_FILE" >&2
exit 0
