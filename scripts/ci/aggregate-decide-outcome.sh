#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Single decision function for aggregate-{preview,production} in
# promote-and-deploy.yml. Walks per-cell artifacts and the upstream job
# results, applies Axiom 19 (every promoted cell must have verified) and
# Axiom 14 (no advance when no cell promoted), emits outcome to
# $GITHUB_OUTPUT.
#
# Required env:
#   ENV                     preview | production
#   CELLS_DIR               merged dir containing promoted-*.txt + verified-*.txt
#   PROMOTE_RESULT          needs.promote-k8s.result
#   VERIFY_RESULT           needs.verify.result
#   VERIFY_DEPLOY_RESULT    needs.verify-deploy.result
#   E2E_RESULT              needs.e2e.result
#
# Optional env:
#   DEPLOY_INFRA_RESULT     preview only; treated as success when unset.
#                           Only failure | cancelled disqualify.
#   STRICT_FAIL             when set, exit 1 if outcome != dispatched.
#                           Used by aggregate-production whose job-level
#                           if: already requires all upstream results
#                           success — a non-dispatched outcome there means
#                           an unverified-but-promoted cell slipped past
#                           and the rollup write must not run.
#   GITHUB_OUTPUT           when set, outcome= is appended.

set -euo pipefail

: "${ENV:?ENV required}"
: "${CELLS_DIR:?CELLS_DIR required}"
: "${PROMOTE_RESULT:?PROMOTE_RESULT required}"
: "${VERIFY_RESULT:?VERIFY_RESULT required}"
: "${VERIFY_DEPLOY_RESULT:?VERIFY_DEPLOY_RESULT required}"
: "${E2E_RESULT:?E2E_RESULT required}"
DEPLOY_INFRA_RESULT="${DEPLOY_INFRA_RESULT:-success}"

any_promoted=false
unverified=()

if [ -d "$CELLS_DIR" ]; then
  shopt -s nullglob
  for f in "$CELLS_DIR"/promoted-*.txt; do
    node=$(basename "$f" .txt | sed 's/^promoted-//')
    if [ "$(cat "$f" 2>/dev/null || true)" = "true" ]; then
      any_promoted=true
      if [ "$(cat "$CELLS_DIR/verified-${node}.txt" 2>/dev/null || true)" != "true" ]; then
        unverified+=("$node")
      fi
    fi
  done
fi

outcome=failed
if [ "$any_promoted" != "true" ]; then
  echo "::error::aggregate-${ENV}: no cell reported promoted=true — refusing to advance"
elif [ ${#unverified[@]} -gt 0 ]; then
  echo "::error::aggregate-${ENV}: cells promoted but did not verify — Axiom 19 contradiction: ${unverified[*]}"
elif [ "$PROMOTE_RESULT" = "success" ] \
  && [ "$VERIFY_RESULT" = "success" ] \
  && [ "$VERIFY_DEPLOY_RESULT" = "success" ] \
  && [ "$E2E_RESULT" = "success" ] \
  && [ "$DEPLOY_INFRA_RESULT" != "failure" ] \
  && [ "$DEPLOY_INFRA_RESULT" != "cancelled" ]; then
  outcome=dispatched
fi

echo "outcome=${outcome}"
echo "promote=${PROMOTE_RESULT} verify=${VERIFY_RESULT} verify-deploy=${VERIFY_DEPLOY_RESULT} e2e=${E2E_RESULT} deploy-infra=${DEPLOY_INFRA_RESULT}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "outcome=${outcome}" >> "$GITHUB_OUTPUT"
fi

if [ -n "${STRICT_FAIL:-}" ] && [ "$outcome" != "dispatched" ]; then
  exit 1
fi
