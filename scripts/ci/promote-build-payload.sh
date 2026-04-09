#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/promote-build-payload.sh
# Purpose: Apply a resolved image payload to an overlay using promote-k8s-image.sh.

set -euo pipefail

PAYLOAD_FILE=${PAYLOAD_FILE:-}
OVERLAY_ENV=${OVERLAY_ENV:-}
PROMOTE_SCRIPT=${PROMOTE_SCRIPT:-../app-src/scripts/ci/promote-k8s-image.sh}

if [ -z "$PAYLOAD_FILE" ] || [ ! -f "$PAYLOAD_FILE" ]; then
  echo "[ERROR] PAYLOAD_FILE is required and must exist" >&2
  exit 1
fi

if [ -z "$OVERLAY_ENV" ]; then
  echo "[ERROR] OVERLAY_ENV is required" >&2
  exit 1
fi

migrator_digest=$(python3 - "$PAYLOAD_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
for item in payload["targets"]:
    if item["target"] == "migrator":
        print(item["digest"])
        break
PY
)

promote_target() {
  local target="$1"
  local digest

  digest=$(python3 - "$PAYLOAD_FILE" "$target" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)
for item in payload["targets"]:
    if item["target"] == sys.argv[2]:
        print(item["digest"])
        break
PY
)

  [ -z "$digest" ] && return 0

  if [ "$target" = "operator" ] || [ "$target" = "poly" ] || [ "$target" = "resy" ]; then
    if [ -n "$migrator_digest" ]; then
      bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest" --migrator-digest "$migrator_digest"
    else
      bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest"
    fi
    return 0
  fi

  if [ "$target" = "scheduler-worker" ]; then
    bash "$PROMOTE_SCRIPT" --no-commit --env "$OVERLAY_ENV" --app "$target" --digest "$digest"
  fi
}

promote_target operator
promote_target poly
promote_target resy
promote_target scheduler-worker
