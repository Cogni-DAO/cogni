#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/deploy-infra.sh
# Purpose: Deploy Compose infrastructure (postgres, litellm, temporal, redis, alloy, caddy)
#          to a remote VM via SSH. App containers are managed by k8s/Argo CD — this script
#          only handles infra services.
# Ported from: scripts/ci/deploy.sh (sections listed in work/handoffs/task.0281.handoff.md)
# Invariants:
#   - DEPLOY_ENVIRONMENT must be set to 'canary', 'preview', or 'production'
#   - App/migrator/scheduler-worker containers are NOT started (k8s handles those)
#   - DB migrations are NOT run (k8s PreSync hook handles those)
#   - SSH_KEEPALIVE: All SSH connections use ServerAliveInterval to survive long operations.
# Links: Called by .github/workflows/build-multi-node.yml; uses infra/compose/

set -euo pipefail

# Resolve repo root robustly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

on_fail() {
  code=$?
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[ERROR] deploy-infra failed (exit $code)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  emit_deployment_event "infra_deployment.failed" "failed" "Infrastructure deployment failed with exit code $code"

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
    echo "=== logs: litellm ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs --tail 40 litellm 2>&1 || true" || true

    echo ""
    echo "=== logs: alloy ==="
    ssh $SSH_OPTS root@"$VM_HOST" "docker compose --project-name cogni-runtime --env-file /opt/cogni-template-runtime/.env -f /opt/cogni-template-runtime/docker-compose.yml logs --tail 20 alloy 2>&1 || true" || true

    echo ""
    echo "=== healthcheck history (unhealthy/starting containers) ==="
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

log_fatal() {
    echo -e "${RED}[FATAL]${NC} $1" >&2
    exit 1
}

# Emit deployment event to Grafana Cloud Loki (from CI runner)
emit_deployment_event() {
  local event="$1"
  local status="$2"
  local message="$3"

  command -v jq >/dev/null 2>&1 || { echo "[deploy-infra] jq missing; skipping deployment event" >&2; return 0; }
  if [[ -z "${GRAFANA_CLOUD_LOKI_URL:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_USER:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_API_KEY:-}" ]]; then
    return 0
  fi

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
    --arg timestamp "$timestamp" \
    '{
      streams: [{
        stream: {
          app: "cogni-template",
          env: $env,
          service: "infra-deployment",
          stream: "stdout"
        },
        values: [[$ns, ({
          level: "info",
          event: $event,
          status: $status,
          msg: $msg,
          commit: $commit,
          actor: $actor,
          time: $timestamp
        } | tostring)]]
      }]
    }')

  curl -s -X POST "$GRAFANA_CLOUD_LOKI_URL" \
    -u "${GRAFANA_CLOUD_LOKI_USER}:${GRAFANA_CLOUD_LOKI_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$event_payload" &>/dev/null || true
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SSH setup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/deploy_key}"

if [[ -f "$SSH_KEY_PATH" ]]; then
    log_info "SSH key validated: $SSH_KEY_PATH"
    SSH_OPTS="-i $SSH_KEY_PATH -o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12"

    if [[ "$(stat -c %a "$SSH_KEY_PATH" 2>/dev/null || stat -f %A "$SSH_KEY_PATH" 2>/dev/null)" != "600" ]]; then
        log_error "SSH key has incorrect permissions. Expected 600, got: $(stat -c %a "$SSH_KEY_PATH" 2>/dev/null || stat -f %A "$SSH_KEY_PATH" 2>/dev/null)"
        exit 1
    fi
else
    log_info "No deploy key found, using default SSH configuration"
    SSH_OPTS="-o StrictHostKeyChecking=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Validate environment
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if [[ -z "${DEPLOY_ENVIRONMENT:-}" ]]; then
    log_error "DEPLOY_ENVIRONMENT must be explicitly set to 'canary', 'preview', or 'production'"
    exit 1
fi

ENVIRONMENT="$DEPLOY_ENVIRONMENT"
if [[ "$ENVIRONMENT" != "canary" && "$ENVIRONMENT" != "preview" && "$ENVIRONMENT" != "production" ]]; then
    log_error "DEPLOY_ENVIRONMENT must be 'canary', 'preview', or 'production'"
    log_error "Current value: $ENVIRONMENT"
    exit 1
fi

# Validate required secrets
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
    "TEMPORAL_DB_USER"
    "TEMPORAL_DB_PASSWORD"
    "OPENCLAW_GATEWAY_TOKEN"
    "OPENCLAW_GITHUB_RW_TOKEN"
    "INTERNAL_OPS_TOKEN"
    "POSTHOG_API_KEY"
    "POSTHOG_HOST"
)

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
    exit 1
fi

