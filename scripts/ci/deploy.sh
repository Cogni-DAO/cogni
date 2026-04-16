#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/deploy.sh
# Purpose: Deploy containerized stack to remote VM via SSH with disk-aware cleanup to prevent 'no space left' failures.
# Invariants:
#   - APP_IMAGE and DEPLOY_ENVIRONMENT must be set; secrets via env vars
#   - Prunes BEFORE pull when free < 15GB or used > 70%
#   - TARGETED_PULL: Only pull images that change per deploy (app, migrator, scheduler-worker, sandbox).
#     Static/pinned images (postgres, litellm, alloy, temporal, autoheal, nginx, git-sync, busybox)
#     use local Docker cache. After prune they'll be pulled on next `compose up -d`.
#   - SSH_KEEPALIVE: All SSH connections use ServerAliveInterval to survive long operations.
# Notes:
#   - Dual gate (15GB free / 70% used) prevents overlayfs extraction failures on 40GB disks
#   - Hard prune may force service image re-pull (reliability > speed)
#   - Uses --volumes safely (all state in bind mounts, not named volumes)
# Links: Called by .github/workflows/deploy.yml; uses infra/compose/

set -euo pipefail

# Resolve repo root robustly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

on_fail() {
  code=$?
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[ERROR] deploy failed (exit $code)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  emit_deployment_event "deployment.failed" "failed" "Deployment failed with exit code $code"

  if [[ -n "${VM_HOST:-}" ]]; then
    echo ""
    echo "=== VM disk state ==="
    ssh $SSH_OPTS root@"$VM_HOST" "df -h / 2>/dev/null || true" || true

    echo ""
    echo "=== .env files (redacted) ==="
    ssh $SSH_OPTS root@"$VM_HOST" "head -5 /opt/cogni-template-runtime/.env 2>/dev/null | sed 's/=.*/=***/' || echo '(.env not found)'" || true

    echo ""
    echo "=== edge compose ps ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-edge -f /opt/cogni-template-edge/docker-compose.yml ps 2>&1 || true" || true

    echo ""
    echo "=== runtime compose ps ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml ps 2>&1 || true" || true

    echo ""
    echo "=== logs: caddy (edge) ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-edge -f /opt/cogni-template-edge/docker-compose.yml logs --tail 8 caddy 2>&1 || true" || true

    echo ""
    echo "=== logs: app ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs --tail 80 app 2>&1 || true" || true

    echo ""
    echo "=== logs: litellm ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs --tail 80 litellm 2>&1 || true" || true

    echo ""
    echo "=== healthcheck: litellm ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker inspect --format='{{json .State.Health}}' cogni-runtime-litellm-1 2>&1 || true" || true

    echo ""
    echo "=== logs: scheduler-worker ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs --tail 80 scheduler-worker 2>&1 || true" || true

    echo ""
    echo "=== healthcheck history (all unhealthy/starting containers) ==="
    ssh $SSH_OPTS root@"$VM_HOST" 'for cid in $(docker ps -a --filter "label=com.docker.compose.project=cogni-runtime" --format "{{.ID}}"); do name=$(docker inspect --format="{{.Name}}" "$cid" | sed "s|^/||"); status=$(docker inspect --format="{{.State.Health.Status}}" "$cid" 2>/dev/null || echo "none"); if [ "$status" != "healthy" ] && [ "$status" != "none" ]; then echo "--- $name ($status) ---"; docker inspect --format="{{json .State.Health}}" "$cid" 2>&1; echo; fi; done' || true

  fi

  exit "$code"
}

trap on_fail ERR

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

# Emit deployment event to Grafana Cloud Loki
emit_deployment_event() {
  local event="$1"
  local status="$2"
  local message="$3"

  # Skip if jq not available or Grafana Cloud not configured
  command -v jq >/dev/null 2>&1 || { echo "[deploy] jq missing; skipping deployment event" >&2; return 0; }
  if [[ -z "${GRAFANA_CLOUD_LOKI_URL:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_USER:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_API_KEY:-}" ]]; then
    return 0
  fi

  # Build structured event with low-cardinality labels
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  local nanoseconds=$(date +%s)000000000

  local event_payload=$(jq -n \
    --arg ns "$nanoseconds" \
    --arg event "$event" \
    --arg status "$status" \
    --arg msg "$message" \
    --arg env "${DEPLOY_ENVIRONMENT:-unknown}" \
    --arg commit "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}" \
    --arg actor "${GITHUB_ACTOR:-$(whoami)}" \
    --arg image "${APP_IMAGE:-unknown}" \
    --arg timestamp "$timestamp" \
    '{
      streams: [{
        stream: {
          app: "cogni-template",
          env: $env,
          service: "deployment",
          stream: "stdout"
        },
        values: [[$ns, ({
          level: "info",
          event: $event,
          status: $status,
          msg: $msg,
          commit: $commit,
          actor: $actor,
          appImage: $image,
          time: $timestamp
        } | tostring)]]
      }]
    }')

  # POST to Grafana Cloud Loki (suppress errors to not break deployment)
  curl -s -X POST "$GRAFANA_CLOUD_LOKI_URL" \
    -u "${GRAFANA_CLOUD_LOKI_USER}:${GRAFANA_CLOUD_LOKI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$event_payload" &>/dev/null || true
}

# SSH configuration  
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/deploy_key}"

if [[ -f "$SSH_KEY_PATH" ]]; then
    # Found deploy key (CI or explicit local override)
    log_info "SSH key validated: $SSH_KEY_PATH"
    SSH_OPTS="-i $SSH_KEY_PATH -o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12"
    
    # Validate permissions
    if [[ "$(stat -c %a "$SSH_KEY_PATH" 2>/dev/null || stat -f %A "$SSH_KEY_PATH" 2>/dev/null)" != "600" ]]; then
        log_error "SSH key has incorrect permissions. Expected 600, got: $(stat -c %a "$SSH_KEY_PATH" 2>/dev/null || stat -f %A "$SSH_KEY_PATH" 2>/dev/null)"
        exit 1
    fi
else
    # No deploy key found - use default SSH (local development)
    log_info "No deploy key found, using default SSH configuration"
    SSH_OPTS="-o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12"
fi

