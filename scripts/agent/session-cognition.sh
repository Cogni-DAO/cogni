#!/usr/bin/env bash
# Session-start cognition substrate loader — shared by the Claude Code
# (.claude/settings.json) and Codex (.codex/config.toml) SessionStart hooks.
# Pulls the node's kickstart bundle and prints it to stdout; both runtimes inject
# SessionStart stdout into agent context. Non-fatal by design: any failure
# degrades to a one-line self-serve hint so a session never blocks on the network.
#
# URL resolution (no per-node env needed):
#   1. COGNI_COGNITION_URL              — explicit override (e.g. candidate/test)
#   2. this node's own hub, derived from .cogni/repo-spec.yaml `intent.name`
#      (operator → apex cognidao.org; any other slug → <slug>.cognidao.org)
#   3. operator fallback — so a node whose own hub isn't deployed yet still gets
#      the shared Cogni contract instead of nothing.
set -u

OPERATOR_URL="https://cognidao.org/api/v1/cognition"

# node slug from repo-spec intent.name (root .cogni/repo-spec.yaml in any node repo)
node_slug=""
if [ -f .cogni/repo-spec.yaml ]; then
  node_slug="$(awk '
    /^intent:/ { in_intent = 1; next }
    in_intent && /^[^[:space:]]/ { in_intent = 0 }
    in_intent && /^[[:space:]]+name:/ {
      sub(/^[[:space:]]+name:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit
    }
  ' .cogni/repo-spec.yaml 2>/dev/null)"
fi

# operator is the apex (cognidao.org); the operator monorepo's root repo-spec
# carries the repo slug `cogni-template`, which is the same apex node.
case "$node_slug" in
  operator | cogni-template | "") node_url="$OPERATOR_URL" ;;
  *) node_url="https://${node_slug}.cognidao.org/api/v1/cognition" ;;
esac

URL="${COGNI_COGNITION_URL:-$node_url}"

# Pass the agent key as a bearer when present; without it, auth-gated cognition
# requests 401 and fall through to the self-serve hint below.
fetch() {
  if [ -n "${COGNI_API_KEY:-}" ]; then
    curl -fsS --max-time 6 -H "Authorization: Bearer ${COGNI_API_KEY}" "$1" 2>/dev/null | jq -r '.markdown // empty' 2>/dev/null
  else
    curl -fsS --max-time 6 "$1" 2>/dev/null | jq -r '.markdown // empty' 2>/dev/null
  fi
}

bundle="$(fetch "$URL")"

# Pre-deploy node: its own hub isn't live yet — fall back to the operator's.
if [ -z "$bundle" ] && [ "$URL" != "$OPERATOR_URL" ]; then
  bundle="$(fetch "$OPERATOR_URL")"
  [ -n "$bundle" ] && URL="$OPERATOR_URL"
fi

if [ -n "$bundle" ]; then
  printf '%s\n' "$bundle"
else
  printf '(cognition substrate unreachable at %s — self-serve: curl -fsS "%s" | jq -r .markdown)\n' "$URL" "$URL"
fi
