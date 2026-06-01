#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/bootstrap/install/install-tofu.sh
# Purpose: Install OpenTofu (`tofu`) for VM provisioning (provision-env-vm.sh).
# Usage: bash scripts/bootstrap/install/install-tofu.sh
# Note: The binary is `tofu` (brew formula + standalone installer). Idempotent.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if command -v tofu >/dev/null 2>&1; then
    log_info "tofu is already installed ($(command -v tofu))"
    tofu version || true
    exit 0
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v brew >/dev/null 2>&1; then
        log_error "Homebrew not found. Please install Homebrew first: https://brew.sh"
        exit 1
    fi
    log_info "Installing OpenTofu via Homebrew..."
    brew install opentofu

elif [[ -f /etc/debian_version ]] || [[ -f /etc/alpine-release ]]; then
    # Official standalone installer — downloads the `tofu` binary to
    # /usr/local/bin. Resolves the latest GA release (avoids a stale pin
    # breaking provisioning). Pin via --opentofu-version if reproducibility
    # matters for a given run.
    log_info "Installing OpenTofu via the official standalone installer..."
    installer=$(mktemp)
    curl -fsSL https://get.opentofu.org/install-opentofu.sh -o "$installer"
    chmod +x "$installer"
    sudo "$installer" --install-method standalone
    rm -f "$installer"

else
    log_error "Unsupported OS. Install OpenTofu manually: https://opentofu.org/docs/intro/install/"
    exit 1
fi

if command -v tofu >/dev/null 2>&1; then
    tofu version || true
    log_info "OpenTofu installation complete!"
else
    log_error "OpenTofu installation failed — tofu not found in PATH after install."
    exit 1
fi