# Validate required environment variables
if [[ -z "${APP_IMAGE:-}" ]]; then
    log_error "APP_IMAGE is required (dynamic variable from CI)"
    log_error "Example: export APP_IMAGE=ghcr.io/cogni-dao/cogni-template:preview-abc123"
    exit 1
fi

if [[ -z "${MIGRATOR_IMAGE:-}" ]]; then
    log_error "MIGRATOR_IMAGE is required (dynamic variable from CI)"
    log_error "Example: export MIGRATOR_IMAGE=ghcr.io/cogni-dao/cogni-template:preview-abc123-migrate"
    log_error "Tag must match APP_IMAGE with '-migrate' suffix (INV-COUPLED-TAGS-NO-GUESSING)"
    exit 1
fi

# Environment selection - MUST be explicitly set for security
if [[ -z "${DEPLOY_ENVIRONMENT:-}" ]]; then
    log_error "DEPLOY_ENVIRONMENT must be explicitly set to 'preview' or 'production'"
    log_error "This prevents accidental production deployments"
    log_error "Example: export DEPLOY_ENVIRONMENT=preview"
    exit 1
fi

ENVIRONMENT="$DEPLOY_ENVIRONMENT"
if [[ "$ENVIRONMENT" != "preview" && "$ENVIRONMENT" != "production" ]]; then
    log_error "DEPLOY_ENVIRONMENT must be 'preview' or 'production'"
    log_error "Current value: $ENVIRONMENT"
    exit 1
fi

# Validate required secrets are provided as environment variables
REQUIRED_SECRETS=(
    "DOMAIN"
    "DATABASE_URL"
    "DATABASE_SERVICE_URL"
    "LITELLM_MASTER_KEY"
    "OPENROUTER_API_KEY"
    "AUTH_SECRET"
    "VM_HOST"
    "POSTGRES_ROOT_USER"
    "POSTGRES_ROOT_PASSWORD"
    "APP_DB_USER"
    "APP_DB_PASSWORD"
    "APP_DB_SERVICE_USER"
    "APP_DB_SERVICE_PASSWORD"
    "APP_DB_NAME"
    "EVM_RPC_URL"
    # Temporal DB credentials (self-hosted Temporal)
    "TEMPORAL_DB_USER"
    "TEMPORAL_DB_PASSWORD"
    # Scheduler-worker image (P0 Bridge MVP - must be digest ref)
    "SCHEDULER_WORKER_IMAGE"
    # OpenClaw gateway auth (must match openclaw-gateway.json gateway.auth.token)
    "OPENCLAW_GATEWAY_TOKEN"
    "OPENCLAW_GITHUB_RW_TOKEN"
    # Internal ops auth (deploy-time governance sync trigger)
    "INTERNAL_OPS_TOKEN"
    # PostHog product analytics (required — app fails to start without these)
    "POSTHOG_API_KEY"
    "POSTHOG_HOST"
)

# Check required environment variables (not secrets)
REQUIRED_ENV_VARS=(
    "APP_ENV"
    "COGNI_REPO_URL"
    "COGNI_REPO_REF"
)

MISSING_SECRETS=()
for secret in "${REQUIRED_SECRETS[@]}"; do
    if [[ -z "${!secret:-}" ]]; then
        MISSING_SECRETS+=("$secret")
    fi
done

MISSING_ENV_VARS=()
for env_var in "${REQUIRED_ENV_VARS[@]}"; do
    if [[ -z "${!env_var:-}" ]]; then
        MISSING_ENV_VARS+=("$env_var")
    fi
done

