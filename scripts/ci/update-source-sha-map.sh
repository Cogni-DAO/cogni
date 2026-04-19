#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# update-source-sha-map.sh — merge a single `app → source_sha` entry into
# .promote-state/source-sha-by-app.json on the deploy branch. Called once
# per promoted app by promote-build-payload.sh (candidate-a path) and by
# promote-and-deploy.yml's promote-k8s loop (preview / production path).
#
# The map is the artifact-provenance carrier for cross-env contract
# verification (bug.0321 Fix 4). verify-buildsha.sh reads it to assert
# each node's /readyz.version matches the SHA that built that node's
# overlay digest — even when different nodes were built from different
# PR head SHAs (affected-only CI, cross-PR production promotions).
#
# Merges instead of overwriting: apps not promoted in this run retain
# their prior source_sha entry. Missing file bootstraps to {}.
#
# Env:
#   APP         (required) app name (operator | poly | resy | scheduler-worker | ...)
#   SOURCE_SHA  (required) full 40-char PR head SHA — lowercased for normalisation
#   MAP_FILE    (default .promote-state/source-sha-by-app.json) path relative
#               to cwd; caller must cd into the deploy-branch checkout first.

set -euo pipefail

APP="${APP:?APP required}"
SOURCE_SHA="${SOURCE_SHA:?SOURCE_SHA required}"
MAP_FILE="${MAP_FILE:-.promote-state/source-sha-by-app.json}"

mkdir -p "$(dirname "$MAP_FILE")"
if [ ! -f "$MAP_FILE" ]; then
  echo '{}' >"$MAP_FILE"
fi

python3 - "$MAP_FILE" "$APP" "$SOURCE_SHA" <<'PY'
import json
import sys

path, app, sha = sys.argv[1], sys.argv[2], sys.argv[3].lower()
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, json.JSONDecodeError):
    data = {}
if not isinstance(data, dict):
    data = {}
data[app] = sha
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
print(f"  ↳ source-sha-by-app.json[{app}] = {sha[:8]}")
PY
