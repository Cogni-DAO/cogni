#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Script: scripts/ops/cleanup-candidate-a-shadow-namespaces.sh
# Purpose: One-shot recovery for bug.5009 — delete the preview-* and
#          production-* Argo Applications (and the cogni-preview /
#          cogni-production namespaces they materialized) that were
#          accidentally installed onto candidate-a's k3s cluster by a
#          historical `kubectl kustomize infra/k8s/argocd/ | kubectl apply
#          -n argocd -f -` run (bug.0312 handoff line 91 documented this
#          command without scoping it to candidate-a's ApplicationSet).
#
#          The forward-fix is in infra/k8s/argocd/kustomization.yaml — the
#          per-env *-applicationset.yaml files are no longer in `resources:`
#          so the documented kustomize command is now safe. This script is
#          the recovery action for clusters that were already polluted.
#
# Usage:
#   ssh root@<candidate-a-vm-ip> 'bash -s' < scripts/ops/cleanup-candidate-a-shadow-namespaces.sh
#
#   Or copy + run on the VM:
#     scp scripts/ops/cleanup-candidate-a-shadow-namespaces.sh root@<vm>:/tmp/
#     ssh root@<vm> 'bash /tmp/cleanup-candidate-a-shadow-namespaces.sh'
#
# Idempotent: safe to re-run; uses `--ignore-not-found` and exits 0 when
# nothing to clean.

set -euo pipefail

require_kubectl() {
  command -v kubectl >/dev/null 2>&1 || { echo "FATAL: kubectl not on PATH"; exit 1; }
  kubectl get nodes >/dev/null 2>&1 || { echo "FATAL: kubectl can't reach cluster"; exit 1; }
}

assert_candidate_a() {
  # Defensive: refuse to run on preview / production VMs. Those clusters
  # legitimately own cogni-preview / cogni-production namespaces.
  local ns_count
  ns_count=$(kubectl get ns cogni-candidate-a -o name 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$ns_count" != "1" ]]; then
    echo "FATAL: this cluster has no cogni-candidate-a namespace — refusing"
    echo "       to run on preview/production. Bail out."
    exit 1
  fi
}

cleanup_appsets() {
  # Both ApplicationSets and Applications can exist depending on which
  # YAML was applied. Delete whichever shape is present.
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deleting preview/production ApplicationSets in argocd ns..."
  kubectl -n argocd delete applicationset cogni-preview cogni-production --ignore-not-found

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deleting any stray preview-*/production-* Applications..."
  # ApplicationSets normally cascade-delete child Applications; this
  # cleans up orphans where the AppSet was already gone.
  for app in $(kubectl -n argocd get applications -o name 2>/dev/null | grep -E '^application\.argoproj\.io/(preview|production)-' || true); do
    kubectl -n argocd delete "$app" --ignore-not-found
  done
}

cleanup_namespaces() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Deleting cogni-preview / cogni-production namespaces..."
  kubectl delete namespace cogni-preview cogni-production --ignore-not-found
}

verify_clean() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Post-cleanup state:"
  echo "  argocd applications:"
  kubectl -n argocd get applications -o name | sed 's/^/    /'
  echo "  cogni-* namespaces:"
  kubectl get ns -o name | grep cogni- | sed 's/^/    /'
}

main() {
  require_kubectl
  assert_candidate_a
  cleanup_appsets
  cleanup_namespaces
  verify_clean
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] bug.5009 cleanup complete."
}

main "$@"
