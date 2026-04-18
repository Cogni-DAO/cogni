#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# wait-for-in-cluster-services.sh — gate the flight on health of services
# that don't expose an Ingress (scheduler-worker et al). Complements
# wait-for-candidate-ready.sh + smoke-candidate.sh which cover node-apps
# over HTTPS. See docs/spec/ci-cd.md → "Minimum Authoritative Validation".
#
# Env:
#   VM_HOST             (required) SSH target for the candidate VM
#   DEPLOY_ENVIRONMENT  (required) candidate-a | preview | production
#   SSH_KEY             (optional, default ~/.ssh/deploy_key) SSH identity
#   ROLLOUT_TIMEOUT     (optional, default 300) seconds per deployment
#
# Adds: edit SERVICES below when a new in-cluster deployment needs gating.

set -euo pipefail

VM_HOST="${VM_HOST:?VM_HOST required}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT required}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/deploy_key}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300}"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=30
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=6
)

# Add future no-Ingress deployments here when they need gating.
SERVICES=(scheduler-worker)

NS="cogni-${DEPLOY_ENVIRONMENT}"

for svc in "${SERVICES[@]}"; do
  echo "⏳ kubectl rollout status deployment/${svc} -n ${NS} (timeout ${ROLLOUT_TIMEOUT}s)"
  ssh "${SSH_OPTS[@]}" "root@${VM_HOST}" \
    "kubectl -n ${NS} rollout status deployment/${svc} --timeout=${ROLLOUT_TIMEOUT}s"
done

echo "✅ all in-cluster services Ready"
