#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

SLOT=${SLOT:-candidate-a}
LEASE_FILE=${LEASE_FILE:-infra/control/candidate-lease.json}
STATE=${STATE:-free}
export SLOT LEASE_FILE STATE

mkdir -p "$(dirname "$LEASE_FILE")"

python3 - "$LEASE_FILE" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

lease_path = sys.argv[1]
state = os.environ.get("STATE", "free")
slot = os.environ.get("SLOT", "candidate-a")
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

payload = {
    "slot": slot,
    "state": state,
    "released_at": now,
}

if os.path.exists(lease_path):
    with open(lease_path, "r", encoding="utf-8") as handle:
        current = json.load(handle)
    payload["last_owner"] = {
        "pr_number": current.get("pr_number"),
        "head_sha": current.get("head_sha"),
        "run_id": current.get("run_id"),
    }

with open(lease_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")

print(f"Released slot {slot} with state {state}")
PY
