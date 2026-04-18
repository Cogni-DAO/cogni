#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# verify-buildsha.sh — authoritative end-of-deploy gate: assert each node-app
# endpoint serves the SHA the flight claimed to deploy. Catches "green run,
# stale pods" — the pattern where an upstream step silently produced no new
# images (affected-only CI, build failure, wrong overlay), overlays stayed
# unchanged, Argo did nothing, all downstream gates reported green against
# the old pods.
#
# Contract: `/readyz.version` equals `$EXPECTED_BUILDSHA` (the PR head SHA
# baked into the image by pr-build.yml per bug.0313). Any mismatch is a
# hard failure regardless of prior workflow status.
#
# Env:
#   DOMAIN              (required) base domain (operator Ingress host)
#   EXPECTED_BUILDSHA   (required) PR head SHA — full 40-char hex
#   NODES               (required) CSV of node-app names to verify. MUST be
#                       the set that was actually promoted in this run — do
#                       not default to "operator,poly,resy" because affected-
#                       only CI rebuilds a subset and untouched nodes
#                       legitimately serve a different (prior) PR head SHA.
#                       Pass the empty string to skip (no-op promotion case).
#
# Hostname convention: operator → https://$DOMAIN, others → https://$node-$DOMAIN.

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN required}"
EXPECTED_BUILDSHA="${EXPECTED_BUILDSHA:?EXPECTED_BUILDSHA required}"
NODES="${NODES?NODES required (CSV of promoted nodes; pass \"\" to skip)}"

if [ -z "$NODES" ]; then
  echo "ℹ️  NODES is empty — no apps promoted in this run, skipping buildSha check."
  exit 0
fi

# Normalise EXPECTED_BUILDSHA to lower-case (git gives lower, but callers may
# export upper) to avoid a cosmetic mismatch.
EXPECTED_BUILDSHA=$(printf '%s' "$EXPECTED_BUILDSHA" | tr '[:upper:]' '[:lower:]')

IFS=',' read -r -a NODE_ARR_RAW <<<"$NODES"

# Only node-apps expose /readyz via HTTPS Ingress. scheduler-worker and
# migrator are promoted-apps too but are in-cluster only — they're covered
# by wait-for-in-cluster-services (kubectl rollout status) upstream.
NODE_APPS="operator poly resy"
NODE_ARR=()
for n in "${NODE_ARR_RAW[@]}"; do
  for p in $NODE_APPS; do
    if [ "$n" = "$p" ]; then
      NODE_ARR+=("$n")
      break
    fi
  done
done

if [ "${#NODE_ARR[@]}" -eq 0 ]; then
  echo "ℹ️  No Ingress-probeable apps in NODES=\"$NODES\" — skipping buildSha check."
  exit 0
fi

FAILED=0

for node in "${NODE_ARR[@]}"; do
  if [ "$node" = "operator" ]; then
    host="${DOMAIN}"
  else
    host="${node}-${DOMAIN}"
  fi
  url="https://${host}/readyz"

  body=$(curl -sk --max-time 10 "$url" || echo "")
  actual=$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("version",""))' 2>/dev/null || echo "")
  actual=$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')

  if [ -z "$actual" ]; then
    echo "  ❌ ${node}: ${url} returned no parseable version (body: ${body:0:120})"
    FAILED=1
    continue
  fi

  if [ "$actual" = "$EXPECTED_BUILDSHA" ]; then
    echo "  ✅ ${node}: version=${actual:0:12} matches expected"
  else
    echo "  ❌ ${node}: version=${actual:0:12} != expected ${EXPECTED_BUILDSHA:0:12}"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "❌ buildSha mismatch — deploy did not actually promote expected images."
  echo "   Common causes:"
  echo "     1. pr-build built no images (affected-only scope missed a node or CI-only PR)."
  echo "     2. promote-k8s found no new digest for an app (image not in GHCR)."
  echo "     3. Argo stuck on prior reconcile (check wait-for-argocd output)."
  echo "     4. Ingress still serving old pod (uncommon — verify with kubectl)."
  exit 1
fi

echo "✅ all node-apps serving expected buildSha ${EXPECTED_BUILDSHA:0:12}"
