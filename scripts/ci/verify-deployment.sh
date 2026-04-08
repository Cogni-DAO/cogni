#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# verify-deployment.sh — Post-deploy validation: health polls + smoke tests.
# Called by the verify job in promote-and-deploy.yml.
# Dependency reachability is already confirmed by deploy-infra.sh (Step 6.8).
#
# Usage: verify-deployment.sh
# Env:   DOMAIN (required), VM_HOST (optional, for diagnostics on failure),
#        K8S_NAMESPACE (optional), SSH_DEPLOY_KEY (optional)

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN is required}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP="${SLEEP:-15}"

OPERATOR_URL="https://${DOMAIN}"
POLY_URL="https://poly-${DOMAIN}"
RESY_URL="https://resy-${DOMAIN}"

# ── Health polls ─────────────────────────────────────────────────────────────

poll_health() {
  local name="$1"
  local url="$2"
  local attempt=1

  echo "Polling $name at $url/readyz ..."
  while [ $attempt -le $MAX_ATTEMPTS ]; do
    STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "$url/readyz" 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
      echo "✅ $name healthy (attempt $attempt)"
      return 0
    fi
    echo "  $name: HTTP $STATUS (attempt $attempt/$MAX_ATTEMPTS)"
    sleep "$SLEEP"
    attempt=$((attempt + 1))
  done
  echo "❌ $name failed health check after $MAX_ATTEMPTS attempts"
  return 1
}

# Poll all nodes in parallel
poll_health "operator" "$OPERATOR_URL" &
PID_OP=$!
poll_health "poly" "$POLY_URL" &
PID_POLY=$!
poll_health "resy" "$RESY_URL" &
PID_RESY=$!

FAILED=0
wait $PID_OP || FAILED=1
wait $PID_POLY || FAILED=1
wait $PID_RESY || FAILED=1

if [ $FAILED -ne 0 ]; then
  echo "❌ One or more nodes failed health checks"
  exit 1
fi
echo "✅ All nodes healthy"

# ── Smoke tests ──────────────────────────────────────────────────────────────

for url in "$OPERATOR_URL" "$POLY_URL" "$RESY_URL"; do
  BODY=$(curl -sk "$url/livez" 2>/dev/null)
  echo "$url/livez → $BODY"
  if ! echo "$BODY" | grep -q '"status"'; then
    echo "❌ $url/livez did not return expected JSON"
    exit 1
  fi
done
echo "✅ Smoke tests passed"
