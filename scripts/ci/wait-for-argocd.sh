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
# during the window between sync and rollout completion. /version from those
# pods serves the prior BUILD_SHA, so downstream verify-buildsha.sh fails
# on a green flight. This script therefore waits for the promoted app's
# Deployment resource inside the Argo Application to report `status=Synced`
# before trusting rollout status. That closes the "revision advanced but
# live Deployment never adopted the new spec" class seen on candidate-a,
# where app-level health was green while operator/resy stayed OutOfSync.
#
# Belt-and-suspenders active sync: if an app's reported revision has not
# caught up to EXPECTED_SHA, we (1) request a hard git refresh on the
# Application. After task.0370 step 1 retired Argo PreSync Job hooks, the
# refresh nudge is the only kick we need — no Job to babysit, no stale hook
# operation to clear. `kubectl rollout status` (run downstream) is the real gate.
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
#   ARGOCD_TIMEOUT      (optional, default 600) per-app timeout in seconds.
#                       600s is conservative headroom — post-task.0370-step1
#                       the runtime image is already warm for the app pod, so
#                       initContainer migrations + rolling-update drain
#                       typically finish well under 60s. Tighten in a follow-up
#                       once we have post-merge flights to measure.
#   ACTIVE_SYNC_AFTER   (optional, default 30) seconds before the first Argo kick
#   SYNC_KICK_INTERVAL  (optional, default 45) seconds between subsequent kicks
#                       (single hard-refresh annotation, no hook babysitting)
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
ARGOCD_TIMEOUT="${ARGOCD_TIMEOUT:-600}"
ACTIVE_SYNC_AFTER="${ACTIVE_SYNC_AFTER:-30}"
SYNC_KICK_INTERVAL="${SYNC_KICK_INTERVAL:-45}"
PROMOTED_APPS="${PROMOTED_APPS:-}"

EXPECTED_SHA=$(printf '%s' "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]')

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

# Args: DEPLOY_ENVIRONMENT EXPECTED_SHA ARGOCD_TIMEOUT ACTIVE_SYNC_AFTER SYNC_KICK_INTERVAL app1 ...
DEPLOY_ENVIRONMENT="$1"
EXPECTED_SHA="$2"
ARGOCD_TIMEOUT="$3"
ACTIVE_SYNC_AFTER="$4"
SYNC_KICK_INTERVAL="$5"
shift 5
APPS=("$@")

EXPECTED_SHA=$(printf '%s' "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]')

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

get_deployment_resource_sync_status() {
  local app_name="$1"
  local deployment

  deployment=$(resolve_deployment "$app_name")
  if [ -z "$deployment" ]; then
    printf ''
    return 0
  fi

  kubectl -n argocd get application "$app_name" \
    -o jsonpath='{range .status.resources[*]}{.kind}{"\t"}{.name}{"\t"}{.status}{"\n"}{end}' \
    2>/dev/null | awk -F '\t' -v deployment="$deployment" '
      $1 == "Deployment" && $2 == deployment {
        print $3
        found = 1
        exit
      }
      END {
        if (!found) {
          print ""
        }
      }
    '
}

deployment_sync_ready() {
  local deployment="$1"
  local status="$2"
  if [ -z "$deployment" ]; then
    return 0
  fi
  [ "$status" = "Synced" ]
}

# Block until the Deployment's new ReplicaSet is fully available AND the old
# ReplicaSet's pods are gone. Called AFTER sync.revision + Healthy to close
# bug.0326 (Argo-level Healthy ≠ pods-serving-new-image). Uses the per-app
# deadline so later apps are not starved by earlier reconciles.
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

# task.0370 step 1 retired Argo PreSync hook Jobs — migrations are now
# Deployment initContainers. The pre-sync hook-Job babysitting (delete_stale_hook_jobs,
# clear_stale_missing_hook_operation) is gone with the hooks. The kick that
# remains is just a hard-refresh annotation poke; if Argo is in Running/phase=Running
# during a rolling update, kubectl rollout status (run after this script) is the
# real gate.

# Prefer status.sync.revision; fall back to last successful operation revision
# (some Argo states leave sync.revision empty while a sync completed).
get_app_revision() {
  local app_name="$1"
  local r=""
  r=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.sync.revision}' 2>/dev/null || true)
  r=$(printf '%s' "$r" | tr -d '[:space:]')
  if [ -z "$r" ]; then
    r=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.operationState.syncResult.revision}' 2>/dev/null || true)
    r=$(printf '%s' "$r" | tr -d '[:space:]')
  fi
  printf '%s' "$r" | tr '[:upper:]' '[:lower:]'
}

# Force repo-server to re-resolve the deploy branch (stale cache wedged flights).
request_hard_refresh() {
  local app_name="$1"
  local out
  if ! out=$(kubectl -n argocd patch application "$app_name" --type=merge -p \
    '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}' 2>&1); then
    echo "    ⚠️  hard-refresh annotation patch failed for ${app_name}: $out" >&2
  fi
}

