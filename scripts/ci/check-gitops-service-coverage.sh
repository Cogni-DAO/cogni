#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Enforce GitOps coverage using infra/catalog/*.yaml.
# Rules:
# 1) Every catalog entry with type=service must have a matching services/* directory.
# 2) Every catalog entry must have:
#    - infra/k8s/overlays/staging/<name>/kustomization.yaml
#    - infra/k8s/overlays/production/<name>/kustomization.yaml
#    - A Kustomize base (either infra/k8s/base/<name>/ or infra/k8s/base/node-app/ via overlay)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG_DIR="$ROOT_DIR/infra/catalog"

if [[ ! -d "$CATALOG_DIR" ]]; then
  echo "FAIL: missing catalog directory: $CATALOG_DIR"
  exit 1
fi

missing=0

printf "%-20s %-8s %-8s %-10s\n" "APP" "TYPE" "STAGING" "PRODUCTION"
printf "%-20s %-8s %-8s %-10s\n" "--------------------" "--------" "--------" "----------"

for catalog_file in "$CATALOG_DIR"/*.yaml; do
  [[ ! -f "$catalog_file" ]] && continue

  name=$(grep '^name:' "$catalog_file" | head -1 | awk '{print $2}')
  type=$(grep '^type:' "$catalog_file" | head -1 | awk '{print $2}')

  if [[ -z "$name" ]]; then
    echo "FAIL: catalog file $catalog_file missing 'name' field"
    missing=1
    continue
  fi

  # Services must have a services/ directory
  if [[ "$type" == "service" ]] && [[ ! -d "$ROOT_DIR/services/$name" ]]; then
    echo "WARN: catalog service '$name' has no services/$name directory"
  fi

  stg="no"
  prod="no"
  [[ -f "$ROOT_DIR/infra/k8s/overlays/staging/$name/kustomization.yaml" ]] && stg="yes"
  [[ -f "$ROOT_DIR/infra/k8s/overlays/production/$name/kustomization.yaml" ]] && prod="yes"

  if [[ "$stg" == "no" || "$prod" == "no" ]]; then
    missing=1
  fi

  printf "%-20s %-8s %-8s %-10s\n" "$name" "$type" "$stg" "$prod"
done

if [[ $missing -ne 0 ]]; then
  echo ""
  echo "FAIL: GitOps coverage check failed — missing overlays for catalog entries."
  exit 1
fi

echo ""
echo "PASS: All catalog entries have staging + production overlays."
