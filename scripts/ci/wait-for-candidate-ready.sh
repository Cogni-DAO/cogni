#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

DOMAIN=${DOMAIN:-}
MAX_ATTEMPTS=${MAX_ATTEMPTS:-30}
SLEEP_SECONDS=${SLEEP_SECONDS:-15}

if [ -z "$DOMAIN" ]; then
  echo "[ERROR] DOMAIN is required" >&2
  exit 1
fi

poll_ready() {
  local name="$1"
  local url="$2"
  local attempt=1

  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    status=$(curl -sk -o /dev/null -w '%{http_code}' "${url}/readyz" 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      echo "Ready: ${name} (${url})"
      return 0
    fi

    echo "Waiting for ${name}: HTTP ${status} (${attempt}/${MAX_ATTEMPTS})"
    sleep "$SLEEP_SECONDS"
    attempt=$((attempt + 1))
  done

  echo "[ERROR] ${name} did not become ready: ${url}" >&2
  return 1
}

poll_ready operator "https://${DOMAIN}"
poll_ready poly "https://poly-${DOMAIN}"
poll_ready resy "https://resy-${DOMAIN}"
