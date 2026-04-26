#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/ci/snapshot-overlay-digests.sh — task.0373.
#
# Print a TSV of `<target>\t<image-ref>` lines for every ALL_TARGETS app
# whose `infra/k8s/overlays/<OVERLAY_ENV>/<target>/kustomization.yaml`
# exists in the current working directory tree. `image-ref` is whatever
# the overlay currently pins (digest if present, else tag).
#
# Used by candidate-flight.yml's flight job to snapshot the deploy-branch
# overlay digests *before* the PR-branch rsync clobbers them, so a later
# restore step can put back the prior digests for any non-promoted app.
#
# Env:
#   OVERLAY_ENV  (required) e.g. "candidate-a", "preview"
#
# cwd: must be the deploy-branch checkout root (or any tree with the
#      overlay file layout).
#
# Output: TSV on stdout. Apps without an overlay file are silently
#         omitted (legitimate cold-start / undeployed-here cases).
set -euo pipefail

OVERLAY_ENV="${OVERLAY_ENV:?OVERLAY_ENV required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./lib/image-tags.sh
. "$SCRIPT_DIR/lib/image-tags.sh"
# shellcheck source=./lib/overlay-digest.sh
. "$SCRIPT_DIR/lib/overlay-digest.sh"

for target in "${ALL_TARGETS[@]}"; do
  file="infra/k8s/overlays/${OVERLAY_ENV}/${target}/kustomization.yaml"
  if [ ! -f "$file" ]; then
    continue
  fi
  if ref=$(extract_overlay_image_ref "$OVERLAY_ENV" "$target"); then
    printf '%s\t%s\n' "$target" "$ref"
  fi
done
