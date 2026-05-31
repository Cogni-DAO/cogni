#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Secret-reconciliation helpers for provision-env-vm.sh Phase 5c (bug.5081).
# Sourced — callers own shell options.
#
# Problem: bootstrap.sh Phase 2's `declare_or_gen` is idempotent against
# `.env.<env>`, but on a GHA runner the file doesn't survive the ephemeral
# FS, so every dispatch regenerates fresh random values. Without reconcile,
# Phase 5c then overwrites OpenBao (corrupting pod secrets) and Phase 5f
# writes runtime/.env with values that don't match the persisted postgres/
# temporal data dirs (immediate `password authentication failed`).
#
# Two reconcile sources, two disjoint key sets:
#   1. OpenBao SSoT  → keys delivered to k8s pods via ESO
#   2. VM runtime/.env truth → Compose-only keys (postgres bootstraps directly
#                              from this file; never reaches OpenBao)
#
# Caller contract (globals expected at invocation time):
#   DEPLOY_ENV, ROOT_TOKEN, VM_IP, SSH_OPTS, REPO_ROOT,
#   PRIMARY_NODE_DB, APP_DB_USER, APP_DB_SERVICE_USER, DOMAIN
# Caller's seed loop iterates the arrays exported here:
#   NODE_TEMPLATE_KEYS, SCHEDULER_WORKER_KEYS

# ── Per-service key arrays — single source for both reconcile + seed ──────────
# Note: operator-passthrough keys (OPENROUTER_API_KEY, POSTHOG_*, EVM_RPC_URL,
# POLYGON_RPC_URL, OPENCLAW_GITHUB_RW_TOKEN) ARE reconciled from OpenBao on
# re-runs. This matches the SSoT contract: day-2 rotations use
# `pnpm secrets:set` (which writes OpenBao directly); `gh secret set` +
# re-dispatch is bootstrap-only and will NOT propagate a value change for
# these keys past first provision.
declare -ga NODE_TEMPLATE_KEYS=(
  AUTH_SECRET LITELLM_MASTER_KEY OPENCLAW_GATEWAY_TOKEN
  OPENCLAW_GITHUB_RW_TOKEN SCHEDULER_API_TOKEN BILLING_INGEST_TOKEN
  INTERNAL_OPS_TOKEN METRICS_TOKEN GH_WEBHOOK_SECRET
  CONNECTIONS_ENCRYPTION_KEY POLY_WALLET_AEAD_KEY_HEX
  POLY_WALLET_AEAD_KEY_ID DATABASE_URL DATABASE_SERVICE_URL
  POSTHOG_API_KEY POSTHOG_HOST OPENROUTER_API_KEY
  EVM_RPC_URL POLYGON_RPC_URL
  APP_BASE_URL NEXTAUTH_URL
)
declare -ga SCHEDULER_WORKER_KEYS=(
  DATABASE_SERVICE_URL SCHEDULER_API_TOKEN GH_REVIEW_APP_ID
  GH_REVIEW_APP_PRIVATE_KEY_BASE64 GH_WEBHOOK_SECRET
  INTERNAL_OPS_TOKEN
)
# Compose-tier secrets — bootstrap postgres/temporal directly via runtime/.env,
# never seeded to OpenBao. Truth lives on the VM after first provision.
declare -ga COMPOSE_ONLY_KEYS=(
  POSTGRES_ROOT_PASSWORD
  APP_DB_PASSWORD APP_DB_SERVICE_PASSWORD APP_DB_READONLY_PASSWORD
  TEMPORAL_DB_PASSWORD
)

# Read one field from OpenBao at cogni/<env>/<svc>/<k>. Stdout = value
# (empty if path or field absent). Mirrors seed_kv's exec shape.
bao_get_field() {
  local svc="$1" k="$2"
  ssh $SSH_OPTS root@"$VM_IP" \
    "kubectl exec -n openbao openbao-0 -- env BAO_TOKEN='${ROOT_TOKEN}' BAO_ADDR=http://127.0.0.1:8200 bao kv get -format=json 'cogni/${DEPLOY_ENV}/${svc}'" \
    2>/dev/null | jq -r --arg k "$k" '.data.data[$k] // empty' 2>/dev/null || true
}

