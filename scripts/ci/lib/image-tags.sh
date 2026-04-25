#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/ci/lib/image-tags.sh — canonical deployable-image target catalog,
# target → GHCR-package mapping, and target → GHCR-tag-suffix mapping.
# Sourced by every CI actor that needs to know
# "given a target, what is its full GHCR image:tag reference?":
#
#   - build-and-push-images.sh  (producer)        — tags the image it just built
#   - resolve-pr-build-images.sh (discoverer)     — looks up pushed digests
#   - flight-preview.yml retag step (re-tagger)   — alias pr-<N>-<sha>-* → preview-<sha>-*
#   - promote-and-deploy.yml resolve/promote      — resolves preview-<sha>-* digests
#   - detect-affected.sh (dispatcher)             — target list only
#
# Adding a new node (e.g. `mynode`):
#   1. Add `mynode` to ALL_TARGETS and NODE_TARGETS
#   2. Add the case arm to tag_suffix_for_target
# All workflows automatically pick up the new target on their next run.
#
# Convention: `tag_suffix_for_target TARGET` prints the string that
# appends to a base image tag to form the full GHCR tag.
#   - operator          → ""                (unsuffixed, historical)
#   - <node>            → "-<node>"
#   - scheduler-worker  → "-scheduler-worker"
#
# Convention: `image_name_for_target TARGET` prints the GHCR package the
# target pushes to. After task.0370 step 1, every target maps to the same
# `cogni-template` package — migrations now run as Deployment initContainers
# off the runtime image, so the legacy `cogni-template-migrate` package is
# retired.
#
# Example:
#   base="pr-918-a377bad"; target=poly
#   image_name_for_target "$target"                        → ghcr.io/cogni-dao/cogni-template
#   image_tag_for_target  "$(image_name_for_target $t)" "$base" "$t"
#                                                          → ghcr.io/cogni-dao/cogni-template:pr-918-a377bad-poly

# Intentionally no `set -euo pipefail` — this file is meant to be sourced,
# and forcing strict-mode on the caller can break subtle behaviour in shells
# that already have their own error handling (e.g. the || patterns in
# resolve_digest_ref). The caller sets its own mode.

# Default GHCR packages. Callers may override via env before sourcing.
# shellcheck disable=SC2034
IMAGE_NAME_APP=${IMAGE_NAME_APP:-ghcr.io/cogni-dao/cogni-template}
# shellcheck disable=SC2034  # ALL_TARGETS is consumed by callers after sourcing
ALL_TARGETS=(
  operator
  poly
  resy
  scheduler-worker
)

# Target names that map to a node app (operator/poly/resy) — distinguishes them
# from infra-shaped targets (scheduler-worker) for CI loops that promote per-node
# overlays. task.0370 step 1 collapsed migrator images into the runtime image,
# so there's no longer a separate `*-migrator` companion target per node.
# shellcheck disable=SC2034
NODE_TARGETS=(operator poly resy)

image_name_for_target() {
  printf '%s' "$IMAGE_NAME_APP"
}

tag_suffix_for_target() {
  local target="$1"
  case "$target" in
    operator)         printf '%s' '' ;;
    poly)             printf -- '-poly' ;;
    resy)             printf -- '-resy' ;;
    scheduler-worker) printf -- '-scheduler-worker' ;;
    *)
      echo "[ERROR] image-tags: unknown target: $target" >&2
      return 1
      ;;
  esac
}

# Compose a full `image:tag` reference given an image name, a base tag
# (e.g. pr-918-<sha>, preview-<sha>, production-<sha>), and a target.
# Returns the suffixed tag reference callers feed to `docker buildx
# imagetools` / `promote-k8s-image.sh`.
image_tag_for_target() {
  local image_name="$1" base_tag="$2" target="$3" suffix
  suffix=$(tag_suffix_for_target "$target") || return 1
  printf '%s:%s%s' "$image_name" "$base_tag" "$suffix"
}
