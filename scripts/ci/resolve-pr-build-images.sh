#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Script: scripts/ci/resolve-pr-build-images.sh
# Purpose: Resolve the pushed digest refs for a PR image tag convention.

set -euo pipefail

IMAGE_NAME=${IMAGE_NAME:-ghcr.io/cogni-dao/cogni-template}
IMAGE_TAG=${IMAGE_TAG:-}
OUTPUT_FILE=${OUTPUT_FILE:-${RUNNER_TEMP:-/tmp}/resolved-pr-images.json}
ALL_TARGETS=(operator operator-migrator poly poly-migrator resy resy-migrator scheduler-worker)

if [ -z "$IMAGE_TAG" ]; then
  echo "[ERROR] IMAGE_TAG is required" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker is required" >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "[ERROR] docker buildx is required" >&2
  exit 1
fi

resolve_tag() {
  local target="$1"

  case "$target" in
    operator) printf '%s:%s' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    poly) printf '%s:%s-poly' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    resy) printf '%s:%s-resy' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    operator-migrator) printf '%s:%s-operator-migrate' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    poly-migrator) printf '%s:%s-poly-migrate' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    resy-migrator) printf '%s:%s-resy-migrate' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    scheduler-worker) printf '%s:%s-scheduler-worker' "$IMAGE_NAME" "$IMAGE_TAG" ;;
    *)
      echo "[ERROR] Unknown target: $target" >&2
      exit 1
      ;;
  esac
}

resolve_digest_ref() {
  local tag="$1"
  local digest

  digest=$(docker buildx imagetools inspect "$tag" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '"')
  if [ -z "$digest" ] || [ "$digest" = "null" ]; then
    return 1
  fi

  printf '%s@%s' "${tag%%:*}" "$digest"
}

mkdir -p "$(dirname "$OUTPUT_FILE")"

json_items=()
resolved_targets=()

for target in "${ALL_TARGETS[@]}"; do
  full_tag=$(resolve_tag "$target")
  if digest_ref=$(resolve_digest_ref "$full_tag"); then
    json_items+=("    {\n      \"target\": \"${target}\",\n      \"tag\": \"${full_tag}\",\n      \"digest\": \"${digest_ref}\"\n    }")
    resolved_targets+=("$target")
  fi
done

json_body=""
if [ ${#json_items[@]} -gt 0 ]; then
  json_body=$(printf '%b' "$(IFS=$',\n'; echo "${json_items[*]}")")
fi

cat > "$OUTPUT_FILE" <<EOF
{
  "image_name": "${IMAGE_NAME}",
  "image_tag": "${IMAGE_TAG}",
  "targets": [
${json_body}
  ]
}
EOF

resolved_targets_csv=""
if [ ${#resolved_targets[@]} -gt 0 ]; then
  resolved_targets_csv=$(IFS=,; echo "${resolved_targets[*]}")
fi

has_images=false
if [ ${#resolved_targets[@]} -gt 0 ]; then
  has_images=true
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "resolved_file=$OUTPUT_FILE"
    echo "resolved_targets=$resolved_targets_csv"
    echo "has_images=$has_images"
  } >> "$GITHUB_OUTPUT"
fi

echo "Resolved PR images: ${resolved_targets_csv:-none}"
