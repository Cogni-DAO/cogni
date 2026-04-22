#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# bug.0344 — structural guardrail on image-updater scope.
#
# Enforces a POSITIVE allowlist, not a negative enumeration: the set of
# ApplicationSet files permitted to carry argocd-image-updater.argoproj.io
# annotations is explicit and small. Every other AppSet under
# infra/k8s/argocd/*-applicationset.yaml MUST be annotation-free.
#
# Why allowlist and not blocklist:
#   A blocklist ("no annotations on production-applicationset.yaml")
#   silently lets anyone add a new env (e.g. `staging-applicationset.yaml`,
#   `canary-applicationset.yaml`) with annotations and bypass the review
#   intent of bug.0344. An allowlist fails closed: any new AppSet file
#   appearing in the tree is annotation-forbidden until the allowlist is
#   explicitly updated in a PR that names the env.
#
# Current allowlist: preview only.
#   - candidate-a was descoped post-#974 merge: candidate-flight.yml
#     unconditionally overwrites deploy/candidate-a digests on slot
#     acquisition, so main's candidate-a seed is developer-reference
#     only — the per-merge write rate wasn't worth the marginal seed
#     value. See infra/k8s/argocd/candidate-a-applicationset.yaml
#     docstring.
#   - production is human-gated. promote-to-production.yml is the only
#     path permitted to pin digests on main's production overlay. An
#     annotated production AppSet would bypass that gate entirely with
#     no PR, no review, no changelog.
#
# Re-adding annotations to any non-allowlisted AppSet — or adding a new
# AppSet to the allowlist — is a design decision (new work item, new
# invariant), not a line edit.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPSET_DIR="$ROOT_DIR/infra/k8s/argocd"

# Files permitted to carry argocd-image-updater annotations.
# Paths are relative to $ROOT_DIR. Keep this list short and named.
ALLOWLIST=(
  "infra/k8s/argocd/preview-applicationset.yaml"
)

# Every ApplicationSet file in the tree. Glob expands literally when no
# matches exist, so the [[ -f ]] guard handles an empty tree gracefully.
shopt -s nullglob
all_appsets=("$APPSET_DIR"/*-applicationset.yaml)
shopt -u nullglob

if [[ ${#all_appsets[@]} -eq 0 ]]; then
  echo "::error::bug.0344 image-updater-scope check: no *-applicationset.yaml files under $APPSET_DIR" >&2
  exit 1
fi

is_allowed() {
  local rel="$1" allowed
  for allowed in "${ALLOWLIST[@]}"; do
    [[ "$rel" == "$allowed" ]] && return 0
  done
  return 1
}

fail=0
for target in "${all_appsets[@]}"; do
  rel="${target#"$ROOT_DIR"/}"

  has_annotation=0
  matches=""
  if matches=$(grep -n 'argocd-image-updater.argoproj.io' "$target"); then
    has_annotation=1
  fi

  if is_allowed "$rel"; then
    # Allowed files MUST carry annotations — an empty allowlisted file
    # is suspicious (design intent silently lost). Warn, but don't fail;
    # a design-intent loss that fails closed here would block legitimate
    # rollback PRs.
    if [[ $has_annotation -eq 0 ]]; then
      echo "::warning file=${rel}::bug.0344 image-updater-scope: ${rel} is on the allowlist but carries NO argocd-image-updater annotations. If this is a deliberate descoping, update ALLOWLIST in scripts/ci/check-image-updater-scope.sh." >&2
    fi
    continue
  fi

  if [[ $has_annotation -eq 1 ]]; then
    echo "::error file=${rel}::bug.0344 image-updater-scope: ${rel} is NOT on the image-updater allowlist and must carry zero argocd-image-updater.argoproj.io/* annotations. Adding a new env to the allowlist is a design decision — update ALLOWLIST in scripts/ci/check-image-updater-scope.sh with a rationale commit, don't silently annotate." >&2
    echo "" >&2
    echo "Offending lines in ${rel}:" >&2
    printf '%s\n' "$matches" >&2
    fail=1
  fi
done

if [[ $fail -eq 1 ]]; then
  exit 1
fi

# Friendly summary on success.
echo "bug.0344 image-updater-scope check OK:"
echo "  allowlist (${#ALLOWLIST[@]} file(s)): ${ALLOWLIST[*]}"
echo "  scanned $(printf '%s\n' "${all_appsets[@]}" | wc -l | tr -d ' ') *-applicationset.yaml file(s) under infra/k8s/argocd/"
