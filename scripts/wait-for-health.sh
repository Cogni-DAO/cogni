#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

HEALTH_URL="${1:-}"

if [[ -z "$HEALTH_URL" ]]; then
    echo "Usage: $0 <readyz-url>"
    echo "Example: $0 https://canary.cognidao.org/readyz"
    exit 1
fi

echo "Waiting for $HEALTH_URL to be ready (HTTP 200)..."

for i in {1..60}; do
    # Check for 200 OK (readiness gate)
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        echo "✅ Readiness check passed after ${i} attempts"
        exit 0
    fi
    echo "Attempt $i/60 failed, waiting 5 seconds..."
    sleep 5
done

echo "❌ Readiness check failed after 60 attempts (5 minutes)"
exit 1
