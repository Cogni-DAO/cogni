#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Enforce GitOps coverage using infra/cd/gitops-service-catalog.json.
# Rules:
# 1) Every services/* directory must be declared in the catalog.
# 2) Every catalog service marked gitops_managed=true must have:
#    - infra/cd/base/<service>/
#    - infra/cd/argocd/applications/<service>.yaml
#    - infra/cd/overlays/staging/kustomization.yaml
#    - infra/cd/overlays/production/kustomization.yaml

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICES_DIR="$ROOT_DIR/services"
CATALOG="$ROOT_DIR/infra/cd/gitops-service-catalog.json"
BASE_DIR="$ROOT_DIR/infra/cd/base"
APPS_DIR="$ROOT_DIR/infra/cd/argocd/applications"

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required for check-gitops-service-coverage.sh"
  exit 1
fi

if [[ ! -f "$CATALOG" ]]; then
  echo "FAIL: missing catalog: $CATALOG"
  exit 1
fi

missing=0

declare -A service_dirs
while IFS= read -r service_path; do
  service="$(basename "$service_path")"
  [[ "$service" == "node_modules" ]] && continue
  service_dirs["$service"]=1
done < <(find "$SERVICES_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

printf "%-20s %-8s %-6s %-6s %-8s %-10s\n" "SERVICE" "MANAGED" "BASE" "ARGO" "STAGING" "PRODUCTION"
printf "%-20s %-8s %-6s %-6s %-8s %-10s\n" "--------------------" "--------" "------" "------" "--------" "----------"

while IFS= read -r service; do
  managed=$(jq -r --arg s "$service" '.services[] | select(.name==$s) | .gitops_managed' "$CATALOG")

  if [[ -z "${service_dirs[$service]:-}" ]]; then
    echo "FAIL: catalog references '$service' but services/$service does not exist"
    missing=1
    continue
  fi

  unset 'service_dirs[$service]'

  base="-"
  argo="-"
  stg="-"
  prod="-"

  if [[ "$managed" == "true" ]]; then
    base="no"; argo="no"; stg="no"; prod="no"
    [[ -d "$BASE_DIR/$service" ]] && base="yes"
    [[ -f "$APPS_DIR/$service.yaml" ]] && argo="yes"
    [[ -f "$ROOT_DIR/infra/cd/overlays/staging/$service/kustomization.yaml" ]] && stg="yes"
    [[ -f "$ROOT_DIR/infra/cd/overlays/production/$service/kustomization.yaml" ]] && prod="yes"

    if [[ "$base" == "no" || "$argo" == "no" || "$stg" == "no" || "$prod" == "no" ]]; then
      missing=1
    fi
  fi

  printf "%-20s %-8s %-6s %-6s %-8s %-10s\n" "$service" "$managed" "$base" "$argo" "$stg" "$prod"
done < <(jq -r '.services[].name' "$CATALOG" | sort)

for undeclared in "${!service_dirs[@]}"; do
  echo "FAIL: services/$undeclared exists but is not declared in infra/cd/gitops-service-catalog.json"
  missing=1
done

if [[ $missing -ne 0 ]]; then
  echo ""
  echo "FAIL: GitOps service coverage catalog check failed."
  exit 1
fi

echo ""
echo "PASS: GitOps service coverage matches catalog."
