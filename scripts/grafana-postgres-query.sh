#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Run a read-only SQL query through a Grafana Postgres datasource.
#
# Requires:
#   GRAFANA_URL
#   GRAFANA_SERVICE_ACCOUNT_TOKEN   token with datasource query permission
#
# Usage:
#   scripts/grafana-postgres-query.sh '<select ...>' [datasource_uid]

set -euo pipefail

SQL="${1:-}"
DS_UID="${2:-${GRAFANA_POSTGRES_DATASOURCE_UID:-cogni-candidate-a-poly-postgres}}"

if [[ -z "$SQL" ]]; then
  sed -n '2,18p' "$0" >&2
  exit 2
fi

if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  for candidate in "${COGNI_ENV_FILE:-}" ./.env.cogni ./.env.canary ./.env.local; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a; . "$candidate"; set +a
      break
    fi
  done
fi

: "${GRAFANA_URL:?GRAFANA_URL not set}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set}"

if [[ ! "$SQL" =~ ^[[:space:]]*(select|with|show|explain)[[:space:]] ]]; then
  echo "Refusing non-read query. Start SQL with SELECT, WITH, SHOW, or EXPLAIN." >&2
  exit 2
fi

payload=$(
  jq -n \
    --arg uid "$DS_UID" \
    --arg sql "$SQL" \
    '{
      from: "now-5m",
      to: "now",
      queries: [
        {
          refId: "A",
          datasource: { uid: $uid, type: "postgres" },
          rawSql: $sql,
          format: "table",
          maxDataPoints: 1000,
          intervalMs: 1000
        }
      ]
    }'
)

curl -fsS -X POST "${GRAFANA_URL%/}/api/ds/query" \
  -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
  -H "content-type: application/json" \
  --data "$payload"
