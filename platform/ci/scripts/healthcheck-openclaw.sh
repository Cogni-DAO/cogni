#!/bin/bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: platform/ci/scripts/healthcheck-openclaw.sh
# Purpose: Wait for OpenClaw gateway services to become healthy after compose up.
# Usage:   bash healthcheck-openclaw.sh "docker compose --project-name cogni-runtime ..."
# Exit:    0 = both services healthy, 1 = timeout or crash
# Notes:   Uses Docker healthcheck status (compose healthchecks already defined).
#          llm-proxy-openclaw: wget on :8080/health
#          openclaw-gateway:   TCP connect on :18789

set -euo pipefail

COMPOSE_CMD="${1:?Usage: healthcheck-openclaw.sh COMPOSE_CMD}"
TIMEOUT="${2:-180}"

SERVICES=(openclaw-gateway llm-proxy-openclaw)

log_info()  { echo -e "\033[0;32m[INFO]\033[0m $1"; }
log_warn()  { echo -e "\033[1;33m[WARN]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; }

deadline=$((SECONDS + TIMEOUT))
while true; do
    if (( SECONDS >= deadline )); then
        log_error "OpenClaw services failed to become healthy (${TIMEOUT}s timeout)"
        for svc in "${SERVICES[@]}"; do
            $COMPOSE_CMD logs --tail=50 "$svc" 2>/dev/null || true
        done
        exit 1
    fi

    all_healthy=true
    for svc in "${SERVICES[@]}"; do
        cid="$($COMPOSE_CMD ps -q "$svc" 2>/dev/null || true)"
        if [[ -z "$cid" ]]; then
            status="missing"
            restarting="false"
            health="none"
        else
            container_info="$(docker inspect -f '{{.State.Status}} {{.State.Restarting}}' "$cid" 2>/dev/null || echo 'missing false')"
            status="${container_info%% *}"
            restarting="${container_info##* }"
            health="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo 'none')"
        fi

        # Fail fast on crash
        if [[ "$status" == "exited" || "$status" == "dead" || "$status" == "missing" || "$restarting" == "true" ]]; then
            log_error "OpenClaw service '$svc' failed (State: $status, Restarting: $restarting)"
            $COMPOSE_CMD logs --tail=100 "$svc" 2>/dev/null || true
            exit 1
        fi

        if [[ "$health" != "healthy" ]]; then
            all_healthy=false
        fi
    done

    if $all_healthy; then
        log_info "OpenClaw services healthy: ${SERVICES[*]}"
        exit 0
    fi

    sleep 3
done
