#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

DOMAIN=${DOMAIN:-}

if [ -z "$DOMAIN" ]; then
  echo "[ERROR] DOMAIN is required" >&2
  exit 1
fi

check_livez() {
  local name="$1"
  local url="$2"
  local body

  body=$(curl -sk "${url}/livez" 2>/dev/null)
  echo "${name} livez: ${body}"
  if ! printf '%s' "$body" | grep -q '"status"'; then
    echo "[ERROR] ${name} livez did not return expected JSON" >&2
    exit 1
  fi
}

check_livez operator "https://${DOMAIN}"
check_livez poly "https://poly-${DOMAIN}"
check_livez resy "https://resy-${DOMAIN}"
