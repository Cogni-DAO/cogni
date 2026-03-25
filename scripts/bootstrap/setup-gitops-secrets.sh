#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Automates SOPS/age secret setup for GitOps (Argo CD + ksops).
#
# What this does:
#   1. Generates age keypairs (one per environment) if they don't exist
#   2. Updates .sops.yaml with the public keys
#   3. Prints the TF_VAR exports you need for tofu apply
#
# Usage:
#   scripts/bootstrap/setup-gitops-secrets.sh [staging|production|all]
#
# Keypairs are stored in ~/.cogni/ (gitignored, never committed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
KEY_DIR="$HOME/.cogni"
SOPS_CONFIG="$REPO_ROOT/infra/cd/secrets/.sops.yaml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Validate tools
for cmd in age-keygen sops sed; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        log_error "$cmd not found. Run: scripts/bootstrap/install/install-gitops-tools.sh"
        exit 1
    fi
done

mkdir -p "$KEY_DIR"

ENV="${1:-all}"

generate_keypair() {
    local env_name=$1
    local key_file="$KEY_DIR/${env_name}-age-key.txt"

    if [[ -f "$key_file" ]]; then
        log_info "Age keypair for $env_name already exists at $key_file"
        local pubkey
        pubkey=$(grep 'public key:' "$key_file" | awk '{print $NF}')
        echo "$pubkey"
        return
    fi

    log_info "Generating age keypair for $env_name..."
    local output
    output=$(age-keygen -o "$key_file" 2>&1)
    local pubkey
    pubkey=$(echo "$output" | grep 'Public key:' | awk '{print $NF}')
    chmod 600 "$key_file"
    log_info "Keypair saved to $key_file"
    log_info "Public key: $pubkey"
    echo "$pubkey"
}

update_sops_yaml() {
    local env_name=$1
    local pubkey=$2
    local placeholder

    if [[ "$env_name" == "staging" ]]; then
        placeholder="age1staging_placeholder_replace_with_real_public_key"
    else
        placeholder="age1production_placeholder_replace_with_real_public_key"
    fi

    if grep -q "$placeholder" "$SOPS_CONFIG"; then
        sed -i.bak "s|$placeholder|$pubkey|" "$SOPS_CONFIG"
        rm -f "${SOPS_CONFIG}.bak"
        log_info "Updated .sops.yaml with $env_name public key"
    elif grep -q "$pubkey" "$SOPS_CONFIG"; then
        log_info ".sops.yaml already has $env_name public key"
    else
        log_warn ".sops.yaml doesn't have a placeholder for $env_name — update manually"
    fi
}

process_env() {
    local env_name=$1
    echo ""
    echo -e "${BLUE}━━━ $env_name ━━━${NC}"

    local pubkey
    pubkey=$(generate_keypair "$env_name")
    update_sops_yaml "$env_name" "$pubkey"
}

if [[ "$ENV" == "all" || "$ENV" == "staging" ]]; then
    process_env "staging"
fi

if [[ "$ENV" == "all" || "$ENV" == "production" ]]; then
    process_env "production"
fi

# Print the TF_VAR exports
echo ""
echo -e "${BLUE}━━━ Terraform variable exports ━━━${NC}"
echo ""
echo "# Add these to your shell before running tofu apply:"

if [[ -f "$KEY_DIR/staging-age-key.txt" ]]; then
    local_key=$(grep 'AGE-SECRET-KEY' "$KEY_DIR/staging-age-key.txt" 2>/dev/null || true)
    if [[ -n "$local_key" ]]; then
        echo "export TF_VAR_sops_age_private_key=\"$local_key\"  # staging"
    fi
fi

if [[ -f "$KEY_DIR/production-age-key.txt" ]]; then
    local_key=$(grep 'AGE-SECRET-KEY' "$KEY_DIR/production-age-key.txt" 2>/dev/null || true)
    if [[ -n "$local_key" ]]; then
        echo "# export TF_VAR_sops_age_private_key=\"$local_key\"  # production"
    fi
fi

echo ""
echo "# Also required:"
echo "export TF_VAR_ghcr_deploy_token=\"ghp_...\"  # GitHub PAT with packages:read"
echo "export TF_VAR_ssh_private_key=\"\$(cat ~/.ssh/cogni_template_preview_deploy)\""

echo ""
log_info "Next: encrypt secrets with sops, then tofu apply."
echo "  cd infra/cd/secrets"
echo "  # Edit staging/*.enc.yaml with real values, then:"
echo "  sops --encrypt --in-place staging/scheduler-worker.enc.yaml"
echo "  sops --encrypt --in-place staging/sandbox-openclaw.enc.yaml"
