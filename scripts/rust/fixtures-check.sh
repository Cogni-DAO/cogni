#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

node --import tsx/esm scripts/rust/generate-fixtures.mts
if ! git diff --exit-code -- services/rust-node/fixtures/generated; then
  echo "Rust fixtures drifted. Re-run: pnpm rust:fixtures" >&2
  exit 1
fi
