#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Create or fast-forward deploy/<env>-<node> branches from deploy/<env> tips.
# Spec: work/items/task.0372 (BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# shellcheck disable=SC1091
. "$repo_root/scripts/ci/lib/image-tags.sh"

ENVS="${ENVS:-candidate-a,preview,production}"
IFS=',' read -r -a env_list <<<"${ENVS// /}"

git fetch origin '+refs/heads/deploy/*:refs/remotes/origin/deploy/*' --prune --quiet

remote_url=$(git remote get-url origin)
echo "→ Bootstrap target: ${remote_url}"
echo "→ Envs: ${env_list[*]}"

push_args=()
log_lines=()
diverged=0

for env in "${env_list[@]}"; do
  whole_slot_ref="refs/remotes/origin/deploy/${env}"
  if ! git rev-parse --verify --quiet "$whole_slot_ref" >/dev/null; then
    echo "::error::Whole-slot branch deploy/${env} missing on origin"
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
      if git merge-base --is-ancestor "$per_node_sha" "$whole_slot_sha"; then
        log_lines+=("ff        ${per_node_branch} ${per_node_sha:0:8} → ${whole_slot_sha:0:8}")
        push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
      elif git merge-base --is-ancestor "$whole_slot_sha" "$per_node_sha"; then
        log_lines+=("ahead     ${per_node_branch} = ${per_node_sha:0:8} (whole-slot at ${whole_slot_sha:0:8})")
      else
        log_lines+=("DIVERGED  ${per_node_branch} ${per_node_sha:0:8} ⊥ ${whole_slot_sha:0:8}")
        diverged=$((diverged + 1))
      fi
    else
      log_lines+=("create    ${per_node_branch} @ ${whole_slot_sha:0:8}")
      push_args+=("${whole_slot_sha}:refs/heads/${per_node_branch}")
    fi
  done
done

printf '%s\n' "${log_lines[@]}"

if [ "$diverged" -gt 0 ]; then
  echo "::error::${diverged} per-node branch(es) diverged. Set BOOTSTRAP_ALLOW_DIVERGENCE=1 to proceed (post-cutover divergence is expected)."
  if [ "${BOOTSTRAP_ALLOW_DIVERGENCE:-0}" != "1" ]; then
    exit 2
  fi
  echo "::warning::BOOTSTRAP_ALLOW_DIVERGENCE=1 — proceeding"
fi

if [ "${#push_args[@]}" -eq 0 ]; then
  echo "✓ Up to date — nothing to push."
  exit 0
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — would atomic-push:"
  printf '  %s\n' "${push_args[@]}"
  exit 0
fi

echo "→ Atomic-pushing ${#push_args[@]} ref(s)..."
git push --atomic origin "${push_args[@]}"
echo "✓ Done."