# Override the shell var + .env.<env> entry for KEY with VALUE.
# Skips if value matches or KEY isn't yet in the file. Uses `|` as sed
# delimiter (safe for base64 / hex / sk- prefixed tokens; would break
# if a value contains a literal `|`).
_apply_reconciled() {
  local k="$1" v="$2"
  local env_file="$REPO_ROOT/.env.${DEPLOY_ENV}"
  [[ -z "$v" ]] && return 1
  [[ "$v" == "${!k:-}" ]] && return 1
  export "${k}=${v}"
  if [[ -f "$env_file" ]] && grep -qE "^${k}=" "$env_file"; then
    sed -i.bak "s|^${k}=.*$|${k}=${v}|" "$env_file"
    rm -f "${env_file}.bak"
  fi
  return 0
}

# Reconcile a service's keys from OpenBao. Fresh provisions = no-op.
_reconcile_from_openbao() {
  local svc="$1"; shift
  local k v n=0
  for k in "$@"; do
    v=$(bao_get_field "$svc" "$k")
    if _apply_reconciled "$k" "$v"; then n=$((n + 1)); fi
  done
  [[ $n -gt 0 ]] && log_info "  reconciled ${n} ${svc}/ key(s) from OpenBao SSoT"
  return 0
}

# Reconcile Compose-only keys from the VM's existing runtime/.env.
# Fresh provisions (no file on VM) = no-op.
_reconcile_from_compose_vm() {
  local vm_env_dump
  vm_env_dump=$(ssh $SSH_OPTS root@"$VM_IP" \
    'cat /opt/cogni-template-runtime/.env 2>/dev/null' || true)
  if [[ -z "$vm_env_dump" ]]; then
    log_info "  no prior /opt/cogni-template-runtime/.env on VM — fresh provision"
    return 0
  fi
  local k v n=0
  for k in "${COMPOSE_ONLY_KEYS[@]}"; do
    v=$(printf '%s\n' "$vm_env_dump" | sed -n "s|^${k}=\\(.*\\)$|\\1|p" | head -1)
    if _apply_reconciled "$k" "$v"; then n=$((n + 1)); fi
  done
  [[ $n -gt 0 ]] && log_info "  reconciled ${n} Compose-only key(s) from VM runtime/.env"
  # DATABASE_URL / _SERVICE_URL are constructed in provision-env-vm.sh
  # line ~335 from APP_DB_*_PASSWORD; if the reconcile changed those,
  # re-derive so the OpenBao seed below writes a consistent value.
  if [[ $n -gt 0 ]]; then
    DATABASE_URL="postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@${VM_IP}:5432/${PRIMARY_NODE_DB}?sslmode=disable"
    DATABASE_SERVICE_URL="postgresql://${APP_DB_SERVICE_USER}:${APP_DB_SERVICE_PASSWORD}@${VM_IP}:5432/${PRIMARY_NODE_DB}?sslmode=disable"
    export DATABASE_URL DATABASE_SERVICE_URL
  fi
  return 0
}

# Entry point — called by Phase 5c after ROOT_TOKEN + APP_BASE_URL/NEXTAUTH_URL
# are set. Idempotent: fresh provisions no-op cleanly.
reconcile_secrets_on_rerun() {
  log_info "Reconciling .env.${DEPLOY_ENV} with OpenBao + VM truth (re-run idempotency, bug.5081)..."
  _reconcile_from_openbao node-template     "${NODE_TEMPLATE_KEYS[@]}"
  _reconcile_from_openbao scheduler-worker  "${SCHEDULER_WORKER_KEYS[@]}"
  _reconcile_from_compose_vm
}
