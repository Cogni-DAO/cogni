#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/check-all.sh
# Purpose: Runs ALL quality checks (typecheck, lint, format, test, docs, arch) to completion,
#          never stopping at first failure. Provides structured output with timing,
#          visual separation, and summary reporting optimized for AI developer workflows.
# Usage: pnpm check          # Compact output (quiet mode)
#        pnpm check:verbose  # Full banners + live streaming output
#        pnpm check:fix      # Run with auto-fixers
#        Direct: bash scripts/check-all.sh [--fix] [--verbose]
# Exit: 0 if all checks pass, 1 if any check fails
# Shell options:
#   - set +e: Disables fail-fast to ensure all checks run
#   - set -o pipefail: Catches failures in piped commands
#   - set -u: Treats unbound variables as errors
# Side-effects: None in default mode; --fix mode modifies files via ESLint and Prettier
# Links: docs/spec/style.md, AGENTS.md, package.json:41-42, vitest.config.mts

set +e
set -o pipefail
set -u

EXIT_CODE=0
FAILED_CHECKS=()
FIX_MODE=false
VERBOSE=false

# Parallel arrays to store failed check names and their captured output
FAILED_NAMES=()
FAILED_OUTPUTS=()

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --fix) FIX_MODE=true ;;
    --verbose) VERBOSE=true ;;
  esac
done

run_check() {
  local name=$1
  local command=$2
  local start=$(date +%s)

  if [ "$VERBOSE" = true ]; then
    # Verbose mode: banners + live streaming (original behavior)
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
    # Quiet mode: capture output, print single status line
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
  if [ "$FIX_MODE" = true ]; then
    echo "Starting checks with auto-fix..."
  else
    echo "Starting checks..."
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

run_check "packages:build" "pnpm packages:build > /dev/null"
run_check "typecheck" "pnpm typecheck"

if [ "$FIX_MODE" = true ]; then
  run_check "lint" "pnpm lint:fix"
  run_check "format" "pnpm format"
else
  run_check "lint" "pnpm lint"
  run_check "format" "pnpm format:check"
fi

run_check "ui-tokens" "bash scripts/check-ui-tokens.sh"

# App tests run via nodes/operator/app config (resolves @/ from app node_modules).
run_check "test:app" "pnpm vitest run --config nodes/operator/app/vitest.config.mts"
run_check "test:packages:local" "pnpm test:packages:local"
run_check "test:services:local" "pnpm test:services:local"
run_check "check:docs" "pnpm check:docs"
run_check "check:root-layout" "pnpm check:root-layout"
run_check "arch:check" "pnpm arch:check"

if [ "$VERBOSE" = true ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "SUMMARY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

if [ ${#FAILED_CHECKS[@]} -eq 0 ]; then
  echo "✓ All checks passed!"
else
  echo "✗ ${#FAILED_CHECKS[@]} check(s) failed:"
  for check in "${FAILED_CHECKS[@]}"; do
    echo "  - $check"
  done
fi

if [ "$VERBOSE" = true ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi

# In quiet mode, dump captured output for each failed check
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
