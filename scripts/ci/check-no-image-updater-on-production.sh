#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# bug.0344 B12(c) — enforce that production-applicationset.yaml carries
# ZERO argocd-image-updater annotations.
#
# Why this is a hard CI gate, not a style preference:
#   Production overlays are intentionally human-gated — promote-to-production.yml
#   is the only path that pins digests on main's infra/k8s/overlays/production/.
#   The MVP GHCR-split + preview/candidate-a image updater wiring (bug.0344)
#   deliberately stops at the preview/candidate-a scope. If anyone later
#   annotates the production AppSet and auto-merges, the controller will happily
#   commit fresh preview-* digests onto production overlays — bypassing the
#   promote gate completely, with no PR, no review, no changelog.
#
# This check is the structural invariant that backstops the "production is
# follow-up" language in the design doc. Invariants without automated
# enforcement are exactly the shape of bug #970.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT_DIR/infra/k8s/argocd/production-applicationset.yaml"

if [[ ! -f "$TARGET" ]]; then
  echo "::error::bug.0344 B12(c) check: $TARGET not found" >&2
  exit 1
fi

# grep -n to expose line numbers in the error annotation.
if matches=$(grep -n 'argocd-image-updater.argoproj.io' "$TARGET"); then
  echo "::error file=infra/k8s/argocd/production-applicationset.yaml::bug.0344 B12(c): production-applicationset.yaml must not carry any argocd-image-updater annotations. Production overlay digests are human-gated via promote-to-production.yml. If auto-commit on production is genuinely desired, that is a new work item — not a line edit." >&2
  echo "" >&2
  echo "Offending lines:" >&2
  printf '%s\n' "$matches" >&2
  exit 1
fi

echo "bug.0344 B12(c) check: production-applicationset.yaml is clean (no argocd-image-updater annotations)."
