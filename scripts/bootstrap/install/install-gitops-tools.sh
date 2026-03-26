#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Installs age (encryption) and sops (secret management) for GitOps secret handling.
# Called by setup.sh --all, or run standalone.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        log_info "$1 is already installed ($(command -v "$1"))"
        return 0
    fi
    return 1
}

install_brew_package() {
    local package=$1
    if ! check_command "$package"; then
        log_info "Installing $package via Homebrew..."
        brew install "$package"
    fi
}

if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v brew >/dev/null 2>&1; then
        log_warn "Homebrew not found. Please install Homebrew first."
        exit 1
    fi
    install_brew_package age
    install_brew_package sops
else
    if ! check_command age; then
        log_warn "Non-macOS: install age manually — https://github.com/FiloSottile/age"
    fi
    if ! check_command sops; then
        log_warn "Non-macOS: install sops manually — https://github.com/getsops/sops"
    fi
fi

log_info "age $(age --version 2>&1 | head -1)"
log_info "sops $(sops --version 2>&1 | head -1)"
