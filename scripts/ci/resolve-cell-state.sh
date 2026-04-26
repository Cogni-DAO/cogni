#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Per-cell precondition gate for the verify-deploy matrix in
# promote-and-deploy.yml. Reads the promoted/deploy-sha artifact emitted
# by promote-k8s, hard-fails on absence or on incoherent state when the
# cell promoted, and emits promoted= + deploy_branch_sha= to $GITHUB_OUTPUT.
#
# Required env:
#   NODE         matrix node name
#   CELL_DIR     directory containing promoted-${NODE}.txt + deploy-sha-${NODE}.txt
#   ENVIRONMENT  for error messages
#
# Asserted only when promoted=true:
#   VM_HOST      ssh host secret for the env
#
# Optional env:
#   GITHUB_OUTPUT  when set, outputs are written here

set -euo pipefail

: "${NODE:?NODE required}"
: "${CELL_DIR:?CELL_DIR required}"
: "${ENVIRONMENT:?ENVIRONMENT required}"

PROMOTED_FILE="${CELL_DIR}/promoted-${NODE}.txt"
DEPLOY_SHA_FILE="${CELL_DIR}/deploy-sha-${NODE}.txt"

if [ ! -f "$PROMOTED_FILE" ]; then
  echo "::error::cell-${NODE} artifact missing promoted-${NODE}.txt — promote-k8s did not emit per-cell state (Axiom 14)"
  exit 1
fi

PROMOTED=$(cat "$PROMOTED_FILE")
DEPLOY_SHA=$(cat "$DEPLOY_SHA_FILE" 2>/dev/null || true)

if [ "$PROMOTED" = "true" ]; then
  if [ -z "${VM_HOST:-}" ]; then
    echo "::error::VM_HOST missing in env '${ENVIRONMENT}' but cell promoted — Axiom 19 fail-closed"
    exit 1
  fi
  if [ -z "$DEPLOY_SHA" ]; then
    echo "::error::deploy_branch_sha empty but cell promoted — Axiom 19 fail-closed"
    exit 1
  fi
fi

echo "promoted=${PROMOTED} deploy_branch_sha=${DEPLOY_SHA}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "promoted=${PROMOTED}"
    echo "deploy_branch_sha=${DEPLOY_SHA}"
  } >> "$GITHUB_OUTPUT"
fi
