#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# wait-for-argocd.sh — Block until all ArgoCD Applications for an environment
# have reconciled to EXPECTED_SHA and are Healthy. Called between promote-k8s
# and deploy-infra so that k8s resources are fully rolled out before
# deploy-infra mutates secrets or restarts pods.
#
# Correctness contract: we check `status.sync.revision == EXPECTED_SHA` and
# `status.health.status == Healthy`, not `status.sync.status == Synced`. The
# top-level sync.status is noisy on this cluster because some overlays manage
# EndpointSlices directly and those drift continuously vs. the git manifest,
# leaving apps perpetually OutOfSync even after a successful reconcile. The
# authoritative signal for "did Argo deploy what we pushed" is the revision
# on the last sync operation, not the drift comparator.
#
# bug.0326: sync.revision + health.status are Application-level signals and
# go green while a rolling update is still in flight — "Healthy" fires as
# soon as enough pods are Ready, which includes the OLD ReplicaSet's pods
# during the window between sync and rollout completion. /readyz from those
# pods serves the prior BUILD_SHA, so downstream verify-buildsha.sh fails
# on a green flight. After Argo reports Healthy for an app, this script now
# also runs `kubectl rollout status` on the app's Deployment — that command
# only returns 0 when the new ReplicaSet is fully available AND the old
# pods are torn down. Only then is the app considered done.
#
# Belt-and-suspenders active sync trigger: if an app's sync.revision has not
# caught up to EXPECTED_SHA after ACTIVE_SYNC_AFTER seconds, we kubectl-patch
# the Application to kick an explicit sync. This unblocks deploys in clusters
# where automated sync is misconfigured or the AppSet template drifted (the
# case that wedged preview for a week on deploy/staging pre-bug.0312).
#
# Usage: wait-for-argocd.sh
# Env:
#   VM_HOST             (required) SSH target
#   DEPLOY_ENVIRONMENT  (required) preview | candidate-a | production — used
#                       for the `{env}-{app}` Application name convention
#   EXPECTED_SHA        (required) git SHA the caller expects Argo to report
#                       as status.sync.revision — MUST be the deploy-branch
#                       tip SHA (NOT the source-app commit). Argo tracks the
#                       deploy branch, not main. Passing COGNI_REPO_REF here
#                       is wrong — it will never match sync.revision and the
#                       script will silently time out.
#   PROMOTED_APPS       (optional) CSV of app names to scope the wait to.
#                       Empty → fall back to full catalog. Apps not promoted
#                       in this run may legitimately be pinned at prior digest
#                       (e.g. sandbox-openclaw placeholder) and would false-fail.
#   ARGOCD_TIMEOUT      (optional, default 300) overall timeout in seconds
#   ACTIVE_SYNC_AFTER   (optional, default 30) seconds of no-progress before
#                       triggering an active sync via kubectl patch
#   SSH_OPTS            (optional) ssh flags
#
# Side-effect on success: writes ARGOCD_SYNC_VERIFIED=true to $GITHUB_ENV
# so downstream steps in the same job can see the marker. wait-for-candidate-ready.sh
# refuses to run without it (runtime-enforced gate ordering, bug.0321 Fix 4).

set -euo pipefail

VM_HOST="${VM_HOST:?VM_HOST is required}"
DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA is required (deploy-branch tip SHA)}"
SSH_OPTS="${SSH_OPTS:--i ~/.ssh/deploy_key -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=6}"
ARGOCD_TIMEOUT="${ARGOCD_TIMEOUT:-300}"
ACTIVE_SYNC_AFTER="${ACTIVE_SYNC_AFTER:-30}"
PROMOTED_APPS="${PROMOTED_APPS:-}"

