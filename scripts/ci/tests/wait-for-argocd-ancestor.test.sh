#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# scripts/ci/tests/wait-for-argocd-ancestor.test.sh
#
# Regression test for the rev_includes_expected ancestry check in
# wait-for-argocd.sh.
#
# Bug context (run #24925395779): the function previously accepted
# `identical|behind` from GitHub's compare API, but `behind` means
# the head (argo's rev) is behind the base (expected deploy commit) —
# i.e. argo had NOT caught up. The gate green-lit a flight where
# argo's rev was a proper ancestor of the just-pushed deploy commit,
# pods stayed on the old image, verify-buildsha then failed.
#
# This test stubs `curl` so we can drive `rev_includes_expected` with
# every compare-API status value and assert the only acceptable
# outcomes are `identical` and `ahead`.
#
# Run: bash scripts/ci/tests/wait-for-argocd-ancestor.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET="${CI_DIR}/wait-for-argocd.sh"

if [ ! -f "$TARGET" ]; then
  echo "[FAIL] wait-for-argocd.sh missing at ${TARGET}" >&2
  exit 1
fi

# Extract just the rev_includes_expected function (and its cache vars)
# into a sourced harness. We avoid running the full script — it requires
# kubectl/ssh/env that aren't available in unit tests.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

HARNESS="${TMP}/harness.sh"
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  # Pull lines 117..150 of wait-for-argocd.sh — the cache vars + function.
  awk '/^ANCESTRY_CACHE_REV=/{flag=1} flag{print} flag && /^rev_includes_expected\(\)/{infunc=1} infunc && /^}/{flag=0; infunc=0}' "$TARGET"
} > "$HARNESS"

# Stub curl: emit a JSON blob whose `status` is whatever STUB_STATUS says.
STUB_BIN="${TMP}/bin"
mkdir -p "$STUB_BIN"
cat > "${STUB_BIN}/curl" <<'CURL'
#!/usr/bin/env bash
printf '{"status":"%s"}' "${STUB_STATUS:-}"
CURL
chmod +x "${STUB_BIN}/curl"

PASS=0
FAIL=0

assert_rc() {
  # assert_rc <label> <stub-status> <expected-rc>
  local label="$1" status="$2" want="$3"
  local got
  (
    export PATH="${STUB_BIN}:${PATH}"
    export GH_TOKEN=stub
    export GH_REPO=owner/repo
    export STUB_STATUS="$status"
    # shellcheck source=/dev/null
    source "$HARNESS"
    rev_includes_expected aaa bbb
  )
  got=$?
  if [ "$got" = "$want" ]; then
    echo "  ok: ${label} (status=${status} → rc=${got})"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label} (status=${status}) want rc=${want} got rc=${got}" >&2
    FAIL=$((FAIL + 1))
  fi
}

echo "── rev_includes_expected: GitHub compare status → rc"
assert_rc "identical accepted"   identical 0
assert_rc "ahead accepted"       ahead     0
assert_rc "behind REJECTED (bug guard)"   behind   1
assert_rc "diverged rejected"    diverged  1
assert_rc "empty/error rejected" ""        1

# Strict-equality fallback when GH_TOKEN unset (curl not even called).
echo "── rev_includes_expected: strict-equality fallback (no GH_TOKEN)"
(
  GH_TOKEN=""
  GH_REPO=""
  # shellcheck source=/dev/null
  source "$HARNESS"
  rev_includes_expected aaa aaa
)
if [ $? -eq 0 ]; then
  echo "  ok: identical revs accepted without GH_TOKEN"
  PASS=$((PASS + 1))
else
  echo "  FAIL: identical revs should be accepted in strict-equality fallback" >&2
  FAIL=$((FAIL + 1))
fi

(
  GH_TOKEN=""
  GH_REPO=""
  # shellcheck source=/dev/null
  source "$HARNESS"
  rev_includes_expected aaa bbb
)
if [ $? -eq 1 ]; then
  echo "  ok: differing revs rejected without GH_TOKEN"
  PASS=$((PASS + 1))
else
  echo "  FAIL: differing revs should be rejected in strict-equality fallback" >&2
  FAIL=$((FAIL + 1))
fi

echo "── wait-for-argocd-ancestor test summary: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
