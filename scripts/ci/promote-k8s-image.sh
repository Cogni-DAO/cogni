#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/promote-k8s-image.sh
# Purpose: Update k8s overlay with new image digest for any app/node, commit to branch.
# Note: sed uses GNU extensions (0, address). Runs in CI (ubuntu). Local use: review diff only.
# Invariants:
#   - IMAGE_IMMUTABILITY: Uses @sha256: digest, never mutable tags
#   - MANIFEST_DRIVEN_DEPLOY: Promotion = overlay change → Argo CD syncs
#   - Only updates staging overlay (production promotion is via release branch merge)
# Usage:
#   scripts/ci/promote-k8s-image.sh --app operator --digest ghcr.io/cogni-dao/cogni-template@sha256:abc...
#   scripts/ci/promote-k8s-image.sh --app operator --digest ... --migrator-digest ...
#   scripts/ci/promote-k8s-image.sh --env production --app operator --digest ...

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse args
APP=""
DIGEST=""
MIGRATOR_DIGEST=""
ENV="staging"

while [[ $# -gt 0 ]]; do
  case $1 in
    --app) APP="$2"; shift 2 ;;
    --digest) DIGEST="$2"; shift 2 ;;
    --migrator-digest) MIGRATOR_DIGEST="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    *) log_error "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$APP" || -z "$DIGEST" ]]; then
  log_error "Usage: promote-k8s-image.sh --app <name> --digest <image@sha256:...>"
  exit 1
fi

# Validate digest format
if [[ "$DIGEST" != *"@sha256:"* ]]; then
  log_error "DIGEST must be a digest ref (contain @sha256:), got: $DIGEST"
  exit 1
fi

IMAGE_NAME="${DIGEST%%@*}"
IMAGE_DIGEST="${DIGEST#*@}"

OVERLAY_FILE="infra/k8s/overlays/${ENV}/${APP}/kustomization.yaml"

if [[ ! -f "$OVERLAY_FILE" ]]; then
  log_error "Overlay file not found: $OVERLAY_FILE"
  exit 1
fi

log_info "Promoting $APP image in $ENV overlay"
log_info "  Image: $IMAGE_NAME"
log_info "  Digest: $IMAGE_DIGEST"

# Update the kustomization.yaml images section
# Replace newName with image name
sed -i.bak "0,/newName: .*/s|newName: .*|newName: ${IMAGE_NAME}|" "$OVERLAY_FILE"

# Replace newTag with digest (first run) or update existing digest
if grep -q 'newTag:' "$OVERLAY_FILE"; then
  sed -i.bak "0,/newTag: .*/s|.*newTag:.*|    digest: \"${IMAGE_DIGEST}\"|" "$OVERLAY_FILE"
elif grep -q 'digest:' "$OVERLAY_FILE"; then
  sed -i.bak "0,/digest: .*/s|digest: .*|digest: \"${IMAGE_DIGEST}\"|" "$OVERLAY_FILE"
fi

# Handle migrator digest if provided (node apps have a second image entry)
if [[ -n "$MIGRATOR_DIGEST" ]]; then
  MIGRATOR_IMAGE_NAME="${MIGRATOR_DIGEST%%@*}"
  MIGRATOR_IMAGE_DIGEST="${MIGRATOR_DIGEST#*@}"
  log_info "  Migrator: $MIGRATOR_IMAGE_NAME"
  log_info "  Migrator digest: $MIGRATOR_IMAGE_DIGEST"
  # Update the second image entry (migrator)
  # Uses a different pattern to target the migrate placeholder
  sed -i.bak "s|newTag: \".*-placeholder-.*-migrate\"|digest: \"${MIGRATOR_IMAGE_DIGEST}\"|" "$OVERLAY_FILE"
fi

rm -f "${OVERLAY_FILE}.bak"

log_info "Updated $OVERLAY_FILE"

# Commit and push if in CI
if [[ -n "${GITHUB_SHA:-}" ]]; then
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git add "$OVERLAY_FILE"

  if git diff --cached --quiet; then
    log_info "No changes to commit (digest unchanged)"
  else
    BRANCH="${GITHUB_REF_NAME:-staging}"
    git commit -m "chore(cd): promote ${APP} to ${IMAGE_DIGEST:0:19}... [skip ci]"
    git push origin "$BRANCH"
    log_info "Committed and pushed digest update to $BRANCH"
  fi
else
  log_info "Not in CI — skipping commit. Review changes manually:"
  git diff "$OVERLAY_FILE" || true
fi
