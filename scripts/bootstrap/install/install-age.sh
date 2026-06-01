#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: scripts/bootstrap/install/install-age.sh
# Purpose: Install age + age-keygen (FiloSottile/age) for init-artifact
#          encryption in provision-env.yml (passphrase-encrypted OpenBao
#          init bundle) and local SOPS/age key handling.
# Usage: bash scripts/bootstrap/install/install-age.sh
# Note: The distro/brew `age` package ships BOTH `age` and `age-keygen`.
#       provision-env.yml's prereq gate checks for both.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1; then
    log_info "age is already installed ($(command -v age))"
    age --version || true
    exit 0
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    if ! command -v brew >/dev/null 2>&1; then
        log_error "Homebrew not found. Please install Homebrew first: https://brew.sh"
        exit 1
    fi
    log_info "Installing age via Homebrew..."
    brew install age

elif [[ -f /etc/debian_version ]]; then
    log_info "Installing age via apt (ships age + age-keygen)..."
    sudo apt-get update -y
    sudo apt-get install -y age

elif [[ -f /etc/alpine-release ]]; then
    log_info "Installing age via apk..."
    apk add --no-cache age

else
    log_error "Unsupported OS. Install age manually: https://github.com/FiloSottile/age#installation"
    exit 1
fi

if command -v age >/dev/null 2>&1 && command -v age-keygen >/dev/null 2>&1; then
    age --version || true
    log_info "age installation complete!"
else
    log_error "age installation failed — age/age-keygen not found in PATH after install."
    exit 1
fi
