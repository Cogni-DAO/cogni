#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Create or update a Grafana Cloud Postgres datasource for a Cogni node DB.
#
# Required:
#   GRAFANA_URL
#   GRAFANA_SERVICE_ACCOUNT_TOKEN   token with datasource write permission
#   GRAFANA_POSTGRES_HOST           host:port reachable by Grafana Cloud
#   GRAFANA_POSTGRES_PASSWORD       app_readonly password from runtime env
#
# Optional:
#   COGNI_ENV                       candidate-a | preview | production | local
#   COGNI_NODE                      operator | poly | resy
#   GRAFANA_POSTGRES_DATABASE       defaults to cogni_${COGNI_NODE}
#   GRAFANA_POSTGRES_USER           defaults to app_readonly
#   GRAFANA_POSTGRES_SSLMODE        defaults to disable for VM Postgres
#   GRAFANA_POSTGRES_DATASOURCE_UID defaults to cogni-${COGNI_ENV}-${COGNI_NODE}-postgres

set -euo pipefail

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
: "${GRAFANA_POSTGRES_HOST:?GRAFANA_POSTGRES_HOST not set, expected host:port}"
: "${GRAFANA_POSTGRES_PASSWORD:?GRAFANA_POSTGRES_PASSWORD not set}"

COGNI_ENV="${COGNI_ENV:-candidate-a}"
COGNI_NODE="${COGNI_NODE:-poly}"
GRAFANA_POSTGRES_USER="${GRAFANA_POSTGRES_USER:-app_readonly}"
GRAFANA_POSTGRES_DATABASE="${GRAFANA_POSTGRES_DATABASE:-cogni_${COGNI_NODE}}"
GRAFANA_POSTGRES_SSLMODE="${GRAFANA_POSTGRES_SSLMODE:-disable}"
UID_DEFAULT="cogni-${COGNI_ENV}-${COGNI_NODE}-postgres"
GRAFANA_POSTGRES_DATASOURCE_UID="${GRAFANA_POSTGRES_DATASOURCE_UID:-$UID_DEFAULT}"
NAME="Postgres - ${COGNI_ENV} ${COGNI_NODE}"

payload=$(
  jq -n \
    --arg name "$NAME" \
    --arg uid "$GRAFANA_POSTGRES_DATASOURCE_UID" \
    --arg url "$GRAFANA_POSTGRES_HOST" \
    --arg user "$GRAFANA_POSTGRES_USER" \
    --arg database "$GRAFANA_POSTGRES_DATABASE" \
    --arg sslmode "$GRAFANA_POSTGRES_SSLMODE" \
    --arg password "$GRAFANA_POSTGRES_PASSWORD" \
    '{
      name: $name,
      uid: $uid,
      type: "postgres",
      access: "proxy",
      url: $url,
      user: $user,
      jsonData: {
        database: $database,
        sslmode: $sslmode,
        postgresVersion: 1500,
        timescaledb: false
      },
      secureJsonData: {
        password: $password
      }
    }'
)

base="${GRAFANA_URL%/}"
status=$(curl -sS -o /tmp/grafana-postgres-datasource.json -w "%{http_code}" \
  -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
  "${base}/api/datasources/uid/${GRAFANA_POSTGRES_DATASOURCE_UID}")

if [[ "$status" == "200" ]]; then
  curl -fsS -X PUT "${base}/api/datasources/uid/${GRAFANA_POSTGRES_DATASOURCE_UID}" \
    -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
    -H "content-type: application/json" \
    --data "$payload" | jq '{message, datasource: {uid: .datasource.uid, name: .datasource.name, type: .datasource.type}}'
else
  curl -fsS -X POST "${base}/api/datasources" \
    -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
    -H "content-type: application/json" \
    --data "$payload" | jq '{message, datasource: {uid: .datasource.uid, name: .datasource.name, type: .datasource.type}}'
fi
