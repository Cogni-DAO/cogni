#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/ci/promote-preview-seed-main.sh
# Purpose: After Flight Preview (retag) succeeds, refresh `main` preview overlay
#   digest pins in one working-tree pass — **Option B** (task.0349): call
#   promote-k8s-image.sh --no-commit per node; do NOT reuse
#   promote-build-payload.sh (deploy-branch + .promote-state coupling).
#
# Tri-state per image (affected-only merges):
#   1) If `preview-{mergeSha}{suffix}` resolves in GHCR → use that digest.
#   2) Else retain current pin from kustomization; verify it still resolves.
#   3) Else fail (broken overlay).
#
# Does not commit or push — caller owns git (CI workflow). Exits 0 when
# there is nothing to change.
#
# Env:
#   MERGE_SHA  (required) 40-char lowercase git SHA on main (merge commit).
#
set -euo pipefail

MERGE_SHA="${MERGE_SHA:?MERGE_SHA required}"
MERGE_SHA=$(printf '%s' "$MERGE_SHA" | tr '[:upper:]' '[:lower:]')
if ! printf '%s' "$MERGE_SHA" | grep -qE '^[0-9a-f]{40}$'; then
  echo "[ERROR] MERGE_SHA must be a 40-char hex SHA" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=./lib/image-tags.sh
. "$SCRIPT_DIR/lib/image-tags.sh"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker is required" >&2
  exit 1
fi
if ! docker buildx version >/dev/null 2>&1; then
  echo "[ERROR] docker buildx is required" >&2
  exit 1
fi

BASE_TAG="preview-${MERGE_SHA}"

resolve_digest_ref() {
  local tag="$1"
  local digest
  digest=$(docker buildx imagetools inspect "$tag" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '"' || true)
  if [ -z "$digest" ] || [ "$digest" = "null" ]; then
    return 1
  fi
  printf '%s@%s' "${tag%%:*}" "$digest"
}

# Print one line: image@sha256:... or image:tag from preview overlay kustomization.
# role = app | migrator
extract_overlay_image_ref() {
  local app="$1"
  local role="$2"
  local file="infra/k8s/overlays/preview/${app}/kustomization.yaml"
  if [ ! -f "$file" ]; then
    echo "[ERROR] missing $file" >&2
    return 1
  fi
  python3 - "$file" "$role" <<'PY'
import re
import sys

path, role = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
# Split images: list items (rough but stable for our kustomize shape)
blocks = re.split(r"\n[ \t]*-\s+name:\s*", "\n" + text)
want_migrate = role == "migrator"
for block in blocks[1:]:
    line = block.split("\n", 1)[0].strip()
    if want_migrate:
        if "cogni-template-migrate" not in line:
            continue
    else:
        if line != "ghcr.io/cogni-dao/cogni-template":
            continue
    rest = block.split("\n", 1)[1] if "\n" in block else ""
    m = re.search(r'^\s*digest:\s*"(sha256:[0-9a-f]+)"', rest, re.MULTILINE)
    if m:
        print(f"{line}@{m.group(1)}", end="")
        sys.exit(0)
    m = re.search(r"^\s*newTag:\s*(\S+)", rest, re.MULTILINE)
    if m:
        print(f"{line}:{m.group(1).strip()}", end="")
        sys.exit(0)
    print(f"[ERROR] no digest/newTag under {line} in {path}", file=sys.stderr)
    sys.exit(1)
print(f"[ERROR] no {role} image block in {path}", file=sys.stderr)
sys.exit(1)
PY
}

desired_digest_for_target() {
  local target="$1"
  local full_tag app role current
  full_tag=$(image_tag_for_target "$(image_name_for_target "$target")" "$BASE_TAG" "$target") || return 1
  if digest_ref=$(resolve_digest_ref "$full_tag"); then
    printf '%s' "$digest_ref"
    return 0
  fi
  if [[ "$target" == *-migrator ]]; then
    app="${target%-migrator}"
    role=migrator
  else
    app="$target"
    role=app
  fi
  current=$(extract_overlay_image_ref "$app" "$role") || return 1
  if digest_ref=$(resolve_digest_ref "$current"); then
    printf '%s' "$digest_ref"
    return 0
  fi
  echo "[ERROR] retain path: could not resolve current ref ${current} for target ${target}" >&2
  return 1
}

promote_if_changed() {
  local app="$1" digest="$2" migrator="${3:-}"
  local file="infra/k8s/overlays/preview/${app}/kustomization.yaml"
  local before after
  before=$(sha256sum "$file" | awk '{print $1}')
  if [ -n "$migrator" ]; then
    bash "$SCRIPT_DIR/promote-k8s-image.sh" --no-commit \
      --env preview --app "$app" --digest "$digest" --migrator-digest "$migrator"
  else
    bash "$SCRIPT_DIR/promote-k8s-image.sh" --no-commit \
      --env preview --app "$app" --digest "$digest"
  fi
  after=$(sha256sum "$file" | awk '{print $1}')
  if [ "$before" != "$after" ]; then
    echo "  updated overlay: $app"
  else
    echo "  unchanged: $app"
  fi
}

echo "ℹ️  promote-preview-seed-main: MERGE_SHA=${MERGE_SHA:0:12} BASE_TAG=${BASE_TAG}"

for node in "${NODE_TARGETS[@]}"; do
  d_app=$(desired_digest_for_target "$node") || exit 1
  d_mig=$(desired_digest_for_target "${node}-migrator") || exit 1
  promote_if_changed "$node" "$d_app" "$d_mig"
done

d_sw=$(desired_digest_for_target "scheduler-worker") || exit 1
promote_if_changed "scheduler-worker" "$d_sw" ""

if git diff --quiet infra/k8s/overlays/preview/; then
  echo "ℹ️  No overlay diff — seed already matches GHCR / retain pins."
  exit 0
fi

echo "ℹ️  Overlay diff present — caller should commit and push."
exit 0
