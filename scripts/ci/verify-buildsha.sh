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
# Two modes:
#   1. Single-SHA (preview, candidate): all promoted nodes built from the
#      same PR head SHA. Caller passes EXPECTED_BUILDSHA + NODES.
#   2. Per-app map (production, cross-PR): different nodes built from
#      different PR head SHAs (affected-only CI rebuilt a subset; production
#      copies preview's mixed overlay state). Caller passes SOURCE_SHA_MAP
#      pointing to .promote-state/source-sha-by-app.json — the script asserts
#      each node's /readyz.version matches that node's entry in the map.
#
# Contract (both modes): `/readyz.version` equals the expected SHA for this
# node. Any mismatch is a hard failure regardless of prior workflow status.
#
# Env (single-SHA mode):
#   DOMAIN              (required) base domain (operator Ingress host)
#   EXPECTED_BUILDSHA   (required) PR head SHA — full 40-char hex
#   NODES               (required) CSV of node-app names to verify. MUST be
#                       the set that was actually promoted in this run — do
#                       not default to "operator,poly,resy" because affected-
#                       only CI rebuilds a subset and untouched nodes
#                       legitimately serve a different (prior) PR head SHA.
#                       Pass the empty string to skip (no-op promotion case).
#
# Env (map mode — takes precedence when set and non-empty):
#   DOMAIN              (required)
#   SOURCE_SHA_MAP      path to .promote-state/source-sha-by-app.json. Each
#                       key is an app name; each value is the PR head SHA
#                       that built that app's overlay digest. Unset or
#                       missing file → fall back to single-SHA mode.
#
# Hostname convention: operator → https://$DOMAIN, others → https://$node-$DOMAIN.

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN required}"
SOURCE_SHA_MAP="${SOURCE_SHA_MAP:-}"

# Only node-apps expose /readyz via HTTPS Ingress. scheduler-worker and
# migrator are promoted-apps too but are in-cluster only — they're covered
# by wait-for-in-cluster-services (kubectl rollout status) upstream.
NODE_APPS="operator poly resy"

declare -A EXPECTED_BY_NODE=()

# Prefer map mode when SOURCE_SHA_MAP is set AND the file exists. The
# defensive fallback (file missing on first deploy after Fix 4 lands) is
# the single-SHA path below.
if [ -n "$SOURCE_SHA_MAP" ] && [ -f "$SOURCE_SHA_MAP" ]; then
  echo "ℹ️  verify-buildsha: per-app map mode (SOURCE_SHA_MAP=${SOURCE_SHA_MAP})"
  while IFS=$'\t' read -r app sha; do
    [ -z "$app" ] && continue
    sha=$(printf '%s' "$sha" | tr '[:upper:]' '[:lower:]')
    EXPECTED_BY_NODE["$app"]="$sha"
  done < <(python3 - "$SOURCE_SHA_MAP" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
if not isinstance(data, dict):
    sys.exit(0)
for app, sha in sorted(data.items()):
    if isinstance(sha, str) and sha:
        print(f"{app}\t{sha}")
PY
)
  if [ "${#EXPECTED_BY_NODE[@]}" -eq 0 ]; then
    echo "ℹ️  source-sha-by-app.json has no entries — skipping buildSha check."
    exit 0
  fi
else
  if [ -n "$SOURCE_SHA_MAP" ]; then
    echo "ℹ️  verify-buildsha: SOURCE_SHA_MAP=${SOURCE_SHA_MAP} set but file missing — falling back to single-SHA mode"
  fi
  # Single-SHA mode: require EXPECTED_BUILDSHA + NODES.
  EXPECTED_BUILDSHA="${EXPECTED_BUILDSHA:?EXPECTED_BUILDSHA required in single-SHA mode (or pass SOURCE_SHA_MAP)}"
  NODES="${NODES?NODES required (CSV of promoted nodes; pass \"\" to skip)}"

  if [ -z "$NODES" ]; then
    echo "ℹ️  NODES is empty — no apps promoted in this run, skipping buildSha check."
    exit 0
  fi

  EXPECTED_BUILDSHA=$(printf '%s' "$EXPECTED_BUILDSHA" | tr '[:upper:]' '[:lower:]')
  IFS=',' read -r -a NODE_ARR_RAW <<<"$NODES"
  for n in "${NODE_ARR_RAW[@]}"; do
    EXPECTED_BY_NODE["$n"]="$EXPECTED_BUILDSHA"
  done
fi

# Filter down to Ingress-probeable node-apps. Entries for scheduler-worker /
# migrator are upstream-covered (kubectl rollout status); skip them here.
NODE_ARR=()
for app in "${!EXPECTED_BY_NODE[@]}"; do
  for p in $NODE_APPS; do
    if [ "$app" = "$p" ]; then
      NODE_ARR+=("$app")
      break
    fi
  done
done

if [ "${#NODE_ARR[@]}" -eq 0 ]; then
  echo "ℹ️  No Ingress-probeable apps to verify — skipping buildSha check."
  exit 0
fi

FAILED=0

for node in "${NODE_ARR[@]}"; do
  expected="${EXPECTED_BY_NODE[$node]}"

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

  if [ "$actual" = "$expected" ]; then
    echo "  ✅ ${node}: version=${actual:0:12} matches expected ${expected:0:12}"
  else
    echo "  ❌ ${node}: version=${actual:0:12} != expected ${expected:0:12}"
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

echo "✅ all node-apps serving expected buildSha"
