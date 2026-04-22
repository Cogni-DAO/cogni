#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Ad-hoc Loki reader for Grafana Cloud. No MCP dependency.
# Use when the `grafana` MCP is unavailable (or from CI/one-off shells).
#
# Requires two env vars, typically sourced from a local, gitignored .env file:
#   GRAFANA_URL                      e.g. https://<org>.grafana.net/
#   GRAFANA_SERVICE_ACCOUNT_TOKEN    `glsa_…` token w/ datasource:read + logs:read
#
# Auto-sources (if env vars are missing): $COGNI_ENV_FILE, then
# ./.env.canary and ./.env.local in the current working directory.
#
# Usage:
#   scripts/loki-query.sh '<logql>' [minutes_back=30] [limit=200] [datasource_uid=grafanacloud-logs]
#
# Examples:
#   scripts/loki-query.sh '{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | route="poly.wallet.connect"'
#   scripts/loki-query.sh '{env="candidate-a",service="app"} | json | level="50"' 60 50
#
# Output is the raw Loki JSON response on stdout — pipe through jq or python for parsing.

set -euo pipefail

QUERY="${1:-}"
MIN_BACK="${2:-30}"
LIMIT="${3:-200}"
DS_UID="${4:-grafanacloud-logs}"

if [[ -z "$QUERY" ]]; then
  sed -n '2,25p' "$0" >&2
  exit 2
fi

# Env fallback — source a local .env if the two required vars aren't already set.
if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  for candidate in "${COGNI_ENV_FILE:-}" ./.env.canary ./.env.local; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a; . "$candidate"; set +a
      break
    fi
  done
fi

: "${GRAFANA_URL:?GRAFANA_URL not set (export it or point COGNI_ENV_FILE at an .env with it)}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set (needs glsa_… with logs:read)}"

LOKI_BASE="${GRAFANA_URL%/}/api/datasources/proxy/uid/${DS_UID}/loki/api/v1"
START=$(( ( $(date -u +%s) - MIN_BACK * 60 ) * 1000000000 ))
END=$(date -u +%s)000000000

curl -sS -G "$LOKI_BASE/query_range" \
  -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
  --data-urlencode "query=$QUERY" \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode "limit=$LIMIT" \
  --data-urlencode "direction=backward"
