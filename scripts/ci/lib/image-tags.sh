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
#                                                   and pairs apps with per-node migrators
#   - detect-affected.sh (dispatcher)             — target list only
#
# Adding a new node (e.g. `mynode`) is a single edit here:
#   1. Add `mynode`, `mynode-migrator` to ALL_TARGETS
#   2. Add the case arms to tag_suffix_for_target
# All workflows automatically pick up the new target on their next run.
#
# Convention: `tag_suffix_for_target TARGET` prints the string that
# appends to a base image tag to form the full GHCR tag.
#   - operator          → ""                (unsuffixed, historical)
#   - <node>            → "-<node>"
#   - <node>-migrator   → "-<node>-migrate" (migrator → migrate; task.0324)
#   - scheduler-worker  → "-scheduler-worker"
#
# Convention: `image_name_for_target TARGET` prints the GHCR package the
# target pushes to. bug.0344 split the migrator images into a distinct
# GHCR package so argocd-image-updater's ContainsImage matcher
# (pkg/image/image.go:148, matches by RegistryURL+ImageName only) gives
# app and migrator aliases independent Status.Summary.Images entries —
# otherwise only one of {app, migrator} updates per poll in steady state.
#   - app targets (operator, poly, resy, scheduler-worker) → cogni-template
#   - migrator targets (*-migrator)                        → cogni-template-migrate
#
# Example:
#   base="pr-918-a377bad"; target=poly-migrator
#   image_name_for_target "$target"                        → ghcr.io/cogni-dao/cogni-template-migrate
#   image_tag_for_target  "$(image_name_for_target $t)" "$base" "$t"
#                                                          → ghcr.io/cogni-dao/cogni-template-migrate:pr-918-a377bad-poly-migrate

# Intentionally no `set -euo pipefail` — this file is meant to be sourced,
# and forcing strict-mode on the caller can break subtle behaviour in shells
# that already have their own error handling (e.g. the || patterns in
# resolve_digest_ref). The caller sets its own mode.

# Default GHCR packages. Callers may override via env before sourcing.
# shellcheck disable=SC2034
IMAGE_NAME_APP=${IMAGE_NAME_APP:-ghcr.io/cogni-dao/cogni-template}
# shellcheck disable=SC2034
IMAGE_NAME_MIGRATOR=${IMAGE_NAME_MIGRATOR:-ghcr.io/cogni-dao/cogni-template-migrate}

# shellcheck disable=SC2034  # ALL_TARGETS is consumed by callers after sourcing
ALL_TARGETS=(
  operator
  operator-migrator
  poly
  poly-migrator
  resy
  resy-migrator
  scheduler-worker
)

# Target names that pair with a per-node migrator (task.0324). Used by
# promote-and-deploy's promote loop to pass each node its own migrator
# digest rather than a single shared one.
# shellcheck disable=SC2034
NODE_TARGETS=(operator poly resy)

# Map a target to its GHCR package. bug.0344: split migrator images into
# a distinct package so the Argo CD Image Updater's needsUpdate can track
# app + migrator independently in the same Application's Status.Summary.Images.
image_name_for_target() {
  local target="$1"
  case "$target" in
    *-migrator) printf '%s' "$IMAGE_NAME_MIGRATOR" ;;
    *)          printf '%s' "$IMAGE_NAME_APP" ;;
  esac
}

tag_suffix_for_target() {
  local target="$1"
  case "$target" in
    operator)          printf '%s' '' ;;
    poly)              printf -- '-poly' ;;
    resy)              printf -- '-resy' ;;
    operator-migrator) printf -- '-operator-migrate' ;;
    poly-migrator)     printf -- '-poly-migrate' ;;
    resy-migrator)     printf -- '-resy-migrate' ;;
    scheduler-worker)  printf -- '-scheduler-worker' ;;
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
