#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

REPOSITORY=${REPOSITORY:-${GITHUB_REPOSITORY:-}}
SHA=${SHA:-}
STATE=${STATE:-}
DESCRIPTION=${DESCRIPTION:-}
TARGET_URL=${TARGET_URL:-}
CONTEXT=${CONTEXT:-candidate-flight}

if [ -z "$REPOSITORY" ] || [ -z "$SHA" ] || [ -z "$STATE" ] || [ -z "$DESCRIPTION" ]; then
  echo "[ERROR] REPOSITORY, SHA, STATE, and DESCRIPTION are required" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[ERROR] gh CLI is required" >&2
  exit 1
fi

args=(
  "repos/${REPOSITORY}/statuses/${SHA}"
  -f "state=${STATE}"
  -f "context=${CONTEXT}"
  -f "description=${DESCRIPTION}"
)

if [ -n "$TARGET_URL" ]; then
  args+=(-f "target_url=${TARGET_URL}")
fi

gh api "${args[@]}" >/dev/null
echo "Reported ${CONTEXT}=${STATE} for ${SHA}"