if [[ ${#MISSING_SECRETS[@]} -gt 0 ]]; then
    log_error "Missing required secret environment variables:"
    for secret in "${MISSING_SECRETS[@]}"; do
        log_error "  - $secret"
    done
    log_error ""
    log_error "These should come from GitHub Environment Secrets in CI,"
    log_error "or be set manually for local deployment testing."
    exit 1
fi

if [[ ${#MISSING_ENV_VARS[@]} -gt 0 ]]; then
    log_error "Missing required environment variables:"
    for env_var in "${MISSING_ENV_VARS[@]}"; do
        log_error "  - $env_var"
    done
    log_error ""
    log_error "These should be set in the GitHub workflow environment."
    exit 1
fi

log_info "✅ All required secrets provided via environment variables"

# Check optional secrets (warn if missing, don't fail)
OPTIONAL_SECRETS=(
    "GRAFANA_CLOUD_LOKI_URL"
    "GRAFANA_CLOUD_LOKI_USER"
    "GRAFANA_CLOUD_LOKI_API_KEY"
    "METRICS_TOKEN"
    "SCHEDULER_API_TOKEN"
    "BILLING_INGEST_TOKEN"
    "PROMETHEUS_REMOTE_WRITE_URL"
    "PROMETHEUS_USERNAME"
    "PROMETHEUS_PASSWORD"
    "PROMETHEUS_QUERY_URL"
    "PROMETHEUS_READ_USERNAME"
    "PROMETHEUS_READ_PASSWORD"
    "LANGFUSE_PUBLIC_KEY"
    "LANGFUSE_SECRET_KEY"
    "LANGFUSE_BASE_URL"
    "DISCORD_BOT_TOKEN"
    # OAuth providers (optional — provider silently skipped if missing)
    "GH_OAUTH_CLIENT_ID"
    "GH_OAUTH_CLIENT_SECRET"
    "DISCORD_OAUTH_CLIENT_ID"
    "DISCORD_OAUTH_CLIENT_SECRET"
    "GOOGLE_OAUTH_CLIENT_ID"
    "GOOGLE_OAUTH_CLIENT_SECRET"
    # GitHub App credentials (required only for GitHub ingestion)
    "GH_REVIEW_APP_ID"
    "GH_REVIEW_APP_PRIVATE_KEY_BASE64"
    "GH_REPOS"
    "GH_WEBHOOK_SECRET"
    # Privy (Operator Wallet) — optional, silently skipped if missing
    "PRIVY_APP_ID"
    "PRIVY_APP_SECRET"
    "PRIVY_SIGNING_KEY"
    # BYO-AI: Connection encryption (optional — BYO-AI disabled when unset)
    "CONNECTIONS_ENCRYPTION_KEY"
)

for secret in "${OPTIONAL_SECRETS[@]}"; do
    if [[ -z "${!secret:-}" ]]; then
        log_warn "Optional secret not set: $secret"
        log_warn "  → Log forwarding to Grafana Cloud will be disabled"
    fi
done

# Set artifact directory
ARTIFACT_DIR="${RUNNER_TEMP:-/tmp}/deploy-${GITHUB_RUN_ID:-$$}"
mkdir -p "$ARTIFACT_DIR"

log_info "Deploying to Cherry Servers via Docker Compose..."
log_info "App image: $APP_IMAGE"
log_info "Migrator image: $MIGRATOR_IMAGE"
log_info "Scheduler-worker image: $SCHEDULER_WORKER_IMAGE"
log_info "Environment: $ENVIRONMENT"
log_info "Domain: $DOMAIN"
log_info "VM Host: $VM_HOST"
log_info "Artifact directory: $ARTIFACT_DIR"

# Emit deployment start event
emit_deployment_event "deployment.started" "in_progress" "Deploying $APP_IMAGE to $ENVIRONMENT"

# Deploy runtime stack via SSH + Docker Compose
log_info "Connecting to VM and deploying containers..."

# Create deployment script for remote execution
cat > "$ARTIFACT_DIR/deploy-remote.sh" << 'EOF'
#!/bin/bash
# Remote deployment script (generated by deploy.sh)
# Purpose: Execute Docker Compose operations on VM with zero-downtime edge handling.
# Architecture:
#   - Edge stack (Caddy): Always-on TLS termination, never stopped during app deploys
#   - Runtime stack (app, postgres, litellm, alloy): Mutable, updated on each deploy
# Invariants:
#   - cogni-edge network must exist before any compose up
#   - Edge is started once and rarely touched (only on Caddyfile changes)
#   - App deploys use pull-while-running, no `compose down` unless emergency prune

set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Error capture: Show exactly what failed (line number + command)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
trap 'echo -e "\033[0;31m[FATAL]\033[0m Script failed at line $LINENO: $BASH_COMMAND" >&2' ERR

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step -1: Docker prerequisite gate (fail fast if VM not bootstrapped)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
prereq_failed() {
  echo -e "\033[0;31m[ERROR]\033[0m Docker prerequisites not met. VM bootstrap may have failed."
  echo ""
  echo "=== Bootstrap marker files ==="
  cat /var/lib/cogni/bootstrap.ok 2>/dev/null || echo "(bootstrap.ok not found)"
  cat /var/lib/cogni/bootstrap.fail 2>/dev/null || echo "(bootstrap.fail not found)"
  echo ""
  echo "=== cloud-init-output.log (last 200 lines) ==="
  tail -n 200 /var/log/cloud-init-output.log 2>/dev/null || echo "(not found)"
  echo ""
  echo "=== cogni-bootstrap.log (last 200 lines) ==="
  tail -n 200 /var/log/cogni-bootstrap.log 2>/dev/null || echo "(not found)"
  exit 1
}

if ! command -v docker &>/dev/null; then
  echo -e "\033[0;31m[ERROR]\033[0m docker binary not found"
  prereq_failed
fi

if ! docker version &>/dev/null; then
  echo -e "\033[0;31m[ERROR]\033[0m docker daemon not reachable"
  prereq_failed
fi

if ! docker compose version &>/dev/null; then
  echo -e "\033[0;31m[ERROR]\033[0m docker compose plugin not found"
  prereq_failed
fi

if command -v systemctl &>/dev/null && ! systemctl is-active --quiet docker; then
  echo -e "\033[0;31m[ERROR]\033[0m docker service not active"
  prereq_failed
fi

echo -e "\033[0;32m[INFO]\033[0m Docker prerequisites verified"

# Compose shortcuts (explicit project names, no global export)
EDGE_COMPOSE="docker compose --project-name cogni-edge -f /opt/cogni-template-edge/docker-compose.yml"
RUNTIME_COMPOSE="docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml"

log_info() {
    echo -e "\033[0;32m[INFO]\033[0m $1"
}

log_warn() {
    echo -e "\033[1;33m[WARN]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

# Emit deployment event to Grafana Cloud Loki (remote script)
emit_deployment_event() {
  local event="$1"
  local status="$2"
  local message="$3"

  # Skip if jq not available or Grafana Cloud not configured
  command -v jq >/dev/null 2>&1 || { echo "[deploy] jq missing; skipping deployment event" >&2; return 0; }
  if [[ -z "${GRAFANA_CLOUD_LOKI_URL:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_USER:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_API_KEY:-}" ]]; then
    return 0
  fi

  # Build structured event with low-cardinality labels
  local timestamp=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  local nanoseconds=$(date +%s)000000000

  local event_payload=$(jq -n \
    --arg ns "$nanoseconds" \
    --arg event "$event" \
    --arg status "$status" \
    --arg msg "$message" \
    --arg env "${DEPLOY_ENVIRONMENT:-unknown}" \
    --arg commit "${COMMIT_SHA:-unknown}" \
    --arg actor "${DEPLOY_ACTOR:-unknown}" \
    --arg image "${APP_IMAGE:-unknown}" \
    --arg timestamp "$timestamp" \
    '{
      streams: [{
        stream: {
          app: "cogni-template",
          env: $env,
          service: "deployment",
          stream: "stdout"
        },
        values: [[$ns, ({
          level: "info",
          event: $event,
          status: $status,
          msg: $msg,
          commit: $commit,
          actor: $actor,
          appImage: $image,
          time: $timestamp
        } | tostring)]]
      }]
    }')

  # POST to Grafana Cloud Loki (suppress errors to not break deployment)
  curl -s -X POST "$GRAFANA_CLOUD_LOKI_URL" \
    -u "${GRAFANA_CLOUD_LOKI_USER}:${GRAFANA_CLOUD_LOKI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$event_payload" &>/dev/null || true
}

# Portable hash function (sha256sum on Linux, shasum on macOS)
hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    log_warn "No sha256 tool available, skipping config hash check"
    echo "no-hash-tool"
  fi
}

# Append env var to file only if value is non-empty
# Usage: append_env_if_set FILE KEY VALUE
append_env_if_set() {
    local file="${1:?file required}" key="${2:?key required}" val="${3-}"
    if [[ -n "$val" ]]; then printf '%s=%s\n' "$key" "$val" >> "$file"; fi
}

log_info "Setting up deployment environment on VM..."

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 0: Create shared network (idempotent, must exist before any compose up)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Ensuring cogni-edge network exists..."
docker network create cogni-edge 2>/dev/null || true

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1: Write environment files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Creating environment files..."

# Edge env (minimal - just domain for Caddyfile)
cat > /opt/cogni-template-edge/.env << ENV_EOF
DOMAIN=${DOMAIN}
ENV_EOF

# Runtime env (full app config)
RUNTIME_ENV=/opt/cogni-template-runtime/.env
cat > "$RUNTIME_ENV" << ENV_EOF
# Required vars
DOMAIN=${DOMAIN}
APP_ENV=${APP_ENV}
APP_IMAGE=${APP_IMAGE}
MIGRATOR_IMAGE=${MIGRATOR_IMAGE}
SCHEDULER_WORKER_IMAGE=${SCHEDULER_WORKER_IMAGE}
APP_BASE_URL=https://${DOMAIN}
NEXTAUTH_URL=https://${DOMAIN}
DATABASE_URL=${DATABASE_URL}
DATABASE_SERVICE_URL=${DATABASE_SERVICE_URL}
LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
AUTH_SECRET=${AUTH_SECRET}
POSTGRES_ROOT_USER=${POSTGRES_ROOT_USER}
POSTGRES_ROOT_PASSWORD=${POSTGRES_ROOT_PASSWORD}
APP_DB_USER=${APP_DB_USER}
APP_DB_PASSWORD=${APP_DB_PASSWORD}
APP_DB_SERVICE_USER=${APP_DB_SERVICE_USER}
APP_DB_SERVICE_PASSWORD=${APP_DB_SERVICE_PASSWORD}
APP_DB_NAME=${APP_DB_NAME}
DEPLOY_ENVIRONMENT=${DEPLOY_ENVIRONMENT}
EVM_RPC_URL=${EVM_RPC_URL}
# Temporal DB credentials (self-hosted)
TEMPORAL_DB_USER=${TEMPORAL_DB_USER}
TEMPORAL_DB_PASSWORD=${TEMPORAL_DB_PASSWORD}
# Brain repo mount (COGNI_BRAIN_SPEC.md Step 4)
COGNI_REPO_URL=${COGNI_REPO_URL}
COGNI_REPO_REF=${COGNI_REPO_REF}
GIT_READ_USERNAME=${GIT_READ_USERNAME}
GIT_READ_TOKEN=${GIT_READ_TOKEN}
# OpenClaw gateway auth
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
OPENCLAW_GITHUB_RW_TOKEN=${OPENCLAW_GITHUB_RW_TOKEN}
# Grafana observability (for grafana-health skill + MCP)
GRAFANA_URL=${GRAFANA_URL}
GRAFANA_SERVICE_ACCOUNT_TOKEN=${GRAFANA_SERVICE_ACCOUNT_TOKEN}
# PostHog product analytics
POSTHOG_API_KEY=${POSTHOG_API_KEY}
POSTHOG_HOST=${POSTHOG_HOST}
ENV_EOF

# Verify .env was written
if ! test -s "$RUNTIME_ENV"; then
  log_fatal ".env write failed: $RUNTIME_ENV is empty or missing"
fi
log_info ".env written: $(wc -c < "$RUNTIME_ENV") bytes, $(wc -l < "$RUNTIME_ENV") lines"

# Optional observability vars - only written if set (empty string breaks Zod validation)
append_env_if_set "$RUNTIME_ENV" LOKI_WRITE_URL "${GRAFANA_CLOUD_LOKI_URL-}"
append_env_if_set "$RUNTIME_ENV" LOKI_USERNAME "${GRAFANA_CLOUD_LOKI_USER-}"
append_env_if_set "$RUNTIME_ENV" LOKI_PASSWORD "${GRAFANA_CLOUD_LOKI_API_KEY-}"
append_env_if_set "$RUNTIME_ENV" METRICS_TOKEN "${METRICS_TOKEN-}"
append_env_if_set "$RUNTIME_ENV" SCHEDULER_API_TOKEN "${SCHEDULER_API_TOKEN-}"
append_env_if_set "$RUNTIME_ENV" BILLING_INGEST_TOKEN "${BILLING_INGEST_TOKEN-}"
append_env_if_set "$RUNTIME_ENV" INTERNAL_OPS_TOKEN "${INTERNAL_OPS_TOKEN-}"
# Prometheus write path (Alloy)
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_REMOTE_WRITE_URL "${PROMETHEUS_REMOTE_WRITE_URL-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_USERNAME "${PROMETHEUS_USERNAME-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_PASSWORD "${PROMETHEUS_PASSWORD-}"
# Prometheus read path (app queries) - separate read-only token
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_QUERY_URL "${PROMETHEUS_QUERY_URL-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_READ_USERNAME "${PROMETHEUS_READ_USERNAME-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_READ_PASSWORD "${PROMETHEUS_READ_PASSWORD-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_PUBLIC_KEY "${LANGFUSE_PUBLIC_KEY-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_SECRET_KEY "${LANGFUSE_SECRET_KEY-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_BASE_URL "${LANGFUSE_BASE_URL-}"
# Discord bot (OpenClaw channel plugin)
append_env_if_set "$RUNTIME_ENV" DISCORD_BOT_TOKEN "${DISCORD_BOT_TOKEN-}"
# OAuth providers (optional — provider silently skipped if missing)
append_env_if_set "$RUNTIME_ENV" GH_OAUTH_CLIENT_ID "${GH_OAUTH_CLIENT_ID-}"
append_env_if_set "$RUNTIME_ENV" GH_OAUTH_CLIENT_SECRET "${GH_OAUTH_CLIENT_SECRET-}"
append_env_if_set "$RUNTIME_ENV" DISCORD_OAUTH_CLIENT_ID "${DISCORD_OAUTH_CLIENT_ID-}"
append_env_if_set "$RUNTIME_ENV" DISCORD_OAUTH_CLIENT_SECRET "${DISCORD_OAUTH_CLIENT_SECRET-}"
append_env_if_set "$RUNTIME_ENV" GOOGLE_OAUTH_CLIENT_ID "${GOOGLE_OAUTH_CLIENT_ID-}"
append_env_if_set "$RUNTIME_ENV" GOOGLE_OAUTH_CLIENT_SECRET "${GOOGLE_OAUTH_CLIENT_SECRET-}"
# GitHub App credentials (scheduler-worker ingestion)
append_env_if_set "$RUNTIME_ENV" GH_REVIEW_APP_ID "${GH_REVIEW_APP_ID-}"
append_env_if_set "$RUNTIME_ENV" GH_REVIEW_APP_PRIVATE_KEY_BASE64 "${GH_REVIEW_APP_PRIVATE_KEY_BASE64-}"
append_env_if_set "$RUNTIME_ENV" GH_REPOS "${GH_REPOS-}"
append_env_if_set "$RUNTIME_ENV" GH_WEBHOOK_SECRET "${GH_WEBHOOK_SECRET-}"
# Privy (Operator Wallet)
append_env_if_set "$RUNTIME_ENV" PRIVY_APP_ID "${PRIVY_APP_ID-}"
append_env_if_set "$RUNTIME_ENV" PRIVY_APP_SECRET "${PRIVY_APP_SECRET-}"
append_env_if_set "$RUNTIME_ENV" PRIVY_SIGNING_KEY "${PRIVY_SIGNING_KEY-}"
# BYO-AI: Connection encryption
append_env_if_set "$RUNTIME_ENV" CONNECTIONS_ENCRYPTION_KEY "${CONNECTIONS_ENCRYPTION_KEY-}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2: Start edge stack (idempotent - only starts if not running)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Ensuring edge stack (Caddy) is running..."
if ! $EDGE_COMPOSE ps -q caddy 2>/dev/null | grep -q .; then
  log_info "Starting edge stack..."
  $EDGE_COMPOSE up -d
else
  log_info "Edge stack already running"
  # Check for Caddyfile changes and restart if needed
  HASH_DIR="/var/lib/cogni"
  CADDYFILE="/opt/cogni-template-edge/configs/Caddyfile.tmpl"
  CADDY_HASH_FILE="$HASH_DIR/caddyfile.sha256"

  if [[ -f "$CADDYFILE" ]]; then
    mkdir -p "$HASH_DIR"
    NEW_HASH=$(hash_file "$CADDYFILE")
    OLD_HASH=$(cat "$CADDY_HASH_FILE" 2>/dev/null || echo "none")

    if [[ "$NEW_HASH" != "$OLD_HASH" && "$NEW_HASH" != "no-hash-tool" ]]; then
      log_info "Caddyfile changed (hash: ${NEW_HASH:0:12}...), reloading Caddy..."
      $EDGE_COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile || $EDGE_COMPOSE restart caddy
      echo "$NEW_HASH" > "$CADDY_HASH_FILE"
      log_info "Caddy reloaded with new config"
    fi
  fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2.5: Disk cleanup gate (before any image pulls)
# Prune when free < 7GB — only enough headroom for new app/migrator images (~2-3GB).
# Previous threshold of 15GB caused a prune-every-deploy death loop on the 40GB VM
# (10GB free < 15GB → prune → re-pull all images → back to 10GB → repeat).
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVAIL_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d G)
USED_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d %)
log_info "Disk: ${AVAIL_GB}GB free, ${USED_PCT}% used"

if [ "$AVAIL_GB" -lt 7 ]; then
  log_warn "Disk pressure (${AVAIL_GB}GB free). Running cleanup..."
  docker system prune -af || true
  journalctl --vacuum-time=3d || true

  AVAIL_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d G)
  log_info "Free space after cleanup: ${AVAIL_GB}GB"

  if [ "$AVAIL_GB" -lt 5 ]; then
    log_error "Insufficient disk after cleanup (${AVAIL_GB}GB free)."
    exit 1
  fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3: Authenticate to GHCR
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Logging into GHCR for private image pulls..."
echo "${GHCR_DEPLOY_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 5.9: Assert profile services exist (guard against silent compose drift)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESOLVED_SERVICES=$($RUNTIME_COMPOSE --profile bootstrap --profile sandbox-openclaw config --services)
for svc in openclaw-gateway llm-proxy-openclaw; do
  if ! echo "$RESOLVED_SERVICES" | grep -q "^${svc}$"; then
    log_error "Profile guardrail: service '$svc' not found in compose config."
    log_error "Compose file: /opt/cogni-template-runtime/docker-compose.yml"
    log_error "Resolved services: $RESOLVED_SERVICES"
    exit 1
  fi
done
log_info "Profile guardrail passed: openclaw-gateway, llm-proxy-openclaw resolved"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6+7: Pull only images that change per deploy (targeted, not blanket)
# Static/pinned images (postgres, litellm, alloy, temporal, autoheal, nginx,
# git-sync, busybox) use local Docker cache. Only re-pulled after prune or
# when their pins change in docker-compose.yml.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Pulling updated images (app continues serving)..."
emit_deployment_event "deployment.pull_started" "in_progress" "Pulling images from registry"

# Per-deploy images (change every deploy)
docker pull "$APP_IMAGE"
docker pull "$MIGRATOR_IMAGE"
docker pull "$SCHEDULER_WORKER_IMAGE"

# Sandbox images (may update on :latest — per openclaw-sandbox-spec)
# Manifest check ~2s each; skips download if digest unchanged.
OPENCLAW_GATEWAY_IMAGE="ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest"
PNPM_STORE_IMAGE="ghcr.io/cogni-dao/node-template:pnpm-store-latest"
docker pull "$OPENCLAW_GATEWAY_IMAGE"
docker pull "$PNPM_STORE_IMAGE" || log_warn "pnpm-store image not found, skipping"

log_info "[$(date -u +%H:%M:%S)] Pull complete"
emit_deployment_event "deployment.pull_complete" "success" "Images pulled successfully"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 7.5: Seed pnpm_store volume (idempotent, skip if hash matches)
# Image already pulled above; seed script uses $PNPM_STORE_IMAGE.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
source /tmp/seed-pnpm-store.sh

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 8: Start/update postgres (must be healthy before migrations)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Bringing up postgres..."
# Incremental up may fail when the network definition changes (e.g. IPAM subnet added):
# Compose tries to recreate the network but Docker refuses while containers are attached.
# Only fall back to full teardown for that specific case; let other errors propagate.
# Profile flag is required: sandbox-openclaw services (openclaw-gateway, llm-proxy-openclaw)
# are on the internal network but invisible to `down` without their profile active.
if ! output="$($RUNTIME_COMPOSE up -d postgres 2>&1)"; then
  printf '%s\n' "$output" >&2
  if grep -qiE 'has active endpoints|error while removing network' <<<"$output"; then
    log_warn "Incremental reconcile failed due to network recreation; forcing full runtime teardown..."
    $RUNTIME_COMPOSE --profile sandbox-openclaw down --remove-orphans --timeout 30
    $RUNTIME_COMPOSE up -d postgres
  else
    exit 1
  fi
else
  printf '%s\n' "$output"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 9: Run DB provisioning and migrations
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Running DB provisioning..."
emit_deployment_event "deployment.db_provision_started" "in_progress" "Provisioning database users and schemas"
$RUNTIME_COMPOSE --profile bootstrap run --rm db-provision
log_info "[$(date -u +%H:%M:%S)] DB provisioning complete"
emit_deployment_event "deployment.db_provision_complete" "success" "Database provisioned successfully"

log_info "[$(date -u +%H:%M:%S)] Running database migrations..."
emit_deployment_event "deployment.migration_started" "in_progress" "Running database migrations"
$RUNTIME_COMPOSE --profile bootstrap run --rm db-migrate
log_info "[$(date -u +%H:%M:%S)] Migrations complete"
emit_deployment_event "deployment.migration_complete" "success" "Migrations applied successfully"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 10: Start/update runtime stack (rolling update, no down)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Starting runtime stack (rolling update)..."
emit_deployment_event "deployment.stack_up_started" "in_progress" "Starting container stack"

# ── Autoheal guard ──────────────────────────────────────────────────────────
# Autoheal polls every 5s and restarts unhealthy containers. During
# "compose up -d", compose does stop → remove → create. Autoheal can restart
# a container between stop and remove, causing:
#   "cannot remove container: container is running"
# Stopping autoheal first eliminates the race. Compose up -d recreates it
# as part of the stack (autoheal is a defined service in docker-compose.yml).
# NOTE: Uses compose service name "autoheal", not container name.
# ────────────────────────────────────────────────────────────────────────────
$RUNTIME_COMPOSE stop autoheal 2>/dev/null || true

$RUNTIME_COMPOSE --profile sandbox-openclaw up -d --remove-orphans
log_info "[$(date -u +%H:%M:%S)] Stack up complete"
emit_deployment_event "deployment.stack_up_complete" "success" "All containers started"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 10.1: Wait for app readiness before post-deploy hooks
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Waiting for app to be ready..."
for i in $(seq 1 30); do
  if $RUNTIME_COMPOSE exec -T app sh -c 'curl -fsS http://localhost:3000/readyz' &>/dev/null; then
    log_info "[$(date -u +%H:%M:%S)] App ready after ~${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    log_error "App did not become ready after 30s"
    $RUNTIME_COMPOSE logs --tail=20 app
    exit 1
  fi
  sleep 1
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 10.2: Sync governance schedules (idempotent, after app + Temporal are up)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Syncing governance schedules..."
emit_deployment_event "deployment.governance_sync_started" "in_progress" "Syncing governance schedules"
$RUNTIME_COMPOSE exec -T app sh -lc 'curl -fsS -X POST http://localhost:3000/api/internal/ops/governance/schedules/sync -H "Authorization: Bearer ${INTERNAL_OPS_TOKEN:?INTERNAL_OPS_TOKEN is required}"'
log_info "[$(date -u +%H:%M:%S)] Governance schedules synced"
emit_deployment_event "deployment.governance_sync_complete" "success" "Governance schedules synced"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 11: Checksum-gated restart for LiteLLM config changes
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HASH_DIR="/var/lib/cogni"
LITELLM_CONFIG="/opt/cogni-template-runtime/configs/litellm.config.yaml"
LITELLM_HASH_FILE="$HASH_DIR/litellm-config.sha256"

if [[ ! -f "$LITELLM_CONFIG" ]]; then
  log_warn "LiteLLM config missing at $LITELLM_CONFIG, skipping restart check"
else
  mkdir -p "$HASH_DIR"
  NEW_HASH=$(hash_file "$LITELLM_CONFIG")
  OLD_HASH=$(cat "$LITELLM_HASH_FILE" 2>/dev/null || echo "none")

  if [[ "$NEW_HASH" != "$OLD_HASH" && "$NEW_HASH" != "no-hash-tool" ]]; then
    log_info "LiteLLM config changed (hash: ${NEW_HASH:0:12}...), restarting container..."
    emit_deployment_event "deployment.litellm_restart" "in_progress" "Restarting LiteLLM due to config change"
    $RUNTIME_COMPOSE restart litellm
    echo "$NEW_HASH" > "$LITELLM_HASH_FILE"
    log_info "LiteLLM restarted with new config"
    emit_deployment_event "deployment.litellm_restart_complete" "success" "LiteLLM restarted successfully"
  else
    log_info "LiteLLM config unchanged (hash: ${NEW_HASH:0:12}...), no restart needed"
  fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 11.2: Checksum-gated recreate for OpenClaw config changes
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPENCLAW_CONFIG="/opt/cogni-template-runtime/openclaw/openclaw-gateway.json"
OPENCLAW_HASH_FILE="$HASH_DIR/openclaw-gateway.sha256"

mkdir -p "$HASH_DIR"

NEW_HASH="$(hash_file "$OPENCLAW_CONFIG")"
OLD_HASH="$(cat "$OPENCLAW_HASH_FILE" 2>/dev/null || true)"

if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  log_info "OpenClaw config changed (hash: ${NEW_HASH:0:12}...), recreating gateway..."
  emit_deployment_event "deployment.openclaw_recreate" "in_progress" "Recreating OpenClaw gateway due to config change"
  $RUNTIME_COMPOSE --profile sandbox-openclaw up -d --no-deps --force-recreate openclaw-gateway \
    && echo "$NEW_HASH" > "$OPENCLAW_HASH_FILE"
  log_info "OpenClaw gateway recreated with new config"
  emit_deployment_event "deployment.openclaw_recreate_complete" "success" "OpenClaw gateway recreated successfully"
else
  log_info "OpenClaw config unchanged (hash: ${NEW_HASH:0:12}...), no recreate needed"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 11.5: OpenClaw readiness gate (fail deploy if crash-looping)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Waiting for OpenClaw readiness..."
bash /tmp/healthcheck-openclaw.sh "$RUNTIME_COMPOSE --profile sandbox-openclaw"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 12: Verify deployment
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Waiting for containers to be ready..."
sleep 10

log_info "Checking container status..."
echo "=== Edge stack ==="
$EDGE_COMPOSE ps
echo "=== Runtime stack ==="
$RUNTIME_COMPOSE ps
emit_deployment_event "deployment.complete" "success" "Deployment completed successfully"
log_info "✅ Deployment complete!"
EOF

# Make deployment script executable
chmod +x "$ARTIFACT_DIR/deploy-remote.sh"

# Verify heredoc produced a valid file
if ! test -s "$ARTIFACT_DIR/deploy-remote.sh"; then
  log_fatal "deploy-remote.sh is empty or missing at $ARTIFACT_DIR/deploy-remote.sh"
fi
LOCAL_SIZE=$(wc -c < "$ARTIFACT_DIR/deploy-remote.sh")
LOCAL_SHA=$(sha256sum "$ARTIFACT_DIR/deploy-remote.sh" | awk '{print $1}')
log_info "deploy-remote.sh ready: ${LOCAL_SIZE} bytes, sha256=${LOCAL_SHA}"


# Deploy bundles to VM via rsync
log_info "Deploying edge and runtime bundles to VM..."
ssh $SSH_OPTS root@"$VM_HOST" "mkdir -p /opt/cogni-template-edge /opt/cogni-template-runtime"

# Upload edge bundle (rarely changes - Caddy config only)
rsync -av -e "ssh $SSH_OPTS" \
  "$REPO_ROOT/infra/compose/edge/" \
  root@"$VM_HOST":/opt/cogni-template-edge/

# Upload runtime bundle (app stack config)
rsync -av -e "ssh $SSH_OPTS" \
  "$REPO_ROOT/infra/compose/runtime/" \
  root@"$VM_HOST":/opt/cogni-template-runtime/

# Upload OpenClaw gateway config
ssh $SSH_OPTS root@"$VM_HOST" "mkdir -p /opt/cogni-template-runtime/openclaw"
scp $SSH_OPTS \
  "$REPO_ROOT/services/sandbox-openclaw/openclaw-gateway.json" \
  root@"$VM_HOST":/opt/cogni-template-runtime/openclaw/openclaw-gateway.json

# Upload OpenClaw gateway workspace (SOUL.md, GOVERN.md, AGENTS.md, etc.)
rsync -av -e "ssh $SSH_OPTS" \
  "$REPO_ROOT/services/sandbox-openclaw/gateway-workspace/" \
  root@"$VM_HOST":/opt/cogni-template-runtime/openclaw/gateway-workspace/

# Upload and execute deployment script
scp $SSH_OPTS "$ARTIFACT_DIR/deploy-remote.sh" root@"$VM_HOST":/tmp/deploy-remote.sh

# Upload healthcheck scripts (called from deploy-remote.sh)
scp $SSH_OPTS \
  "$REPO_ROOT/scripts/ci/healthcheck-openclaw.sh" \
  "$REPO_ROOT/scripts/ci/seed-pnpm-store.sh" \
  root@"$VM_HOST":/tmp/
scp $SSH_OPTS \
  "$REPO_ROOT/services/sandbox-openclaw/seed-pnpm-store.sh" \
  root@"$VM_HOST":/tmp/seed-pnpm-store-core.sh

# Verify SCP landed correctly
REMOTE_CHECK=$(ssh $SSH_OPTS root@"$VM_HOST" "echo host=\$(hostname) date=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && sha256sum /tmp/deploy-remote.sh | awk '{print \$1}'" 2>&1) || {
  log_fatal "SSH to VM failed during SCP verify: $REMOTE_CHECK"
}
log_info "VM: ${REMOTE_CHECK%%$'\n'*}"
REMOTE_SHA=$(echo "$REMOTE_CHECK" | tail -1)
if [ -z "$REMOTE_SHA" ] || [ ${#REMOTE_SHA} -ne 64 ]; then
  log_fatal "/tmp/deploy-remote.sh missing or unreadable on VM. SSH output: $REMOTE_CHECK"
fi
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  log_fatal "deploy-remote.sh sha256 mismatch: local=${LOCAL_SHA} remote=${REMOTE_SHA}"
fi
log_info "deploy-remote.sh verified on VM (sha256 match)"

ssh $SSH_OPTS root@"$VM_HOST" \
    "DOMAIN='$DOMAIN' APP_ENV='$APP_ENV' DEPLOY_ENVIRONMENT='$DEPLOY_ENVIRONMENT' APP_IMAGE='$APP_IMAGE' MIGRATOR_IMAGE='$MIGRATOR_IMAGE' SCHEDULER_WORKER_IMAGE='$SCHEDULER_WORKER_IMAGE' DATABASE_URL='$DATABASE_URL' DATABASE_SERVICE_URL='$DATABASE_SERVICE_URL' LITELLM_MASTER_KEY='$LITELLM_MASTER_KEY' OPENROUTER_API_KEY='$OPENROUTER_API_KEY' AUTH_SECRET='$AUTH_SECRET' POSTGRES_ROOT_USER='$POSTGRES_ROOT_USER' POSTGRES_ROOT_PASSWORD='$POSTGRES_ROOT_PASSWORD' APP_DB_USER='$APP_DB_USER' APP_DB_PASSWORD='$APP_DB_PASSWORD' APP_DB_SERVICE_USER='$APP_DB_SERVICE_USER' APP_DB_SERVICE_PASSWORD='$APP_DB_SERVICE_PASSWORD' APP_DB_NAME='$APP_DB_NAME' EVM_RPC_URL='$EVM_RPC_URL' TEMPORAL_DB_USER='$TEMPORAL_DB_USER' TEMPORAL_DB_PASSWORD='$TEMPORAL_DB_PASSWORD' GHCR_DEPLOY_TOKEN='$GHCR_DEPLOY_TOKEN' GHCR_USERNAME='$GHCR_USERNAME' GRAFANA_CLOUD_LOKI_URL='${GRAFANA_CLOUD_LOKI_URL:-}' GRAFANA_CLOUD_LOKI_USER='${GRAFANA_CLOUD_LOKI_USER:-}' GRAFANA_CLOUD_LOKI_API_KEY='${GRAFANA_CLOUD_LOKI_API_KEY:-}' METRICS_TOKEN='${METRICS_TOKEN:-}' SCHEDULER_API_TOKEN='${SCHEDULER_API_TOKEN:-}' BILLING_INGEST_TOKEN='${BILLING_INGEST_TOKEN:-}' INTERNAL_OPS_TOKEN='${INTERNAL_OPS_TOKEN:-}' PROMETHEUS_REMOTE_WRITE_URL='${PROMETHEUS_REMOTE_WRITE_URL:-}' PROMETHEUS_USERNAME='${PROMETHEUS_USERNAME:-}' PROMETHEUS_PASSWORD='${PROMETHEUS_PASSWORD:-}' PROMETHEUS_QUERY_URL='${PROMETHEUS_QUERY_URL:-}' PROMETHEUS_READ_USERNAME='${PROMETHEUS_READ_USERNAME:-}' PROMETHEUS_READ_PASSWORD='${PROMETHEUS_READ_PASSWORD:-}' LANGFUSE_PUBLIC_KEY='${LANGFUSE_PUBLIC_KEY:-}' LANGFUSE_SECRET_KEY='${LANGFUSE_SECRET_KEY:-}' LANGFUSE_BASE_URL='${LANGFUSE_BASE_URL:-}' COGNI_REPO_URL='$COGNI_REPO_URL' COGNI_REPO_REF='$COGNI_REPO_REF' GIT_READ_USERNAME='$GIT_READ_USERNAME' GIT_READ_TOKEN='$GIT_READ_TOKEN' OPENCLAW_GATEWAY_TOKEN='$OPENCLAW_GATEWAY_TOKEN' OPENCLAW_GITHUB_RW_TOKEN='${OPENCLAW_GITHUB_RW_TOKEN:-}' GRAFANA_URL='${GRAFANA_URL:-}' GRAFANA_SERVICE_ACCOUNT_TOKEN='${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}' POSTHOG_API_KEY='$POSTHOG_API_KEY' POSTHOG_HOST='$POSTHOG_HOST' DISCORD_BOT_TOKEN='${DISCORD_BOT_TOKEN:-}' GH_OAUTH_CLIENT_ID='${GH_OAUTH_CLIENT_ID:-}' GH_OAUTH_CLIENT_SECRET='${GH_OAUTH_CLIENT_SECRET:-}' DISCORD_OAUTH_CLIENT_ID='${DISCORD_OAUTH_CLIENT_ID:-}' DISCORD_OAUTH_CLIENT_SECRET='${DISCORD_OAUTH_CLIENT_SECRET:-}' GOOGLE_OAUTH_CLIENT_ID='${GOOGLE_OAUTH_CLIENT_ID:-}' GOOGLE_OAUTH_CLIENT_SECRET='${GOOGLE_OAUTH_CLIENT_SECRET:-}' GH_REVIEW_APP_ID='${GH_REVIEW_APP_ID:-}' GH_REVIEW_APP_PRIVATE_KEY_BASE64='${GH_REVIEW_APP_PRIVATE_KEY_BASE64:-}' GH_REPOS='${GH_REPOS:-}' GH_WEBHOOK_SECRET='${GH_WEBHOOK_SECRET:-}' PRIVY_APP_ID='${PRIVY_APP_ID:-}' PRIVY_APP_SECRET='${PRIVY_APP_SECRET:-}' PRIVY_SIGNING_KEY='${PRIVY_SIGNING_KEY:-}' CONNECTIONS_ENCRYPTION_KEY='${CONNECTIONS_ENCRYPTION_KEY:-}' COMMIT_SHA='${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}' DEPLOY_ACTOR='${GITHUB_ACTOR:-$(whoami)}' bash /tmp/deploy-remote.sh"

# Health validation
log_info "Validating deployment health..."

max_attempts=6
sleep_seconds=5

check_url() {
  local url="$1"
  local label="$2"

  for i in $(seq 1 "$max_attempts"); do
    # Capture response body and HTTP status
    local response
    local http_code
    response=$(curl -sS -w "\n%{http_code}" "$url" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
      log_info "✅ $label health check passed: $url"
      return 0
    fi

    log_warn "Attempt ${i}/${max_attempts}: $label not ready yet (HTTP $http_code), waiting ${sleep_seconds}s..."
    if [ $i -eq $max_attempts ]; then
      # On final attempt, show response body for debugging
      log_error "❌ $label did not become ready after $((max_attempts * sleep_seconds))s: $url"
      log_error "HTTP Status: $http_code"
      log_error "Response body: $body"
    fi
    sleep "$sleep_seconds"
  done

  return 1
}

check_url "https://$DOMAIN/readyz" "App (readiness)"

# Store deployment metadata
log_info "Recording deployment metadata..."
cat > "$ARTIFACT_DIR/deployment.json" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "environment": "$ENVIRONMENT",
  "app_image": "$APP_IMAGE",
  "domain": "$DOMAIN",
  "vm_host": "$VM_HOST",
  "commit": "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}",
  "ref": "${GITHUB_REF_NAME:-$(git branch --show-current 2>/dev/null || echo 'unknown')}",
  "actor": "${GITHUB_ACTOR:-$(whoami)}"
}
EOF

log_info "✅ Docker Compose deployment complete!"
log_info ""
log_info "🌐 Application URLs:"
log_info "  - Main App: https://$DOMAIN"
log_info "  - Readiness Check: https://$DOMAIN/readyz"
log_info "  - Liveness Check: https://$DOMAIN/livez"
log_info ""
log_info "📁 Deployment artifacts in $ARTIFACT_DIR:"
log_info "  - deployment.json: Deployment metadata"
log_info "  - deploy-remote.sh: Remote deployment script"
log_info ""
log_info "🔧 Deployment management:"
log_info "  - SSH access: ssh root@$VM_HOST"
log_info "  - Edge logs: docker compose --project-name cogni-edge -f /opt/cogni-template-edge/docker-compose.yml logs"
log_info "  - Runtime logs: docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs"