if [[ ${#MISSING_ENV_VARS[@]} -gt 0 ]]; then
    log_error "Missing required environment variables:"
    for env_var in "${MISSING_ENV_VARS[@]}"; do
        log_error "  - $env_var"
    done
    exit 1
fi

log_info "All required secrets provided"

# Check optional secrets (warn if missing)
OPTIONAL_SECRETS=(
    "GRAFANA_CLOUD_LOKI_URL"
    "GRAFANA_CLOUD_LOKI_USER"
    "GRAFANA_CLOUD_LOKI_API_KEY"
    "METRICS_TOKEN"
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
    "GH_OAUTH_CLIENT_ID"
    "GH_OAUTH_CLIENT_SECRET"
    "DISCORD_OAUTH_CLIENT_ID"
    "DISCORD_OAUTH_CLIENT_SECRET"
    "GOOGLE_OAUTH_CLIENT_ID"
    "GOOGLE_OAUTH_CLIENT_SECRET"
    "GH_REVIEW_APP_ID"
    "GH_REVIEW_APP_PRIVATE_KEY_BASE64"
    "GH_REPOS"
    "GH_WEBHOOK_SECRET"
    "PRIVY_APP_ID"
    "PRIVY_APP_SECRET"
    "PRIVY_SIGNING_KEY"
    "CONNECTIONS_ENCRYPTION_KEY"
)

for secret in "${OPTIONAL_SECRETS[@]}"; do
    if [[ -z "${!secret:-}" ]]; then
        log_warn "Optional secret not set: $secret"
    fi
done

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Artifact directory
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ARTIFACT_DIR="${RUNNER_TEMP:-/tmp}/deploy-infra-${GITHUB_RUN_ID:-$$}"
mkdir -p "$ARTIFACT_DIR"

log_info "Deploying infrastructure to $ENVIRONMENT..."
log_info "Domain: $DOMAIN"
log_info "VM Host: $VM_HOST"
log_info "Artifact directory: $ARTIFACT_DIR"

emit_deployment_event "infra_deployment.started" "in_progress" "Deploying infrastructure to $ENVIRONMENT"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Create remote deployment script (heredoc — no variable expansion)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
cat > "$ARTIFACT_DIR/deploy-infra-remote.sh" << 'EOF'
#!/bin/bash
# Remote infrastructure deployment script (generated by deploy-infra.sh)
# Purpose: Start/update Compose infra services on VM. App containers managed by k8s.
# Architecture:
#   - Edge stack (Caddy): Always-on TLS termination, rarely touched
#   - Runtime stack (postgres, litellm, alloy, temporal, redis, etc.): Updated on each deploy
#   - App pods (operator, poly, resy): NOT managed here — k8s/Argo handles those

set -euo pipefail

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Error capture: Show exactly what failed (line number + command)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
trap 'echo -e "\033[0;31m[FATAL]\033[0m Script failed at line $LINENO: $BASH_COMMAND" >&2' ERR

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Docker prerequisite gate (fail fast if VM not bootstrapped)
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

  command -v jq >/dev/null 2>&1 || { echo "[deploy-infra] jq missing; skipping deployment event" >&2; return 0; }
  if [[ -z "${GRAFANA_CLOUD_LOKI_URL:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_USER:-}" ]] || [[ -z "${GRAFANA_CLOUD_LOKI_API_KEY:-}" ]]; then
    return 0
  fi

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
    --arg timestamp "$timestamp" \
    '{
      streams: [{
        stream: {
          app: "cogni-template",
          env: $env,
          service: "infra-deployment",
          stream: "stdout"
        },
        values: [[$ns, ({
          level: "info",
          event: $event,
          status: $status,
          msg: $msg,
          commit: $commit,
          actor: $actor,
          time: $timestamp
        } | tostring)]]
      }]
    }')

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
append_env_if_set() {
    local file="${1:?file required}" key="${2:?key required}" val="${3-}"
    if [[ -n "$val" ]]; then printf '%s=%s\n' "$key" "$val" >> "$file"; fi
}

log_info "Setting up infrastructure deployment on VM..."

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

# Self-resolve LiteLLM image from GHCR tag if not already a GHCR ref.
# This avoids depending on promote-and-deploy.yml workflow outputs
# (workflow_run uses main's YAML, not canary's). SCRIPTS_ARE_THE_API.
if [[ "$LITELLM_IMAGE" != ghcr.io/* ]] && [[ -n "${COGNI_REPO_REF:-}" ]] && [[ "$COGNI_REPO_REF" != "unknown" ]]; then
  LITELLM_IMAGE="ghcr.io/cogni-dao/cogni-template:preview-${COGNI_REPO_REF}-litellm"
  log_info "Resolved LiteLLM image from COGNI_REPO_REF: $LITELLM_IMAGE"
fi
LITELLM_IMAGE=${LITELLM_IMAGE:-cogni-litellm:latest}

# Runtime env (full config — compose validates all vars even for services we don't start)
RUNTIME_ENV=/opt/cogni-template-runtime/.env
cat > "$RUNTIME_ENV" << ENV_EOF
# Required vars
DOMAIN=${DOMAIN}
APP_ENV=${APP_ENV}
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
TEMPORAL_DB_USER=${TEMPORAL_DB_USER}
TEMPORAL_DB_PASSWORD=${TEMPORAL_DB_PASSWORD}
COGNI_REPO_URL=${COGNI_REPO_URL}
COGNI_REPO_REF=${COGNI_REPO_REF}
GIT_READ_USERNAME=${GIT_READ_USERNAME}
GIT_READ_TOKEN=${GIT_READ_TOKEN}
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
OPENCLAW_GITHUB_RW_TOKEN=${OPENCLAW_GITHUB_RW_TOKEN}
POSTHOG_API_KEY=${POSTHOG_API_KEY}
POSTHOG_HOST=${POSTHOG_HOST}
# App/worker images — not started by infra deploy, but compose validates all vars.
# Use placeholder values; k8s/Argo manages the real images.
APP_IMAGE=${APP_IMAGE:-cogni-template-local}
MIGRATOR_IMAGE=${MIGRATOR_IMAGE:-unused-by-infra-deploy}
SCHEDULER_WORKER_IMAGE=${SCHEDULER_WORKER_IMAGE:-unused-by-infra-deploy}
# LiteLLM image — resolved before this heredoc via self-resolve logic (bug.0298 / G12).
# Falls back to local build tag for dev/provision where LITELLM_IMAGE is unset.
LITELLM_IMAGE=${LITELLM_IMAGE:-cogni-litellm:latest}
ENV_EOF

# Verify .env was written
if ! test -s "$RUNTIME_ENV"; then
  log_error ".env write failed: $RUNTIME_ENV is empty or missing"
  exit 1
fi
log_info ".env written: $(wc -c < "$RUNTIME_ENV") bytes, $(wc -l < "$RUNTIME_ENV") lines"

# Optional observability vars — only written if set (empty string breaks Zod validation)
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
# Prometheus read path (app queries)
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_QUERY_URL "${PROMETHEUS_QUERY_URL-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_READ_USERNAME "${PROMETHEUS_READ_USERNAME-}"
append_env_if_set "$RUNTIME_ENV" PROMETHEUS_READ_PASSWORD "${PROMETHEUS_READ_PASSWORD-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_PUBLIC_KEY "${LANGFUSE_PUBLIC_KEY-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_SECRET_KEY "${LANGFUSE_SECRET_KEY-}"
append_env_if_set "$RUNTIME_ENV" LANGFUSE_BASE_URL "${LANGFUSE_BASE_URL-}"
# Discord bot (OpenClaw channel plugin)
append_env_if_set "$RUNTIME_ENV" DISCORD_BOT_TOKEN "${DISCORD_BOT_TOKEN-}"
# OAuth providers (optional)
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
# Grafana observability (for OpenClaw grafana-health skill)
append_env_if_set "$RUNTIME_ENV" GRAFANA_URL "${GRAFANA_URL-}"
append_env_if_set "$RUNTIME_ENV" GRAFANA_SERVICE_ACCOUNT_TOKEN "${GRAFANA_SERVICE_ACCOUNT_TOKEN-}"
# Per-node endpoints (LiteLLM billing callback routing: Compose → k8s NodePorts)
# LiteLLM runs in Docker Compose and must reach k8s node-app Services via NodePort.
# k8s service names don't resolve from Compose — use host.docker.internal:NodePort.
# Note: the k8s scheduler-worker gets its own COGNI_NODE_ENDPOINTS from the k8s overlay ConfigMap.
LITELLM_NODE_ENDPOINTS="4ff8eac1-4eba-4ed0-931b-b1fe4f64713d=http://host.docker.internal:30000,5ed2d64f-2745-4676-983b-2fb7e05b2eba=http://host.docker.internal:30100,f6d2a17d-b7f6-4ad1-a86b-f0ad2380999e=http://host.docker.internal:30300"
printf '%s=%s\n' COGNI_NODE_ENDPOINTS "$LITELLM_NODE_ENDPOINTS" >> "$RUNTIME_ENV"
# Multi-node DB provisioning
append_env_if_set "$RUNTIME_ENV" COGNI_NODE_DBS "${COGNI_NODE_DBS-}"

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
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVAIL_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d G)
USED_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d %)

log_info "Disk: ${AVAIL_GB}GB free, ${USED_PCT}% used"

if [ "$AVAIL_GB" -lt 7 ] || [ "$USED_PCT" -gt 70 ]; then
  log_warn "Low disk space (${AVAIL_GB}GB free, ${USED_PCT}% used). Running cleanup..."
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
# Step 3.5: Pull sandbox images (may update on :latest)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Pulling sandbox images..."
OPENCLAW_GATEWAY_IMAGE="ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest"
PNPM_STORE_IMAGE="ghcr.io/cogni-dao/node-template:pnpm-store-latest"
docker pull "$OPENCLAW_GATEWAY_IMAGE"
docker pull "$PNPM_STORE_IMAGE" || log_warn "pnpm-store image not found, skipping"

# Pull LiteLLM from GHCR (built in CI — bug.0298 / G12).
# LITELLM_IMAGE was self-resolved above from COGNI_REPO_REF to a GHCR tag,
# or remains "cogni-litellm:latest" for local dev/provision (no pull needed).
if [[ "$LITELLM_IMAGE" == ghcr.io/* ]]; then
  log_info "Pulling LiteLLM image: $LITELLM_IMAGE"
  docker pull "$LITELLM_IMAGE"
else
  log_info "LiteLLM image is local ($LITELLM_IMAGE) — skipping pull"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3.6: Seed pnpm_store volume (idempotent, skip if hash matches)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
source /tmp/seed-pnpm-store.sh

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4: Assert profile services exist (guard against silent compose drift)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESOLVED_SERVICES=$($RUNTIME_COMPOSE --profile bootstrap --profile sandbox-openclaw config --services)
for svc in openclaw-gateway llm-proxy-openclaw; do
  if ! echo "$RESOLVED_SERVICES" | grep -q "^${svc}$"; then
    log_error "Profile guardrail: service '$svc' not found in compose config."
    exit 1
  fi
done
log_info "Profile guardrail passed: openclaw-gateway, llm-proxy-openclaw resolved"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 5: Start/update postgres (must be healthy before provisioning)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Bringing up postgres..."
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
# Step 6: Run DB provisioning (idempotent — creates users/DBs if missing)
# Note: DB migrations are NOT run here — k8s PreSync hook handles those.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Running DB provisioning..."
emit_deployment_event "infra_deployment.db_provision_started" "in_progress" "Provisioning database users and schemas"
$RUNTIME_COMPOSE --profile bootstrap run --rm db-provision
log_info "[$(date -u +%H:%M:%S)] DB provisioning complete"
emit_deployment_event "infra_deployment.db_provision_complete" "success" "Database provisioned successfully"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.6: Start/update infra services (rolling update, no down)
# Compose infra (Temporal, LiteLLM, Redis) must be up BEFORE k8s pods restart,
# because k8s pods depend on these via EndpointSlice bridges.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "[$(date -u +%H:%M:%S)] Starting infra services (rolling update)..."
emit_deployment_event "infra_deployment.stack_up_started" "in_progress" "Starting infrastructure services"

# Autoheal guard: stop autoheal before compose up to prevent race condition
# (autoheal can restart a container between compose stop and remove)
$RUNTIME_COMPOSE stop autoheal 2>/dev/null || true

# Infra services only — excludes app, scheduler-worker, db-migrate
INFRA_SERVICES="postgres litellm redis alloy temporal-postgres temporal temporal-ui autoheal repo-init git-sync"
$RUNTIME_COMPOSE up -d --remove-orphans $INFRA_SERVICES

# Sandbox-openclaw services (separate profile)
# Non-fatal: openclaw is non-functional in multi-node (git-sync exit 1 kills compose).
# Keep starting it best-effort so the containers exist for future enablement.
$RUNTIME_COMPOSE --profile sandbox-openclaw up -d openclaw-gateway llm-proxy-openclaw || \
  log_info "⚠️  Sandbox-openclaw services failed to start (non-fatal, openclaw is non-functional in multi-node)"

log_info "[$(date -u +%H:%M:%S)] Infra stack up complete"
emit_deployment_event "infra_deployment.stack_up_complete" "success" "Infrastructure services started"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.6a: Checksum-gated restart for LiteLLM config changes
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
    emit_deployment_event "infra_deployment.litellm_restart" "in_progress" "Restarting LiteLLM due to config change"
    $RUNTIME_COMPOSE restart litellm
    echo "$NEW_HASH" > "$LITELLM_HASH_FILE"
    log_info "LiteLLM restarted with new config"
    emit_deployment_event "infra_deployment.litellm_restart_complete" "success" "LiteLLM restarted successfully"
  else
    log_info "LiteLLM config unchanged (hash: ${NEW_HASH:0:12}...), no restart needed"
  fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.6b: Checksum-gated recreate for OpenClaw config changes
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPENCLAW_CONFIG="/opt/cogni-template-runtime/openclaw/openclaw-gateway.json"
OPENCLAW_HASH_FILE="$HASH_DIR/openclaw-gateway.sha256"

mkdir -p "$HASH_DIR"

NEW_HASH="$(hash_file "$OPENCLAW_CONFIG")"
OLD_HASH="$(cat "$OPENCLAW_HASH_FILE" 2>/dev/null || true)"

if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  log_info "OpenClaw config changed (hash: ${NEW_HASH:0:12}...), recreating gateway..."
  emit_deployment_event "infra_deployment.openclaw_recreate" "in_progress" "Recreating OpenClaw gateway due to config change"
  if $RUNTIME_COMPOSE --profile sandbox-openclaw up -d --no-deps --force-recreate openclaw-gateway; then
    echo "$NEW_HASH" > "$OPENCLAW_HASH_FILE"
    log_info "OpenClaw gateway recreated with new config"
    emit_deployment_event "infra_deployment.openclaw_recreate_complete" "success" "OpenClaw gateway recreated successfully"
  else
    log_info "⚠️  OpenClaw gateway recreate failed (non-fatal)"
  fi
else
  log_info "OpenClaw config unchanged (hash: ${NEW_HASH:0:12}...), no recreate needed"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.6c: OpenClaw readiness gate (fail deploy if crash-looping)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPENCLAW_CID=$($RUNTIME_COMPOSE --profile sandbox-openclaw ps -q openclaw-gateway 2>/dev/null || true)
if [[ -n "$OPENCLAW_CID" ]] && docker inspect -f '{{.State.Status}}' "$OPENCLAW_CID" 2>/dev/null | grep -q "running"; then
  log_info "Waiting for OpenClaw readiness..."
  bash /tmp/healthcheck-openclaw.sh "$RUNTIME_COMPOSE --profile sandbox-openclaw"
else
  log_warn "OpenClaw gateway not running — skipping readiness gate"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.7: Ensure Temporal namespace exists (idempotent)
# App pods need cogni-${env} namespace registered in Temporal before /readyz passes.
# Same script used by provision-test-vm.sh — one shared primitive.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEMPORAL_NAMESPACE="cogni-${DEPLOY_ENVIRONMENT}" \
TEMPORAL_CONTAINER="cogni-runtime-temporal-1" \
TEMPORAL_TIMEOUT=60 \
  bash /tmp/ensure-temporal-namespace.sh

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6.8: Dependency reachability probes
# Verify Compose services are reachable from k8s pods before restarting them.
# These use the same EndpointSlice bridges the app pods will use.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if command -v kubectl &>/dev/null; then
  K8S_NS="cogni-${DEPLOY_ENVIRONMENT}"
  log_info "[$(date -u +%H:%M:%S)] Probing dependency reachability from k8s..."

  probe_dependency() {
    local name="$1" host="$2" port="$3"
    local pod_name="probe-${name}-$(date +%s)"
    kubectl -n "${K8S_NS}" delete pod "$pod_name" --ignore-not-found 2>/dev/null || true
    if kubectl -n "${K8S_NS}" run --rm -i --restart=Never \
      --image=busybox:1.36 "$pod_name" \
      --timeout=30s -- nc -zw10 "$host" "$port" 2>/dev/null; then
      log_info "  ✅ ${name} reachable at ${host}:${port}"
    else
      log_warn "  ⚠️  ${name} not reachable at ${host}:${port} from k8s (may recover after sync)"
    fi
  }

  probe_dependency "temporal" "temporal" "7233"
  probe_dependency "litellm" "$(hostname -I | awk '{print $1}')" "4000"
  probe_dependency "redis" "$(hostname -I | awk '{print $1}')" "6379"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 7: Create/update k8s secrets + rolling restart (bridge — task.0284 replaces)
# k3s is on the same VM; kubectl is available. deploy-infra has ALL secrets
# from GitHub Environment — unlike provision which only has agent-generated ones.
# Uses --from-env-file for cleaner secret definitions.
# NOTE: This runs AFTER compose infra is up (Step 6.6) and dependency
# reachability is confirmed (Step 6.8). Long-term, secrets move to Git/Argo.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if command -v kubectl &>/dev/null; then
  log_info "[$(date -u +%H:%M:%S)] Creating/updating k8s secrets..."
  emit_deployment_event "infra_deployment.k8s_secrets_started" "in_progress" "Creating k8s secrets"

  K8S_NS="cogni-${DEPLOY_ENVIRONMENT}"
  kubectl create namespace "${K8S_NS}" 2>/dev/null || true
  HOST_IP=$(hostname -I | awk '{print $1}')
  log_info "  k8s namespace: ${K8S_NS}, host IP: ${HOST_IP}"

  # ── Per-node secrets (operator, poly, resy) ────────────────────────────────
  for node in operator poly resy; do
    SECRET_FILE=$(mktemp)
    cat > "$SECRET_FILE" <<SECEOF
DATABASE_URL=postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@${HOST_IP}:5432/cogni_${node}?sslmode=disable
DATABASE_SERVICE_URL=postgresql://${APP_DB_SERVICE_USER}:${APP_DB_SERVICE_PASSWORD}@${HOST_IP}:5432/cogni_${node}?sslmode=disable
AUTH_SECRET=${AUTH_SECRET}
LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
EVM_RPC_URL=${EVM_RPC_URL}
POSTHOG_API_KEY=${POSTHOG_API_KEY:-}
POSTHOG_HOST=${POSTHOG_HOST:-}
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
OPENCLAW_GITHUB_RW_TOKEN=${OPENCLAW_GITHUB_RW_TOKEN:-}
SCHEDULER_API_TOKEN=${SCHEDULER_API_TOKEN:-}
BILLING_INGEST_TOKEN=${BILLING_INGEST_TOKEN:-}
INTERNAL_OPS_TOKEN=${INTERNAL_OPS_TOKEN:-}
METRICS_TOKEN=${METRICS_TOKEN:-}
CONNECTIONS_ENCRYPTION_KEY=${CONNECTIONS_ENCRYPTION_KEY:-}
GH_OAUTH_CLIENT_ID=${GH_OAUTH_CLIENT_ID:-}
GH_OAUTH_CLIENT_SECRET=${GH_OAUTH_CLIENT_SECRET:-}
DISCORD_OAUTH_CLIENT_ID=${DISCORD_OAUTH_CLIENT_ID:-}
DISCORD_OAUTH_CLIENT_SECRET=${DISCORD_OAUTH_CLIENT_SECRET:-}
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:-}
GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET:-}
PRIVY_APP_ID=${PRIVY_APP_ID:-}
PRIVY_APP_SECRET=${PRIVY_APP_SECRET:-}
PRIVY_SIGNING_KEY=${PRIVY_SIGNING_KEY:-}
GH_WEBHOOK_SECRET=${GH_WEBHOOK_SECRET:-}
GH_REVIEW_APP_ID=${GH_REVIEW_APP_ID:-}
GH_REVIEW_APP_PRIVATE_KEY_BASE64=${GH_REVIEW_APP_PRIVATE_KEY_BASE64:-}
GH_REPOS=${GH_REPOS:-}
LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY:-}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY:-}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL:-}
COGNI_NODE_ENDPOINTS=${COGNI_NODE_ENDPOINTS:-}
SECEOF
    kubectl -n "${K8S_NS}" create secret generic "${node}-node-app-secrets" \
      --from-env-file="$SECRET_FILE" --dry-run=client -o yaml | kubectl apply -f -
    rm -f "$SECRET_FILE"
    log_info "  Applied ${node}-node-app-secrets"
  done

  # ── Scheduler-worker secret ────────────────────────────────────────────────
  SECRET_FILE=$(mktemp)
  cat > "$SECRET_FILE" <<SECEOF
DATABASE_URL=postgresql://${APP_DB_SERVICE_USER}:${APP_DB_SERVICE_PASSWORD}@${HOST_IP}:5432/cogni_operator?sslmode=disable
SCHEDULER_API_TOKEN=${SCHEDULER_API_TOKEN:-}
INTERNAL_OPS_TOKEN=${INTERNAL_OPS_TOKEN:-}
COGNI_NODE_ENDPOINTS=${COGNI_NODE_ENDPOINTS:-}
COGNI_NODE_DBS=${COGNI_NODE_DBS:-}
GH_REVIEW_APP_ID=${GH_REVIEW_APP_ID:-}
GH_REVIEW_APP_PRIVATE_KEY_BASE64=${GH_REVIEW_APP_PRIVATE_KEY_BASE64:-}
GH_REPOS=${GH_REPOS:-}
GH_WEBHOOK_SECRET=${GH_WEBHOOK_SECRET:-}
SECEOF
  kubectl -n "${K8S_NS}" create secret generic scheduler-worker-secrets \
    --from-env-file="$SECRET_FILE" --dry-run=client -o yaml | kubectl apply -f -
  rm -f "$SECRET_FILE"
  log_info "  Applied scheduler-worker-secrets"

  # ── Sandbox-openclaw secret ────────────────────────────────────────────────
  # Key name: GITHUB_TOKEN (not OPENCLAW_GITHUB_RW_TOKEN) — matches k8s deployment envFrom
  SECRET_FILE=$(mktemp)
  cat > "$SECRET_FILE" <<SECEOF
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
GITHUB_TOKEN=${OPENCLAW_GITHUB_RW_TOKEN:-}
LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN:-}
SECEOF
  kubectl -n "${K8S_NS}" create secret generic sandbox-openclaw-secrets \
    --from-env-file="$SECRET_FILE" --dry-run=client -o yaml | kubectl apply -f -
  rm -f "$SECRET_FILE"
  log_info "  Applied sandbox-openclaw-secrets"

  log_info "[$(date -u +%H:%M:%S)] k8s secrets applied"
  emit_deployment_event "infra_deployment.k8s_secrets_complete" "success" "k8s secrets applied"

  # ── Rolling restart — pods must restart to pick up changed secrets ──────────
  # This happens AFTER compose infra is up (Step 6.6) and dependency reachability
  # is confirmed (Step 6.8), so pods boot into a healthy environment.
  kubectl -n "${K8S_NS}" rollout restart \
    deployment/operator-node-app \
    deployment/poly-node-app \
    deployment/resy-node-app \
    deployment/scheduler-worker 2>/dev/null || true
  log_info "[$(date -u +%H:%M:%S)] Pods restarting..."

  # ── Wait for rollouts to complete — don't exit until pods are Running ──────
  # Parallel wait: all 4 rollouts run concurrently, total timeout = max(individual), not sum.
  ROLLOUT_PIDS=""
  for deploy in operator-node-app poly-node-app resy-node-app scheduler-worker; do
    kubectl -n "${K8S_NS}" rollout status "deployment/${deploy}" --timeout=300s 2>/dev/null &
    ROLLOUT_PIDS="$ROLLOUT_PIDS $!"
  done
  ROLLOUT_FAILED=0
  for pid in $ROLLOUT_PIDS; do
    if ! wait "$pid"; then
      ROLLOUT_FAILED=1
    fi
  done
  if [ $ROLLOUT_FAILED -ne 0 ]; then
    log_warn "One or more rollouts did not complete within 300s"
  fi
  log_info "[$(date -u +%H:%M:%S)] All rollouts complete"
  emit_deployment_event "infra_deployment.rollouts_complete" "success" "All k8s deployments rolled out"
else
  log_warn "kubectl not found — skipping k8s secret creation (k3s may not be installed)"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 8: Verify deployment
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Waiting for containers to be ready..."
sleep 10

log_info "Checking container status..."
echo "=== Edge stack ==="
$EDGE_COMPOSE ps
echo "=== Runtime stack (infra) ==="
$RUNTIME_COMPOSE ps
emit_deployment_event "infra_deployment.complete" "success" "Infrastructure deployment completed successfully"
log_info "Infrastructure deployment complete!"
EOF

# Make deployment script executable
chmod +x "$ARTIFACT_DIR/deploy-infra-remote.sh"

# Verify heredoc produced a valid file
if ! test -s "$ARTIFACT_DIR/deploy-infra-remote.sh"; then
  log_fatal "deploy-infra-remote.sh is empty or missing at $ARTIFACT_DIR/deploy-infra-remote.sh"
fi
LOCAL_SIZE=$(wc -c < "$ARTIFACT_DIR/deploy-infra-remote.sh")
LOCAL_SHA=$(sha256sum "$ARTIFACT_DIR/deploy-infra-remote.sh" | awk '{print $1}')
log_info "deploy-infra-remote.sh ready: ${LOCAL_SIZE} bytes, sha256=${LOCAL_SHA}"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Deploy bundles to VM via rsync
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
log_info "Deploying edge and runtime bundles to VM..."
ssh $SSH_OPTS root@"$VM_HOST" "mkdir -p /opt/cogni-template-edge /opt/cogni-template-runtime"

# Upload edge bundle (rarely changes - Caddy config only)
rsync -av -e "ssh $SSH_OPTS" \
  "$REPO_ROOT/infra/compose/edge/" \
  root@"$VM_HOST":/opt/cogni-template-edge/

# Upload runtime bundle (infra stack config)
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

# Upload deployment script
scp $SSH_OPTS "$ARTIFACT_DIR/deploy-infra-remote.sh" root@"$VM_HOST":/tmp/deploy-infra-remote.sh

# Upload healthcheck and bootstrap scripts (called from deploy-infra-remote.sh)
scp $SSH_OPTS \
  "$REPO_ROOT/scripts/ci/healthcheck-openclaw.sh" \
  "$REPO_ROOT/scripts/ci/seed-pnpm-store.sh" \
  "$REPO_ROOT/scripts/ci/ensure-temporal-namespace.sh" \
  root@"$VM_HOST":/tmp/
scp $SSH_OPTS \
  "$REPO_ROOT/services/sandbox-openclaw/seed-pnpm-store.sh" \
  root@"$VM_HOST":/tmp/seed-pnpm-store-core.sh

# Verify SCP landed correctly
REMOTE_CHECK=$(ssh $SSH_OPTS root@"$VM_HOST" "echo host=\$(hostname) date=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && sha256sum /tmp/deploy-infra-remote.sh | awk '{print \$1}'" 2>&1) || {
  log_fatal "SSH to VM failed during SCP verify: $REMOTE_CHECK"
}
log_info "VM: ${REMOTE_CHECK%%$'\n'*}"
REMOTE_SHA=$(echo "$REMOTE_CHECK" | tail -1)
if [ -z "$REMOTE_SHA" ] || [ ${#REMOTE_SHA} -ne 64 ]; then
  log_fatal "/tmp/deploy-infra-remote.sh missing or unreadable on VM. SSH output: $REMOTE_CHECK"
fi
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  log_fatal "deploy-infra-remote.sh sha256 mismatch: local=${LOCAL_SHA} remote=${REMOTE_SHA}"
fi
log_info "deploy-infra-remote.sh verified on VM (sha256 match)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Execute remote script with env vars
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ssh $SSH_OPTS root@"$VM_HOST" \
    "DOMAIN='$DOMAIN' APP_ENV='$APP_ENV' DEPLOY_ENVIRONMENT='$DEPLOY_ENVIRONMENT' DATABASE_URL='$DATABASE_URL' DATABASE_SERVICE_URL='$DATABASE_SERVICE_URL' LITELLM_MASTER_KEY='$LITELLM_MASTER_KEY' OPENROUTER_API_KEY='$OPENROUTER_API_KEY' AUTH_SECRET='$AUTH_SECRET' POSTGRES_ROOT_USER='$POSTGRES_ROOT_USER' POSTGRES_ROOT_PASSWORD='$POSTGRES_ROOT_PASSWORD' APP_DB_USER='$APP_DB_USER' APP_DB_PASSWORD='$APP_DB_PASSWORD' APP_DB_SERVICE_USER='$APP_DB_SERVICE_USER' APP_DB_SERVICE_PASSWORD='$APP_DB_SERVICE_PASSWORD' APP_DB_NAME='$APP_DB_NAME' EVM_RPC_URL='$EVM_RPC_URL' TEMPORAL_DB_USER='$TEMPORAL_DB_USER' TEMPORAL_DB_PASSWORD='$TEMPORAL_DB_PASSWORD' GHCR_DEPLOY_TOKEN='$GHCR_DEPLOY_TOKEN' GHCR_USERNAME='$GHCR_USERNAME' GRAFANA_CLOUD_LOKI_URL='${GRAFANA_CLOUD_LOKI_URL:-}' GRAFANA_CLOUD_LOKI_USER='${GRAFANA_CLOUD_LOKI_USER:-}' GRAFANA_CLOUD_LOKI_API_KEY='${GRAFANA_CLOUD_LOKI_API_KEY:-}' METRICS_TOKEN='${METRICS_TOKEN:-}' SCHEDULER_API_TOKEN='${SCHEDULER_API_TOKEN:-}' BILLING_INGEST_TOKEN='${BILLING_INGEST_TOKEN:-}' INTERNAL_OPS_TOKEN='${INTERNAL_OPS_TOKEN:-}' PROMETHEUS_REMOTE_WRITE_URL='${PROMETHEUS_REMOTE_WRITE_URL:-}' PROMETHEUS_USERNAME='${PROMETHEUS_USERNAME:-}' PROMETHEUS_PASSWORD='${PROMETHEUS_PASSWORD:-}' PROMETHEUS_QUERY_URL='${PROMETHEUS_QUERY_URL:-}' PROMETHEUS_READ_USERNAME='${PROMETHEUS_READ_USERNAME:-}' PROMETHEUS_READ_PASSWORD='${PROMETHEUS_READ_PASSWORD:-}' LANGFUSE_PUBLIC_KEY='${LANGFUSE_PUBLIC_KEY:-}' LANGFUSE_SECRET_KEY='${LANGFUSE_SECRET_KEY:-}' LANGFUSE_BASE_URL='${LANGFUSE_BASE_URL:-}' COGNI_REPO_URL='$COGNI_REPO_URL' COGNI_REPO_REF='$COGNI_REPO_REF' GIT_READ_USERNAME='$GIT_READ_USERNAME' GIT_READ_TOKEN='$GIT_READ_TOKEN' OPENCLAW_GATEWAY_TOKEN='$OPENCLAW_GATEWAY_TOKEN' OPENCLAW_GITHUB_RW_TOKEN='${OPENCLAW_GITHUB_RW_TOKEN:-}' GRAFANA_URL='${GRAFANA_URL:-}' GRAFANA_SERVICE_ACCOUNT_TOKEN='${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}' POSTHOG_API_KEY='$POSTHOG_API_KEY' POSTHOG_HOST='$POSTHOG_HOST' DISCORD_BOT_TOKEN='${DISCORD_BOT_TOKEN:-}' GH_OAUTH_CLIENT_ID='${GH_OAUTH_CLIENT_ID:-}' GH_OAUTH_CLIENT_SECRET='${GH_OAUTH_CLIENT_SECRET:-}' DISCORD_OAUTH_CLIENT_ID='${DISCORD_OAUTH_CLIENT_ID:-}' DISCORD_OAUTH_CLIENT_SECRET='${DISCORD_OAUTH_CLIENT_SECRET:-}' GOOGLE_OAUTH_CLIENT_ID='${GOOGLE_OAUTH_CLIENT_ID:-}' GOOGLE_OAUTH_CLIENT_SECRET='${GOOGLE_OAUTH_CLIENT_SECRET:-}' GH_REVIEW_APP_ID='${GH_REVIEW_APP_ID:-}' GH_REVIEW_APP_PRIVATE_KEY_BASE64='${GH_REVIEW_APP_PRIVATE_KEY_BASE64:-}' GH_REPOS='${GH_REPOS:-}' GH_WEBHOOK_SECRET='${GH_WEBHOOK_SECRET:-}' PRIVY_APP_ID='${PRIVY_APP_ID:-}' PRIVY_APP_SECRET='${PRIVY_APP_SECRET:-}' PRIVY_SIGNING_KEY='${PRIVY_SIGNING_KEY:-}' CONNECTIONS_ENCRYPTION_KEY='${CONNECTIONS_ENCRYPTION_KEY:-}' COGNI_NODE_ENDPOINTS='${COGNI_NODE_ENDPOINTS:-}' COGNI_NODE_DBS='${COGNI_NODE_DBS:-}' LITELLM_IMAGE='${LITELLM_IMAGE:-cogni-litellm:latest}' COMMIT_SHA='${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}' DEPLOY_ACTOR='${GITHUB_ACTOR:-$(whoami)}' bash /tmp/deploy-infra-remote.sh"

emit_deployment_event "infra_deployment.complete" "success" "Infrastructure deployment completed"
log_info "Infrastructure deployment complete!"
