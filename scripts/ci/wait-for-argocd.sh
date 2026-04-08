#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# wait-for-argocd.sh — Block until all ArgoCD Applications for an environment
# are Synced and Healthy. Called between promote-k8s and deploy-infra so that
# k8s resources (Services, EndpointSlices, Deployments) are fully applied
# before deploy-infra mutates secrets or restarts pods.
#
# Usage: wait-for-argocd.sh
# Env:   VM_HOST, SSH_OPTS (optional), DEPLOY_ENVIRONMENT, ARGOCD_TIMEOUT (default 300)
#        ARGOCD_AUTH_TOKEN (optional — enables native argocd CLI wait)

set -euo pipefail

VM_HOST="${VM_HOST:?VM_HOST is required}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
SSH_OPTS="${SSH_OPTS:--i ~/.ssh/deploy_key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=6}"
ARGOCD_TIMEOUT="${ARGOCD_TIMEOUT:-300}"
ARGOCD_AUTH_TOKEN="${ARGOCD_AUTH_TOKEN:-}"

# Catalog apps — must match infra/catalog/*.yaml (minus .yaml extension)
APPS=(operator poly resy scheduler-worker sandbox-openclaw)

echo "⏳ Waiting for ArgoCD sync+health (${DEPLOY_ENVIRONMENT}, timeout ${ARGOCD_TIMEOUT}s)..."

# SCP a script to the VM and execute it. This avoids heredoc quoting issues
# with SSH stdin piping and ensures all shell variables resolve on the remote.
REMOTE_SCRIPT=$(mktemp)
cat > "$REMOTE_SCRIPT" <<'REMOTESCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# Args: DEPLOY_ENVIRONMENT ARGOCD_TIMEOUT ARGOCD_AUTH_TOKEN app1 app2 ...
DEPLOY_ENVIRONMENT="$1"
ARGOCD_TIMEOUT="$2"
ARGOCD_AUTH_TOKEN="${3:-}"
shift 3
APPS=("$@")

# Early exit: if Application CRD doesn't exist, skip entirely (first deploy / no Argo)
if ! kubectl get crd applications.argoproj.io &>/dev/null; then
  echo "⚠️  Application CRD not found — skipping ArgoCD wait (Argo CD may not be installed)"
  exit 0
fi

# Decide strategy: argocd CLI (if authed) or kubectl polling
USE_ARGOCD_CLI=false
if [ -n "$ARGOCD_AUTH_TOKEN" ] && command -v argocd &>/dev/null; then
  USE_ARGOCD_CLI=true
  export ARGOCD_AUTH_TOKEN
  echo "  Using argocd CLI (auth token provided)"
else
  echo "  Using kubectl polling (no ARGOCD_AUTH_TOKEN or argocd CLI not found)"
fi

FAILED=0
for app in "${APPS[@]}"; do
  APP_NAME="${DEPLOY_ENVIRONMENT}-${app}"
  echo "  Waiting for ${APP_NAME}..."

  if [ "$USE_ARGOCD_CLI" = "true" ]; then
    # ArgoCD native wait (handles sync + health in one call)
    if ! argocd app wait "$APP_NAME" \
      --sync --health \
      --timeout "$ARGOCD_TIMEOUT" \
      --grpc-web 2>&1; then
      echo "  ❌ ${APP_NAME} failed to sync/become healthy"
      FAILED=1
    else
      echo "  ✅ ${APP_NAME} synced and healthy"
    fi
  else
    # kubectl polling: check Application resource status
    SYNC="Unknown"
    HEALTH="Unknown"
    DEADLINE=$((SECONDS + ARGOCD_TIMEOUT))
    while [ $SECONDS -lt $DEADLINE ]; do
      SYNC=$(kubectl -n argocd get application "$APP_NAME" -o jsonpath='{.status.sync.status}' 2>/dev/null || echo "Unknown")
      HEALTH=$(kubectl -n argocd get application "$APP_NAME" -o jsonpath='{.status.health.status}' 2>/dev/null || echo "Unknown")

      if [ "$SYNC" = "Synced" ] && [ "$HEALTH" = "Healthy" ]; then
        echo "  ✅ ${APP_NAME} synced and healthy"
        break
      fi
      echo "    ${APP_NAME}: sync=${SYNC} health=${HEALTH} (waiting...)"
      sleep 10
    done

    if [ "$SYNC" != "Synced" ] || [ "$HEALTH" != "Healthy" ]; then
      echo "  ❌ ${APP_NAME} timed out (sync=${SYNC}, health=${HEALTH})"
      FAILED=1
    fi
  fi
done

if [ $FAILED -ne 0 ]; then
  echo ""
  echo "❌ ArgoCD sync/health failed for one or more apps"
  kubectl -n argocd get applications -o wide 2>/dev/null || true
  exit 1
fi

echo "✅ All ArgoCD apps synced and healthy"
REMOTESCRIPT

# SCP script to VM, execute with args, clean up
# shellcheck disable=SC2086
scp $SSH_OPTS "$REMOTE_SCRIPT" root@"$VM_HOST":/tmp/wait-for-argocd-remote.sh
rm -f "$REMOTE_SCRIPT"

# shellcheck disable=SC2086
ssh $SSH_OPTS root@"$VM_HOST" \
  "bash /tmp/wait-for-argocd-remote.sh '$DEPLOY_ENVIRONMENT' '$ARGOCD_TIMEOUT' '$ARGOCD_AUTH_TOKEN' ${APPS[*]}; RC=\$?; rm -f /tmp/wait-for-argocd-remote.sh; exit \$RC"
