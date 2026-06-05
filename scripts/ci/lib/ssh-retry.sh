#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

ci_ssh_retry() {
  local attempt=1
  local max_attempts="${CI_SSH_RETRY_ATTEMPTS:-4}"
  local out_file rc sleep_seconds

  out_file=$(mktemp)
  trap 'rm -f "$out_file"' RETURN

  while [ "$attempt" -le "$max_attempts" ]; do
    : > "$out_file"
    set +e
    "$@" 2>&1 | tee "$out_file"
    rc=${PIPESTATUS[0]}
    set -e

    if [ "$rc" -eq 0 ]; then
      return 0
    fi

    if [ "$rc" -ne 255 ] ||
       ! grep -Eq 'kex_exchange_identification|Connection reset by peer' "$out_file"; then
      return "$rc"
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      return "$rc"
    fi

    sleep_seconds=$((attempt * 3 + RANDOM % 4))
    echo "ssh transport reset; retrying in ${sleep_seconds}s (attempt ${attempt}/${max_attempts})" >&2
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done
}