# If caller specified which apps were promoted, wait only for those.
# Apps not promoted in this run keep their existing overlay digest and are
# not expected to change health — waiting for them adds false negatives
# (e.g. sandbox-openclaw with a placeholder image that can never pull).
# Falls back to full catalog for backwards compatibility.
if [ -n "$PROMOTED_APPS" ]; then
  IFS=',' read -r -a APPS <<< "$PROMOTED_APPS"
  echo "⏳ Waiting for promoted apps (${PROMOTED_APPS}) to reconcile to ${EXPECTED_SHA:0:8} (${DEPLOY_ENVIRONMENT}, timeout ${ARGOCD_TIMEOUT}s)..."
else
  APPS=(operator poly resy scheduler-worker sandbox-openclaw)
  echo "⏳ Waiting for all catalog apps to reconcile to ${EXPECTED_SHA:0:8} (${DEPLOY_ENVIRONMENT}, timeout ${ARGOCD_TIMEOUT}s)..."
fi

# SCP a remote script to the VM and execute it. Avoids heredoc quoting issues
# and ensures all shell variables resolve on the remote.
REMOTE_SCRIPT=$(mktemp)
cat > "$REMOTE_SCRIPT" <<'REMOTESCRIPT'
#!/usr/bin/env bash
set -euo pipefail

# Args: DEPLOY_ENVIRONMENT EXPECTED_SHA ARGOCD_TIMEOUT ACTIVE_SYNC_AFTER app1 app2 ...
DEPLOY_ENVIRONMENT="$1"
EXPECTED_SHA="$2"
ARGOCD_TIMEOUT="$3"
ACTIVE_SYNC_AFTER="$4"
shift 4
APPS=("$@")

# Early exit: if Application CRD doesn't exist, skip entirely (first deploy / no Argo)
if ! kubectl get crd applications.argoproj.io &>/dev/null; then
  echo "⚠️  Application CRD not found — skipping ArgoCD wait (Argo CD may not be installed)"
  exit 0
fi

# Map an Argo Application name ({env}-{app}) to the Deployment name and
# namespace the overlay actually creates. candidate-a / preview / production
# all use namePrefix=<app>- on namespace cogni-<env>; node-apps have resource
# name `node-app` (→ <app>-node-app), scheduler-worker keeps its own name.
# Any new app added to the catalog must be added here (bug.0326).
resolve_deployment() {
  local app_name="$1"  # {env}-{app}
  local app="${app_name#${DEPLOY_ENVIRONMENT}-}"
  case "$app" in
    scheduler-worker) echo "scheduler-worker" ;;
    operator | poly | resy) echo "${app}-node-app" ;;
    *) echo "" ;;  # unknown app — caller treats empty as "skip digest check"
  esac
}

