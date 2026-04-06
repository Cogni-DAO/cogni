#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/check-fast.sh
# Purpose: Lightweight quality gate for iterative development: typecheck + lint/format fix + unit tests.
#          Always auto-fixes lint and format issues. Use during iteration; run full `pnpm check` once
#          before committing.
# Usage: pnpm check:fast          # Compact output (quiet mode)
#        pnpm check:fast:verbose  # Full banners + live streaming output
#        Direct: bash scripts/check-fast.sh [--verbose]
# Exit: 0 if all checks pass, 1 if any check fails
# Side-effects: Modifies files via ESLint and Prettier auto-fix

set +e
set -o pipefail
set -u

EXIT_CODE=0
FAILED_CHECKS=()
VERBOSE=false

FAILED_NAMES=()
FAILED_OUTPUTS=()

for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
  esac
done

run_check() {
  local name=$1
  local command=$2
  local start=$(date +%s)

  if [ "$VERBOSE" = true ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Running $name..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if eval "$command"; then
      local duration=$(($(date +%s) - start))
      echo ""
      echo "✓ $name passed (${duration}s)"
    else
      EXIT_CODE=1
      local duration=$(($(date +%s) - start))
      FAILED_CHECKS+=("$name (${duration}s)")
      echo ""
      echo "✗ $name failed (${duration}s)"
    fi
  else
    local output
    output=$(eval "$command" 2>&1)
    local status=$?
    local duration=$(($(date +%s) - start))

    if [ $status -eq 0 ]; then
      echo "✓ $name passed (${duration}s)"
    else
      EXIT_CODE=1
      FAILED_CHECKS+=("$name (${duration}s)")
      FAILED_NAMES+=("$name")
      FAILED_OUTPUTS+=("$output")
      echo "✗ $name failed (${duration}s)"
    fi
  fi
}

if [ "$VERBOSE" = true ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Starting fast checks (auto-fix enabled)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

# Rebuild package declarations before typecheck — stale dist/*.d.ts causes
# false errors when package source changes (e.g. adding a field to a port interface).
run_check "packages:build" "pnpm packages:build"
run_check "typecheck" "pnpm typecheck"
run_check "lint" "pnpm lint:fix"
run_check "format" "pnpm format"
run_check "test:app" "pnpm vitest run --config nodes/operator/app/vitest.config.mts"
run_check "test:packages:local" "pnpm test:packages:local"
run_check "test:services:local" "pnpm test:services:local"

if [ "$VERBOSE" = true ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "SUMMARY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
  echo "✓ All fast checks passed!"
else
  echo "✗ ${#FAILED_CHECKS[@]} check(s) failed:"
  for check in "${FAILED_CHECKS[@]}"; do
    echo "  - $check"
  done
fi

if [ "$VERBOSE" = true ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

if [ "$VERBOSE" = false ] && [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  echo ""
  for i in "${!FAILED_NAMES[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Output from failed check: ${FAILED_NAMES[$i]}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "${FAILED_OUTPUTS[$i]}"
    echo ""
  done
fi

exit $EXIT_CODE
