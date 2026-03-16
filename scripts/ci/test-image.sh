#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

set -euo pipefail

# Error trap with cleanup
trap 'code=$?; echo "[ERROR] image test failed"; docker rm -f test-container 2>/dev/null || true; exit $code' ERR

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validate image reference
if [[ -n "${FULL_IMAGE:-}" ]]; then
    IMAGE_REF="$FULL_IMAGE"
elif [[ -n "${IMAGE_NAME:-}" ]] && [[ -n "${IMAGE_TAG:-}" ]]; then
    IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
else
    log_error "Either FULL_IMAGE or (IMAGE_NAME + IMAGE_TAG) required"
    exit 1
fi

log_info "Testing image: $IMAGE_REF"

# Start test container with MINIMAL env (liveness gate, not readiness)
log_info "Starting test container with minimal env..."
docker run -d --name test-container \
    -p 3000:3000 \
    -e NODE_ENV=production \
    -e APP_ENV=test \
    -e DATABASE_URL=postgresql://testuser:testpass@localhost:5432/testdb \
    "${IMAGE_REF}"

# Poll /livez endpoint (fast liveness gate, 10-20s budget)
# Do NOT use Docker HEALTHCHECK (requires full env for /readyz)
log_info "Polling /livez endpoint (10-20s budget)..."
for i in {1..10}; do
    if curl -fsS http://localhost:3000/livez >/dev/null 2>&1; then
        log_info "✅ Liveness check passed (/livez responding)"
        RESPONSE=$(curl -s http://localhost:3000/livez)
        log_info "Response: $RESPONSE"
        break
    elif [[ $i -eq 10 ]]; then
        log_error "Liveness gate failed (20s timeout)"
        log_error "Attempting to fetch response for debugging:"
        curl -v http://localhost:3000/livez 2>&1 || true
        log_error ""
        log_error "Container logs:"
        docker logs test-container
        exit 1
    else
        log_info "Attempt $i/10: /livez not ready, waiting..."
        sleep 2
    fi
done

# Cleanup
log_info "Cleaning up test container..."
docker rm -f test-container

log_info "✅ Image test passed successfully"
