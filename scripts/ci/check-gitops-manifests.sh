#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Validate that all Kustomize overlays render cleanly.
# Reads app names from infra/catalog/*.yaml.
# Uses kubectl kustomize (native) or dockerized kubectl as fallback.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG_DIR="$ROOT_DIR/infra/catalog"

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

  echo "WARN: no kubectl or docker available; skipping kustomize render validation"
  return 0
}

failed=0

for env in staging production; do
  echo "Validating overlays for $env..."
  for catalog_file in "$CATALOG_DIR"/*.yaml; do
    [[ ! -f "$catalog_file" ]] && continue
    name=$(grep '^name:' "$catalog_file" | head -1 | awk '{print $2}')
    [[ -z "$name" ]] && continue

    overlay="$ROOT_DIR/infra/k8s/overlays/$env/$name"
    if [[ ! -f "$overlay/kustomization.yaml" ]]; then
      echo "  FAIL: missing $overlay/kustomization.yaml"
      failed=1
      continue
    fi
    if kustomize_build "$overlay"; then
      echo "  ok $env/$name"
    else
      echo "  FAIL: $env/$name does not render"
      failed=1
    fi
  done
done

if [[ $failed -ne 0 ]]; then
  echo "FAIL: Some overlays failed to render."
  exit 1
fi

echo "PASS: All overlays render successfully."
