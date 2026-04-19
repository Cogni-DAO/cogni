#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/compute_migrator_fingerprint.sh
# Purpose: Compute content-based fingerprint for a per-node migrator image (task.0322).
# Returns: 12-char hex fingerprint (stdout) based on hash of that node's migrator inputs.
# Usage:
#   MIGRATOR_FINGERPRINT=$(scripts/ci/compute_migrator_fingerprint.sh operator)
#   MIGRATOR_FINGERPRINT=$(scripts/ci/compute_migrator_fingerprint.sh poly)
#   MIGRATOR_FINGERPRINT=$(scripts/ci/compute_migrator_fingerprint.sh resy)
#
# Each node's fingerprint hashes only the files that end up in that node's migrator
# image: its own drizzle config, its own schema barrel + migrations, plus the shared
# packages/db-schema/src (core tables) and root build context files.

set -euo pipefail

NODE="${1:-}"
if [[ -z "$NODE" ]]; then
    echo "[ERROR] usage: $0 <operator|poly|resy>" >&2
    exit 1
fi

case "$NODE" in
    operator)
        MIGRATOR_INPUTS=(
            "nodes/operator/drizzle.config.ts"
            "packages/db-schema/src"
            "nodes/operator/app/src/shared/db"
            "nodes/operator/app/src/adapters/server/db/migrations"
            "nodes/operator/app/Dockerfile"
            "package.json"
            "pnpm-lock.yaml"
        )
        ;;
    poly)
        MIGRATOR_INPUTS=(
            "nodes/poly/drizzle.config.ts"
            "packages/db-schema/src"
            "nodes/poly/packages/db-schema/src"
            "nodes/poly/packages/db-schema/package.json"
            "nodes/poly/app/src/adapters/server/db/migrations"
            "nodes/poly/app/Dockerfile"
            "package.json"
            "pnpm-lock.yaml"
        )
        ;;
    resy)
        MIGRATOR_INPUTS=(
            "nodes/resy/drizzle.config.ts"
            "packages/db-schema/src"
            "nodes/resy/app/src/shared/db"
            "nodes/resy/app/src/adapters/server/db/migrations"
            "nodes/resy/app/Dockerfile"
            "package.json"
            "pnpm-lock.yaml"
        )
        ;;
    *)
        echo "[ERROR] unknown node '$NODE' (expected: operator, poly, or resy)" >&2
        exit 1
        ;;
esac

COMBINED_HASH=""
for input in "${MIGRATOR_INPUTS[@]}"; do
    if [[ -f "$input" ]]; then
        HASH=$(git hash-object "$input")
    elif [[ -d "$input" ]]; then
        HASH=$(git ls-tree -r HEAD "$input" | git hash-object --stdin)
    else
        echo "[ERROR] Migrator input not found: $input" >&2
        exit 1
    fi
    COMBINED_HASH="${COMBINED_HASH}${HASH}"
done

FINGERPRINT=$(echo -n "$COMBINED_HASH" | git hash-object --stdin | cut -c1-12)

echo "$FINGERPRINT"
