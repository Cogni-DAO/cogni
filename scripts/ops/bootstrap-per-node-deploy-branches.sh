#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# bootstrap-per-node-deploy-branches.sh — create + fast-forward per-node deploy branches.
#
# task.0372 + R4-#5 (BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE).
# Iterates infra/catalog/*.yaml (CATALOG_IS_SSOT). For each (env, node) pair:
#   - if origin/deploy/<env>-<node> missing → create at origin/deploy/<env> tip
#   - if behind whole-slot tip → fast-forward
#   - if ahead-or-equal → no-op
# Idempotent. Re-run as the last action immediately before merging task.0372.
#
# ENVS env (CSV, default "candidate-a,preview,production"): which envs to bootstrap.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# shellcheck disable=SC1091
. "$repo_root/scripts/ci/lib/image-tags.sh"

ENVS="${ENVS:-candidate-a,preview,production}"
IFS=',' read -r -a env_list <<<"$ENVS"

git fetch origin --quiet

push_args=()
log_lines=()

for env in "${env_list[@]}"; do
  whole_slot_ref="refs/remotes/origin/deploy/${env}"
  if ! git rev-parse --verify --quiet "$whole_slot_ref" >/dev/null; then
    echo "::error::Whole-slot branch deploy/${env} missing on origin — cannot bootstrap"
    exit 1
  fi
  whole_slot_sha=$(git rev-parse "$whole_slot_ref")

  for node in "${ALL_TARGETS[@]}"; do
    per_node_branch="deploy/${env}-${node}"
    per_node_ref="refs/remotes/origin/${per_node_branch}"

    if git rev-parse --verify --quiet "$per_node_ref" >/dev/null; then
      per_node_sha=$(git rev-parse "$per_node_ref")
      if [ "$per_node_sha" = "$whole_slot_sha" ]; then
        log_lines+=("noop      ${per_node_branch} = ${whole_slot_sha:0:8}")
        continue
      fi
      # Only fast-forward if whole-slot is a descendant of per-node tip.
      if git merge-base --is-ancestor "$per_node_sha" "$whole_slot_sha"; then
        log_lines+=("ff        ${per_node_branch} ${per_node_sha:0:8} → ${whole_slot_sha:0:8}")
        push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
      else
        log_lines+=("ahead     ${per_node_branch} = ${per_node_sha:0:8} (whole-slot at ${whole_slot_sha:0:8}; per-node ahead — leaving alone)")
      fi
    else
      log_lines+=("create    ${per_node_branch} @ ${whole_slot_sha:0:8}")
      push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
    fi
  done
done

printf '%s\n' "${log_lines[@]}"

if [ "${#push_args[@]}" -eq 0 ]; then
  echo "✓ All per-node branches already at whole-slot tip — nothing to push."
  exit 0
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — would push:"
  printf '  %s\n' "${push_args[@]}"
  exit 0
fi

echo "→ Pushing ${#push_args[@]} ref(s) to origin..."
git push origin "${push_args[@]}"
echo "✓ Done."
