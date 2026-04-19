#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/promote-build-payload.sh
# Purpose: Apply a resolved image payload to a deploy-branch overlay via
#   promote-k8s-image.sh. Runs from the deploy-branch checkout.
#
# Side-effects:
#   - Writes overlay digest fields under infra/k8s/overlays/{OVERLAY_ENV}/.
#   - Emits $GITHUB_OUTPUT.promoted_apps = CSV of apps that received a new
#     digest. Empty string when the payload had no new digests — consumed
#     by verify-candidate / verify-deploy job-level gates (bug.0321 Fix 1).
#   - Merges per-promoted-app {app → source_sha} entries into
#     .promote-state/source-sha-by-app.json on the deploy branch. Consumed
#     by verify-buildsha.sh in SOURCE_SHA_MAP mode for cross-env/cross-PR
#     contract verification (bug.0321 Fix 4).
#
# Env:
#   PAYLOAD_FILE    (required) path to resolved-pr-images.json
#   OVERLAY_ENV     (required) candidate-a | preview | production
#   MAP_FILE        (optional) .promote-state/source-sha-by-app.json path
#   PROMOTE_SCRIPT  (optional) path to promote-k8s-image.sh
#   MAP_SCRIPT      (optional) path to update-source-sha-map.sh

set -euo pipefail

PAYLOAD_FILE=${PAYLOAD_FILE:-}
OVERLAY_ENV=${OVERLAY_ENV:-}
PROMOTE_SCRIPT=${PROMOTE_SCRIPT:-../app-src/scripts/ci/promote-k8s-image.sh}
# Per-app source-SHA map writer (bug.0321 Fix 4). Same relative path
# convention as PROMOTE_SCRIPT: callers run from the deploy-branch
# checkout, scripts live under ../app-src/.
MAP_SCRIPT=${MAP_SCRIPT:-../app-src/scripts/ci/update-source-sha-map.sh}
MAP_FILE=${MAP_FILE:-.promote-state/source-sha-by-app.json}

if [ -z "$PAYLOAD_FILE" ] || [ ! -f "$PAYLOAD_FILE" ]; then
  echo "[ERROR] PAYLOAD_FILE is required and must exist" >&2
  exit 1
fi

if [ -z "$OVERLAY_ENV" ]; then
  echo "[ERROR] OVERLAY_ENV is required" >&2
  exit 1
fi

# Top-level source_sha from the payload envelope (written by
# resolve-pr-build-images.sh). Required for the source-sha-by-app map
# (bug.0321 Fix 4).
source_sha=$(python3 - "$PAYLOAD_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
print(payload.get("source_sha", ""))
PY
)

# Track which apps actually had a non-empty digest and got written to the
# overlay. Emitted as $GITHUB_OUTPUT.promoted_apps so downstream verification
# jobs can (a) scope wait-for-argocd to only the apps that changed and
# (b) gate at the job level — an empty promoted_apps surfaces as a visibly
# skipped verify job instead of a silent-green skipped step.
PROMOTED=()

extract_digest() {
  local target="$1"
  python3 - "$PAYLOAD_FILE" "$target" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
for item in payload["targets"]:
    if item["target"] == sys.argv[2]:
        print(item["digest"])
        break
PY
}

# Write a per-app `app → source_sha` entry into .promote-state/source-sha-by-app.json
# on the deploy branch. Merged, not overwritten — untouched apps retain their
# prior source_sha. Consumed by verify-buildsha.sh in SOURCE_SHA_MAP mode for
# cross-env/cross-PR contract verification (bug.0321 Fix 4).
update_source_sha_map() {
  local app="$1"
  if [ -z "$source_sha" ]; then
    echo "  ⚠️  source_sha missing from payload — skipping map update for ${app}" >&2
    return 0
  fi
  APP="$app" SOURCE_SHA="$source_sha" MAP_FILE="$MAP_FILE" \
    bash "$MAP_SCRIPT"
}

promote_target() {
  local target="$1"
  local digest migrator_digest

  digest=$(extract_digest "$target")
  [ -z "$digest" ] && return 0

  if [ "$target" = "operator" ] || [ "$target" = "poly" ] || [ "$target" = "resy" ]; then
    # task.0322: each node pairs with its own per-node migrator digest.
    migrator_digest=$(extract_digest "${target}-migrator")
    if [ -n "$migrator_digest" ]; then
      bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest" --migrator-digest "$migrator_digest"
    else
      bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest"
    fi
    PROMOTED+=("$target")
    update_source_sha_map "$target"
    return 0
  fi

  if [ "$target" = "scheduler-worker" ]; then
    bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest"
    PROMOTED+=("$target")
    update_source_sha_map "$target"
  fi
}

promote_target operator
promote_target poly
promote_target resy
promote_target scheduler-worker

promoted_csv=""
if [ ${#PROMOTED[@]} -gt 0 ]; then
  promoted_csv=$(IFS=,; echo "${PROMOTED[*]}")
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "promoted_apps=${promoted_csv}" >> "$GITHUB_OUTPUT"
fi

echo "Promoted apps: ${promoted_csv:-none}"
