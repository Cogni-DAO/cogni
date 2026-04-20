#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${RUST_DOCKER_IMAGE:-rust:1-bookworm}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <cargo command...>" >&2
  exit 1
fi

docker run --rm \
  -e CARGO_HOME=/cargo \
  -e CARGO_TARGET_DIR=/workspace/services/rust-node/target \
  -v "$ROOT_DIR:/workspace" \
  -v cogni_rust_cargo_registry:/cargo/registry \
  -v cogni_rust_cargo_git:/cargo/git \
  -w /workspace/services/rust-node \
  "$IMAGE" \
  bash -lc '
set -euo pipefail
export PATH="/usr/local/cargo/bin:$PATH"
if [ "${1:-}" = "cargo" ] && [ "${2:-}" = "fmt" ]; then
  rustup component add rustfmt >/dev/null
fi
"$@"
' -- "$@"