# Poll a single app until it reports EXPECTED_SHA on sync.revision AND is Healthy,
# OR until its per-app deadline is hit. Re-kicks Argo periodically while mismatched.
wait_for_app() {
  local app_name="$1"
  local timeout_seconds="$2"
  local deadline=$((SECONDS + timeout_seconds))
  local next_kick=$((SECONDS + ACTIVE_SYNC_AFTER))
  local kick_count=0
  local deployment deployment_status

  deployment=$(resolve_deployment "$app_name")

  while [ $SECONDS -lt "$deadline" ]; do
    REV=$(get_app_revision "$app_name")
    HEALTH=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.health.status}' 2>/dev/null || echo "Unknown")
    SYNC_PHASE=$(kubectl -n argocd get application "$app_name" -o jsonpath='{.status.operationState.phase}' 2>/dev/null || echo "")
    deployment_status=""
    if [ -n "$deployment" ]; then
      deployment_status=$(get_deployment_resource_sync_status "$app_name")
    fi

    # Decide whether to proceed to the authoritative kubectl rollout check.
    # Only accept: Healthy, OR Progressing when sync operation completed.
    # The kubectl rollout check is the real gate — health is just the preliminary filter.
    can_proceed_to_rollout_check() {
      local health="$1"
      local phase="$2"
      [ "$health" = "Healthy" ] && return 0
      [ "$health" = "Progressing" ] && [ "$phase" = "Succeeded" ] && return 0
      return 1
    }

    # First verify revision matches, then ensure Argo reports the promoted
    # Deployment resource itself as Synced before trusting rollout status.
    if [ "$REV" = "$EXPECTED_SHA" ] &&
       can_proceed_to_rollout_check "$HEALTH" "$SYNC_PHASE" &&
       deployment_sync_ready "$deployment" "$deployment_status"; then
      # bug.0326: sync.revision + health.status are Argo-Application-level
      # signals. During a rolling update, "Healthy" fires as soon as enough
      # pods are Ready — which includes the OLD ReplicaSet's pods. /version
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

    if [ -n "$deployment" ]; then
      echo "    ${app_name}: rev=${REV:0:8} expected=${EXPECTED_SHA:0:8} health=${HEALTH} phase=${SYNC_PHASE} deployment=${deployment} deploymentStatus=${deployment_status:-<missing>} (waiting...)"
    else
      echo "    ${app_name}: rev=${REV:0:8} expected=${EXPECTED_SHA:0:8} health=${HEALTH} phase=${SYNC_PHASE} (waiting...)"
    fi

    if [ $SECONDS -ge "$next_kick" ] &&
       { [ "$REV" != "$EXPECTED_SHA" ] ||
         ! can_proceed_to_rollout_check "$HEALTH" "$SYNC_PHASE" ||
         ! deployment_sync_ready "$deployment" "$deployment_status"; }; then
      kick_count=$((kick_count + 1))
      echo "    ⚡ ${app_name}: Argo hard-refresh kick #${kick_count}"
      request_hard_refresh "$app_name"
      next_kick=$((SECONDS + SYNC_KICK_INTERVAL))
    fi

    sleep 10
  done

  echo "  ❌ ${app_name} timed out (rev=${REV:0:8} health=${HEALTH} phase=${SYNC_PHASE})"
  kubectl -n argocd get application "$app_name" -o jsonpath='{.status.sync.status} {.status.health.status} phase={.status.operationState.phase} msg={.status.operationState.message}{"\n"}' 2>/dev/null || true
  return 1
}

FAILED=0
for app in "${APPS[@]}"; do
  APP_NAME="${DEPLOY_ENVIRONMENT}-${app}"
  echo "  Waiting for ${APP_NAME}..."
  if ! wait_for_app "$APP_NAME" "$ARGOCD_TIMEOUT"; then
    FAILED=1
  fi
done

if [ $FAILED -ne 0 ]; then
  echo ""
  echo "❌ ArgoCD reconcile failed for one or more apps"
  # Only dump apps we're waiting for, not all argocd apps
  for app in "${APPS[@]}"; do
    APP_NAME="${DEPLOY_ENVIRONMENT}-${app}"
    kubectl -n argocd get application "$APP_NAME" -o jsonpath='{.metadata.name} {.status.sync.status} {.status.health.status} phase={.status.operationState.phase}{"\n"}' 2>/dev/null || true
  done
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
  "bash /tmp/wait-for-argocd-remote.sh '$DEPLOY_ENVIRONMENT' '$EXPECTED_SHA' '$ARGOCD_TIMEOUT' '$ACTIVE_SYNC_AFTER' '$SYNC_KICK_INTERVAL' ${APPS[*]}; RC=\$?; rm -f /tmp/wait-for-argocd-remote.sh; exit \$RC"

# Gate-ordering invariant (bug.0321 Fix 4): signal downstream steps in the
# same job that Argo sync was verified at EXPECTED_SHA. wait-for-candidate-ready.sh
# refuses to run without this marker so /readyz probes can never silently
# accept a 200 from old pods while Argo is still reconciling.
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "ARGOCD_SYNC_VERIFIED=true" >> "$GITHUB_ENV"
fi
