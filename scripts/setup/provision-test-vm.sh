#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Script: scripts/setup/provision-test-vm.sh
# Purpose: One-command test VM provisioning for Argo CD pipeline validation.
#          Generates ephemeral SSH + age keys, writes tfvars, runs tofu apply.
# Usage:
#   CHERRY_AUTH_TOKEN=<token> CHERRY_PROJECT_ID=<id> bash scripts/setup/provision-test-vm.sh
#   # Or interactively (prompts for values)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROVISION_DIR="$REPO_ROOT/infra/provision/cherry/base"
WORKSPACE="test"
BRANCH="worktree-cd-pipeline-analysis"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Prerequisites ──────────────────────────────────────────
for cmd in tofu ssh-keygen age-keygen; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Required: $cmd not found. Install it first."
    exit 1
  fi
done

# ── Collect inputs ─────────────────────────────────────────
if [[ -z "${CHERRY_AUTH_TOKEN:-}" ]]; then
  echo -n "Cherry Servers API token: "
  read -rs CHERRY_AUTH_TOKEN
  echo ""
fi
export CHERRY_AUTH_TOKEN

if [[ -z "${CHERRY_PROJECT_ID:-}" ]]; then
  echo -n "Cherry Servers project ID: "
  read -r CHERRY_PROJECT_ID
  echo ""
fi

# Optional: GHCR token for k3s image pulls (dummy OK for test)
GHCR_TOKEN="${GHCR_DEPLOY_TOKEN:-dummy-ghcr-token-for-test}"
GHCR_USERNAME="${GHCR_DEPLOY_USERNAME:-Cogni-1729}"

# ── Generate ephemeral keys ────────────────────────────────
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

log_info "Generating ephemeral SSH keypair..."
ssh-keygen -t ed25519 -f "$TMPDIR/deploy_key" -C "cogni-test-vm" -N "" -q
cp "$TMPDIR/deploy_key.pub" "$PROVISION_DIR/keys/cogni_template_test_deploy.pub"

log_info "Generating ephemeral SOPS age keypair..."
age-keygen -o "$TMPDIR/age-key.txt" 2>"$TMPDIR/age-pub.txt"
AGE_PRIVATE_KEY=$(grep 'AGE-SECRET-KEY' "$TMPDIR/age-key.txt")
AGE_PUBLIC_KEY=$(grep 'age1' "$TMPDIR/age-pub.txt" || grep 'age1' "$TMPDIR/age-key.txt" | head -1)

log_info "  Age public key: $AGE_PUBLIC_KEY"
log_info "  SSH public key: $(cat "$TMPDIR/deploy_key.pub")"

# ── Write tfvars ───────────────────────────────────────────
TFVARS="$PROVISION_DIR/terraform.test.tfvars"
cat > "$TFVARS" << EOF
environment          = "preview"
vm_name_prefix       = "cogni-test"
project_id           = "${CHERRY_PROJECT_ID}"
plan                 = "B1-8-8gb-80s-shared"
region               = "LT-Siauliai"
public_key_path      = "keys/cogni_template_test_deploy.pub"
ghcr_deploy_username = "${GHCR_USERNAME}"
cogni_repo_url       = "https://github.com/Cogni-DAO/cogni-template.git"
cogni_repo_ref       = "${BRANCH}"
EOF

log_info "Wrote $TFVARS"

# ── Set sensitive TF vars via environment ──────────────────
export TF_VAR_ssh_private_key="$(cat "$TMPDIR/deploy_key")"
export TF_VAR_ghcr_deploy_token="$GHCR_TOKEN"
export TF_VAR_sops_age_private_key="$AGE_PRIVATE_KEY"

# ── Tofu init + apply ─────────────────────────────────────
cd "$PROVISION_DIR"

log_info "Initializing OpenTofu..."
tofu init -input=false

log_info "Selecting workspace: $WORKSPACE"
tofu workspace new "$WORKSPACE" 2>/dev/null || tofu workspace select "$WORKSPACE"

log_info "Planning..."
tofu plan -var-file="terraform.test.tfvars" -out=tfplan

echo ""
log_warn "About to provision a VM. This costs money and takes ~5 minutes."
echo -n "Proceed? [y/N] "
read -r confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  log_info "Aborted."
  exit 0
fi

log_info "Applying..."
tofu apply tfplan

VM_IP=$(tofu output -raw vm_host)
log_info "VM provisioned at: $VM_IP"

# ── Save connection info ───────────────────────────────────
# Copy the SSH key somewhere persistent (tmpdir cleaned on exit)
mkdir -p "$REPO_ROOT/.local"
cp "$TMPDIR/deploy_key" "$REPO_ROOT/.local/test-vm-key"
chmod 600 "$REPO_ROOT/.local/test-vm-key"
echo "$VM_IP" > "$REPO_ROOT/.local/test-vm-ip"
echo "$AGE_PRIVATE_KEY" > "$REPO_ROOT/.local/test-vm-age-key"

echo ""
log_info "═══════════════════════════════════════════════════════"
log_info "Test VM ready! Connection info saved to .local/"
log_info "═══════════════════════════════════════════════════════"
echo ""
echo "SSH:     ssh -i .local/test-vm-key root@$VM_IP"
echo "Verify:  ssh -i .local/test-vm-key root@$VM_IP 'cat /var/lib/cogni/bootstrap.ok'"
echo ""
echo "After cloud-init completes (~3-5 min), verify:"
echo "  ssh -i .local/test-vm-key root@$VM_IP 'kubectl get nodes'"
echo "  ssh -i .local/test-vm-key root@$VM_IP 'kubectl -n argocd get applicationsets'"
echo "  ssh -i .local/test-vm-key root@$VM_IP 'kubectl -n argocd get applications'"
echo ""
echo "Destroy when done:"
echo "  cd infra/provision/cherry/base"
echo "  tofu workspace select test"
echo "  tofu destroy -var-file=terraform.test.tfvars"
echo ""
