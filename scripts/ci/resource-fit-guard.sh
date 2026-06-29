#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/resource-fit-guard.sh
# Purpose: Existing deploy workflow guard that denies rendered target state
#   before a deploy branch commit/push.
#
# Scope:
#   - Runs from a deploy-branch checkout after overlay mutation and before git push.
#   - Delegates all resource math and policy to check-resource-fit.ts + Conftest.
#   - Does not mutate deploy state, apply AppSets, or query live clusters.
#
# Env:
#   RESOURCE_FIT_ENV       candidate-a | preview | production
#   APP_SOURCE_DIR         checkout containing scripts/ci/check-resource-fit.ts
#   BASELINE_OVERLAY_ROOT  pre-mutation infra/k8s/overlays snapshot
#   CURRENT_OVERLAY_ROOT   post-mutation infra/k8s/overlays (default: infra/k8s/overlays)
#   REPORT_DIR             optional report output dir

set -euo pipefail

RESOURCE_FIT_ENV=${RESOURCE_FIT_ENV:-}
APP_SOURCE_DIR=${APP_SOURCE_DIR:-../app-src}
CURRENT_OVERLAY_ROOT=${CURRENT_OVERLAY_ROOT:-infra/k8s/overlays}
BASELINE_OVERLAY_ROOT=${BASELINE_OVERLAY_ROOT:-}
REPORT_DIR=${REPORT_DIR:-${RUNNER_TEMP:-.}/resource-fit}

if [ -z "$RESOURCE_FIT_ENV" ]; then
  echo "::error::RESOURCE_FIT_ENV is required" >&2
  exit 1
fi

if [ -z "$BASELINE_OVERLAY_ROOT" ] || [ ! -d "$BASELINE_OVERLAY_ROOT" ]; then
  echo "::error::BASELINE_OVERLAY_ROOT must point to a pre-mutation overlay snapshot" >&2
  exit 1
fi

if [ ! -d "$CURRENT_OVERLAY_ROOT" ]; then
  echo "::error::CURRENT_OVERLAY_ROOT not found: $CURRENT_OVERLAY_ROOT" >&2
  exit 1
fi

mkdir -p "$REPORT_DIR"

APP_SOURCE_DIR_ABS="$(cd "$APP_SOURCE_DIR" && pwd)"
CURRENT_OVERLAY_ROOT_ABS="$(cd "$CURRENT_OVERLAY_ROOT" && pwd)"
BASELINE_OVERLAY_ROOT_ABS="$(cd "$BASELINE_OVERLAY_ROOT" && pwd)"
REPORT_DIR_ABS="$(cd "$REPORT_DIR" && pwd)"
WORK_ROOT="$(cd "$APP_SOURCE_DIR_ABS/.." && pwd)"
TSX_BIN="$APP_SOURCE_DIR_ABS/node_modules/.bin/tsx"

if [ ! -x "$TSX_BIN" ]; then
  echo "::error::tsx not found at $TSX_BIN; install app-src dependencies first" >&2
  exit 1
fi

cd "$WORK_ROOT"

"$TSX_BIN" "$APP_SOURCE_DIR_ABS/scripts/ci/check-resource-fit.ts" \
  --env "$RESOURCE_FIT_ENV" \
  --budget "$APP_SOURCE_DIR_ABS/infra/capacity/envs.yaml" \
  --policy "$APP_SOURCE_DIR_ABS/infra/policy/resource-fit" \
  --overlay-root "$CURRENT_OVERLAY_ROOT_ABS" \
  --baseline-overlay-root "$BASELINE_OVERLAY_ROOT_ABS" \
  --json-out "$REPORT_DIR_ABS/${RESOURCE_FIT_ENV}.json" \
  --markdown-out "$REPORT_DIR_ABS/${RESOURCE_FIT_ENV}.md" \
  --github-step-summary true
