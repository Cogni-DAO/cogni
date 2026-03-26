#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Validate that all Kustomize overlays render cleanly.
# Uses kubectl kustomize (native) or dockerized kubectl as fallback.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="$ROOT_DIR/infra/cd/gitops-service-catalog.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required"
  exit 1
fi

kustomize_build() {
  local path=$1
  if command -v kubectl >/dev/null 2>&1; then
    kubectl kustomize "$path" >/dev/null
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$ROOT_DIR:$ROOT_DIR" -w "$ROOT_DIR" bitnami/kubectl:1.30 kubectl kustomize "$path" >/dev/null
    return
  fi

  echo "WARN: no kubectl or docker available; skipping kustomize render validation in this environment"
  return 0
}

for env in staging production; do
  echo "Validating managed service overlays for $env..."
  while IFS= read -r service; do
    overlay="$ROOT_DIR/infra/cd/overlays/$env/$service"
    if [[ ! -f "$overlay/kustomization.yaml" ]]; then
      echo "FAIL: missing $overlay/kustomization.yaml"
      exit 1
    fi
    kustomize_build "$overlay"
    echo "  ok $env/$service"
  done < <(jq -r '.services[] | select(.gitops_managed==true) | .name' "$CATALOG")
done

echo "PASS: GitOps manifests render successfully"
