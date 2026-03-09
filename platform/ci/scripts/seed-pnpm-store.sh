#!/bin/bash
# Script: platform/ci/scripts/seed-pnpm-store.sh
# Purpose: Deploy-time wrapper — pulls GHCR store image, delegates to reusable seed script.
# Notes:
#   - Sourced (not executed) from deploy-remote.sh (Step 7.5) after image pull
#   - Inherits log_info, log_warn, emit_deployment_event functions from caller
# Links: work/items/task.0031.openclaw-cogni-dev-image.md

# $PNPM_STORE_IMAGE set by deploy-remote.sh (Step 6+7) and already pulled.
PNPM_STORE_IMAGE="${PNPM_STORE_IMAGE:?PNPM_STORE_IMAGE must be set by caller}"

log_info "Seeding pnpm_store volume..."

bash /tmp/seed-pnpm-store-core.sh --image "$PNPM_STORE_IMAGE" --volume pnpm_store \
  && emit_deployment_event "deployment.pnpm_store_seeded" "success" "pnpm store seeded" \
  || log_warn "pnpm-store seed failed (non-fatal)"
