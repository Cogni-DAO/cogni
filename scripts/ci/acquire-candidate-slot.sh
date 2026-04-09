#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

SLOT=${SLOT:-candidate-a}
LEASE_FILE=${LEASE_FILE:-infra/control/candidate-lease.json}
PR_NUMBER=${PR_NUMBER:-}
HEAD_SHA=${HEAD_SHA:-}
RUN_ID=${RUN_ID:-}
OWNER=${OWNER:-github-actions}
STATUS_URL=${STATUS_URL:-}
TTL_MINUTES=${TTL_MINUTES:-60}
export SLOT LEASE_FILE PR_NUMBER HEAD_SHA RUN_ID OWNER STATUS_URL TTL_MINUTES

if [ -z "$PR_NUMBER" ] || [ -z "$HEAD_SHA" ] || [ -z "$RUN_ID" ]; then
  echo "[ERROR] PR_NUMBER, HEAD_SHA, and RUN_ID are required" >&2
  exit 1
fi

mkdir -p "$(dirname "$LEASE_FILE")"

python3 - "$LEASE_FILE" <<'PY'
import json
import os
import sys
from datetime import datetime, timedelta, timezone

lease_path = sys.argv[1]
now = datetime.now(timezone.utc)
slot = os.environ["SLOT"]
pr_number = int(os.environ["PR_NUMBER"])
head_sha = os.environ["HEAD_SHA"]
run_id = os.environ["RUN_ID"]
owner = os.environ["OWNER"]
status_url = os.environ.get("STATUS_URL", "")
ttl_minutes = int(os.environ.get("TTL_MINUTES", "60"))

busy = False
existing = {}
if os.path.exists(lease_path):
    with open(lease_path, "r", encoding="utf-8") as handle:
        existing = json.load(handle)

state = existing.get("state")
expires_at = existing.get("expires_at")
active = False
if state == "leased" and expires_at:
    try:
        active = datetime.fromisoformat(expires_at.replace("Z", "+00:00")) > now
    except ValueError:
        active = False

same_owner = (
    existing.get("pr_number") == pr_number and
    existing.get("head_sha") == head_sha
)

if active and not same_owner:
    busy = True
else:
    payload = {
        "slot": slot,
        "state": "leased",
        "pr_number": pr_number,
        "head_sha": head_sha,
        "run_id": run_id,
        "owner": owner,
        "acquired_at": now.isoformat().replace("+00:00", "Z"),
        "expires_at": (now + timedelta(minutes=ttl_minutes)).isoformat().replace("+00:00", "Z"),
        "status_url": status_url,
    }
    with open(lease_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        handle.write(f"slot_busy={'true' if busy else 'false'}\n")
        handle.write(f"lease_file={lease_path}\n")
        if busy:
            handle.write(f"busy_pr_number={existing.get('pr_number', '')}\n")
            handle.write(f"busy_head_sha={existing.get('head_sha', '')}\n")

if busy:
    print(f"Slot {slot} is busy")
    sys.exit(2)

print(f"Acquired slot {slot}")
PY
