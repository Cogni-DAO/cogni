#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# wait-for-in-cluster-services.sh — assert every k8s Deployment the flight
# just promoted has rolled to its new ReplicaSet AND the old pods have
# left the Service's endpoints. Complements the HTTPS /readyz probes in
# wait-for-candidate-ready.sh, which are served by any pod still in
# endpoints (old or new) and so do not verify a rollout actually completed.
# See docs/spec/ci-cd.md → "Minimum Authoritative Validation".
#
# Two gates per service (bug.0331):
#   1. kubectl rollout status — new ReplicaSet reached desired Available
#   2. endpoint cutover wait  — Service's .subsets.addresses count
#                                matches deployment desired replicas
#                                (terminating-but-still-routable old pod
#                                has been removed from EndpointSlice)
#
# Without gate 2, downstream HTTPS probes can land on a Terminating pod
# during the up-to-terminationGracePeriodSeconds window, causing
# verify-buildsha to read the previous deploy's /readyz.version and fail
# the flight even though the deploy is correct.
#
# Env:
#   VM_HOST                  (required) SSH target for the candidate VM
#   DEPLOY_ENVIRONMENT       (required) candidate-a | preview | production
#   SSH_KEY                  (optional, default ~/.ssh/deploy_key) SSH identity
#   ROLLOUT_TIMEOUT          (optional, default 300) seconds per deployment
#                             for kubectl rollout status
#   ENDPOINT_CUTOVER_TIMEOUT (optional, default 60) seconds per service
#                             for the post-rollout endpoint cutover wait.
#                             60s comfortably covers the default 30s
#                             terminationGracePeriodSeconds.
#
# Adds: edit SERVICES below when a new in-cluster deployment needs gating.

set -euo pipefail

VM_HOST="${VM_HOST:?VM_HOST required}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT required}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/deploy_key}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300}"
ENDPOINT_CUTOVER_TIMEOUT="${ENDPOINT_CUTOVER_TIMEOUT:-60}"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=30
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=6
)

# All k8s Deployments managed by candidate-a / preview / production overlays.
# Add a new deployment name here when a new service lands in the catalog.
# Each entry must be a Deployment AND a Service of the same name (the
# endpoint-cutover gate dereferences `kubectl get endpoints/<name>`).
SERVICES=(operator-node-app poly-node-app resy-node-app scheduler-worker)

NS="cogni-${DEPLOY_ENVIRONMENT}"

# Endpoint cutover wait: poll Service endpoints until the address count
# drops to <= deployment desired replicas. During a RollingUpdate with
# maxSurge=1, both old and new pods are routable until the old pod's
# deletionTimestamp triggers EndpointSlice removal — typically <1s after
# kubectl rollout status returns, but bounded by terminationGracePeriod.
# The dot-counter (jsonpath emits one '.' per Ready address) is jq-free
# so it works on the candidate VM (jq is not installed there).
wait_for_endpoint_cutover() {
  local svc="$1"
  local desired
  desired=$(ssh "${SSH_OPTS[@]}" "root@${VM_HOST}" \
    "kubectl -n ${NS} get deploy ${svc} -o jsonpath='{.spec.replicas}'")
  if [ -z "$desired" ] || [ "$desired" -le 0 ]; then
    echo "  ⚠ ${svc}: desired replicas unset or zero — skipping endpoint cutover wait"
    return 0
  fi

  local deadline=$((SECONDS + ENDPOINT_CUTOVER_TIMEOUT))
  local count=-1
  while [ "$SECONDS" -lt "$deadline" ]; do
    count=$(ssh "${SSH_OPTS[@]}" "root@${VM_HOST}" \
      "kubectl -n ${NS} get endpoints ${svc} -o jsonpath='{range .subsets[*].addresses[*]}.{end}' 2>/dev/null | tr -cd '.' | wc -c | tr -d ' '" \
      || echo "-1")
    if [ "$count" -ge 0 ] && [ "$count" -le "$desired" ]; then
      echo "  ✓ ${svc}: endpoints=${count} <= desired=${desired} (rollout cutover complete)"
      return 0
    fi
    sleep 2
  done

  echo "  ✗ ${svc}: endpoint cutover timed out after ${ENDPOINT_CUTOVER_TIMEOUT}s — endpoints=${count} > desired=${desired}"
  return 1
}

FAILED=0
for svc in "${SERVICES[@]}"; do
  echo "⏳ kubectl rollout status deployment/${svc} -n ${NS} (timeout ${ROLLOUT_TIMEOUT}s)"
  ssh "${SSH_OPTS[@]}" "root@${VM_HOST}" \
    "kubectl -n ${NS} rollout status deployment/${svc} --timeout=${ROLLOUT_TIMEOUT}s"
  if ! wait_for_endpoint_cutover "$svc"; then
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "❌ one or more services failed endpoint cutover — old pod still routable"
  exit 1
fi

echo "✅ all in-cluster services Ready and endpoints cut over to new pods"
