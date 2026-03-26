#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/promote-k8s-image.sh
# Purpose: Update k8s overlay with new scheduler-worker image digest, commit to staging.
# Invariants:
#   - IMAGE_IMMUTABILITY: Uses @sha256: digest, never mutable tags
#   - MANIFEST_DRIVEN_DEPLOY: Promotion = overlay change → Argo CD syncs
#   - Only updates staging overlay (production promotion is a manual PR)
# Usage:
#   SCHEDULER_WORKER_DIGEST=ghcr.io/cogni-dao/cogni-template@sha256:abc123... \
#     scripts/ci/promote-k8s-image.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Validate input
if [[ -z "${SCHEDULER_WORKER_DIGEST:-}" ]]; then
    log_error "SCHEDULER_WORKER_DIGEST is required (e.g., ghcr.io/cogni-dao/cogni-template@sha256:abc...)"
    exit 1
fi

# Validate it's a digest ref (contains @sha256:)
if [[ "$SCHEDULER_WORKER_DIGEST" != *"@sha256:"* ]]; then
    log_error "SCHEDULER_WORKER_DIGEST must be a digest ref (contain @sha256:), got: $SCHEDULER_WORKER_DIGEST"
    exit 1
fi

# Extract image name and digest
IMAGE_NAME="${SCHEDULER_WORKER_DIGEST%%@*}"
DIGEST="${SCHEDULER_WORKER_DIGEST#*@}"

OVERLAY_FILE="infra/cd/overlays/staging/scheduler-worker/kustomization.yaml"

if [[ ! -f "$OVERLAY_FILE" ]]; then
    log_error "Overlay file not found: $OVERLAY_FILE"
    exit 1
fi

log_info "Promoting scheduler-worker image in staging overlay"
log_info "  Image: $IMAGE_NAME"
log_info "  Digest: $DIGEST"

# Update the kustomization.yaml images section.
# Uses | as sed delimiter to avoid conflicts with / in image URLs.
# Handles both first-run (newTag → digest) and subsequent runs (digest → digest).

# Update newName
sed -i.bak "s|newName: .*|newName: ${IMAGE_NAME}|" "$OVERLAY_FILE"

# Replace newTag with digest (first promotion) or update existing digest (re-run)
if grep -q 'newTag:' "$OVERLAY_FILE"; then
    # First run: replace newTag line with digest line
    sed -i.bak "s|.*newTag:.*|    digest: \"${DIGEST}\"|" "$OVERLAY_FILE"
elif grep -q 'digest:' "$OVERLAY_FILE"; then
    # Re-run: update existing digest value
    sed -i.bak "s|digest: .*|digest: \"${DIGEST}\"|" "$OVERLAY_FILE"
else
    # Safety fallback: add digest after newName
    sed -i.bak "/newName: /a\\
    digest: \"${DIGEST}\"" "$OVERLAY_FILE"
fi

# Update the ConfigMap IMAGE_DIGEST patch value
sed -i.bak \
    -e "s|value: \"staging-placeholder-scheduler-worker\"|value: \"${DIGEST}\"|" \
    -e "s|value: \"sha256:.*\"|value: \"${DIGEST}\"|" \
    "$OVERLAY_FILE"

rm -f "${OVERLAY_FILE}.bak"

log_info "Updated $OVERLAY_FILE"

# Commit and push if in CI
if [[ -n "${GITHUB_SHA:-}" ]]; then
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add "$OVERLAY_FILE"

    # Only commit if there are actual changes
    if git diff --cached --quiet; then
        log_info "No changes to commit (digest unchanged)"
    else
        git commit -m "chore(cd): promote scheduler-worker to ${DIGEST:0:19}... [skip ci]"
        git push origin staging
        log_info "Committed and pushed digest update to staging"
    fi
else
    log_info "Not in CI — skipping commit. Review changes manually:"
    git diff "$OVERLAY_FILE" || true
fi