# Block until the Deployment's new ReplicaSet is fully available AND the old
# ReplicaSet's pods are gone. Called AFTER sync.revision + Healthy to close
# bug.0326 (Argo-level Healthy ≠ pods-serving-new-image). Uses the remaining
# overall deadline so we don't double-budget the wait.
rollout_check() {
  local app_name="$1"
  local deadline="$2"
  local deployment namespace remaining

  deployment=$(resolve_deployment "$app_name")
  if [ -z "$deployment" ]; then
    echo "    ⚠️  ${app_name}: no Deployment mapping — skipping rollout-status check"
    return 0
  fi
  namespace="cogni-${DEPLOY_ENVIRONMENT}"

  remaining=$((deadline - SECONDS))
  [ "$remaining" -lt 10 ] && remaining=10

  echo "    ↻ ${app_name}: kubectl rollout status deployment/${deployment} -n ${namespace} (up to ${remaining}s)"
  if kubectl -n "$namespace" rollout status "deployment/${deployment}" --timeout="${remaining}s" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Kick a manual sync on an Application by patching an operation into its spec.
# Argo CD's application-controller picks this up within the reconciliation loop
# and runs it even if automated sync is disabled or misconfigured.
trigger_sync() {
  local app_name="$1"
  echo "    ⚡ triggering active sync on ${app_name}"
  kubectl -n argocd patch application "$app_name" --type=merge -p \
    '{"operation":{"sync":{"syncStrategy":{"apply":{"force":false}}}}}' >/dev/null 2>&1 || true
}

# Poll a single app until it reports EXPECTED_SHA on sync.revision AND is Healthy,
# OR until the overall deadline is hit. Triggers an active sync after
# ACTIVE_SYNC_AFTER seconds of no progress.
wait_for_app() {
  local app_name="$1"
  local deadline="$2"
  local active_triggered=0
  local active_deadline=$((SECONDS + ACTIVE_SYNC_AFTER))

  while [ $SECONDS -lt "$deadline" ]; do
    REV=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.sync.revision}' 2>/dev/null || echo "")
    HEALTH=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.health.status}' 2>/dev/null || echo "Unknown")
    SYNC_PHASE=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.operationState.phase}' 2>/dev/null || echo "")

    if [ "$REV" = "$EXPECTED_SHA" ] && [ "$HEALTH" = "Healthy" ]; then
      # bug.0326: sync.revision + health.status are Argo-Application-level
      # signals. During a rolling update, "Healthy" fires as soon as enough
      # pods are Ready — which includes the OLD ReplicaSet's pods. /readyz
      # from those pods serves the prior BUILD_SHA. Before declaring this
      # app done, block on `kubectl rollout status`: it only returns 0 when
      # the new ReplicaSet is fully available AND the old pods are torn
      # down. That is the signal verify-buildsha.sh needs downstream.
      if rollout_check "$app_name" "$deadline"; then
        echo "  ✅ ${app_name} at ${REV:0:8} (Healthy + rollout complete)"
        return 0
      fi
      echo "  ❌ ${app_name} rollout did not complete (sync.revision=${REV:0:8} Healthy but stale ReplicaSet still present)"
      return 1
    fi
    echo "    ${app_name}: rev=${REV:0:8} expected=${EXPECTED_SHA:0:8} health=${HEALTH} phase=${SYNC_PHASE} (waiting...)"

    # Active-sync trigger: fire once, only after first grace period with no progress.
    if [ "$active_triggered" -eq 0 ] && [ $SECONDS -ge "$active_deadline" ]; then
      trigger_sync "$app_name"
      active_triggered=1
    fi

    sleep 10
  done

  echo "  ❌ ${app_name} timed out (rev=${REV:0:8} expected=${EXPECTED_SHA:0:8} health=${HEALTH})"
  return 1
}

FAILED=0
DEADLINE=$((SECONDS + ARGOCD_TIMEOUT))
for app in "${APPS[@]}"; do
  APP_NAME="${DEPLOY_ENVIRONMENT}-${app}"
  echo "  Waiting for ${APP_NAME}..."
  if ! wait_for_app "$APP_NAME" "$DEADLINE"; then
    FAILED=1
  fi
done

if [ $FAILED -ne 0 ]; then
  echo ""
  echo "❌ ArgoCD reconcile failed for one or more apps"
  kubectl -n argocd get applications -o wide 2>/dev/null || true
  exit 1
fi

echo "✅ All ArgoCD apps reconciled and healthy"
REMOTESCRIPT

# SCP script to VM, execute with args, clean up
# shellcheck disable=SC2086
scp $SSH_OPTS "$REMOTE_SCRIPT" root@"$VM_HOST":/tmp/wait-for-argocd-remote.sh
rm -f "$REMOTE_SCRIPT"

# shellcheck disable=SC2086
ssh $SSH_OPTS root@"$VM_HOST" \
  "bash /tmp/wait-for-argocd-remote.sh '$DEPLOY_ENVIRONMENT' '$EXPECTED_SHA' '$ARGOCD_TIMEOUT' '$ACTIVE_SYNC_AFTER' ${APPS[*]}; RC=\$?; rm -f /tmp/wait-for-argocd-remote.sh; exit \$RC"

# Gate-ordering invariant (bug.0321 Fix 4): signal downstream steps in the
# same job that Argo sync was verified at EXPECTED_SHA. wait-for-candidate-ready.sh
# refuses to run without this marker so /readyz probes can never silently
# accept a 200 from old pods while Argo is still reconciling.
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ARGOCD_SYNC_VERIFIED=true" >> "$GITHUB_ENV"
fi
