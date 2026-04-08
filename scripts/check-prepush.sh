#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/check-prepush.sh
# Purpose: Pre-push validation that mirrors CI's baseline "checks" job as closely as possible.
#          Unlike check-fast.sh, this script must NOT auto-fix code, since auto-fixes wouldn't be included
#          in the pushed commit and can mask CI failures.
# Usage: pnpm check:prepush
# Exit: 0 if all checks pass, 1 otherwise

set -euo pipefail

echo "Pre-push checks (CI baseline)..."

# Match CI's diff base for affected scope. Pre-push hooks often run on branches
# whose upstream is the remote branch itself, which would result in "affected: none".
export TURBO_SCM_BASE="${TURBO_SCM_BASE:-origin/canary}"
export TURBO_SCM_HEAD="${TURBO_SCM_HEAD:-HEAD}"

# CI baseline builds all workspace packages before running root vitest suites.
pnpm packages:build

# Workspace-scoped checks (matches CI turbo behavior).
bash scripts/run-turbo-checks.sh typecheck
bash scripts/run-turbo-checks.sh lint
bash scripts/run-turbo-checks.sh test --concurrency=1

# Repo-global checks (matches CI root steps).
pnpm format:check
pnpm check:root-layout
pnpm validate:chain
pnpm check:docs
pnpm arch:check

# Root vitest suite + contracts/coverage (CI runs this in the checks job).
pnpm test:ci
