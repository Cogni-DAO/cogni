#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO
#
# Create or update a Grafana Cloud Postgres datasource for a Cogni node DB.
#
# Required:
#   GRAFANA_URL
#   GRAFANA_SERVICE_ACCOUNT_TOKEN   token with datasource write permission
#   GRAFANA_POSTGRES_HOST           private/PDC host:port reachable from Grafana
#   GRAFANA_POSTGRES_PASSWORD       app_readonly password from runtime env
#
# Optional:
#   COGNI_ENV                       candidate-a | preview | production | local
#   COGNI_NODE                      operator | poly | resy
#   GRAFANA_POSTGRES_DATABASE       defaults to cogni_${COGNI_NODE}
#   GRAFANA_POSTGRES_USER           defaults to app_readonly
#   GRAFANA_POSTGRES_SSLMODE        defaults to disable for VM Postgres
#   GRAFANA_POSTGRES_DATASOURCE_UID defaults to cogni-${COGNI_ENV}-${COGNI_NODE}-postgres
#   GRAFANA_POSTGRES_ALLOW_PUBLIC_HOST=1 required for public internet hosts
#   GRAFANA_PDC_NETWORK_ID          enables Grafana PDC / secure socks proxy

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

case "$GRAFANA_SERVICE_ACCOUNT_TOKEN" in
  glc_*)
    cat >&2 <<EOF
GRAFANA_SERVICE_ACCOUNT_TOKEN looks like a Grafana Cloud Access Policy token (glc_).

Datasource provisioning uses the Grafana instance HTTP API, which requires a Grafana
service-account token from the stack itself (usually glsa_), with datasource
read/query/create/write permissions.
EOF
    exit 1
    ;;
esac

COGNI_ENV="${COGNI_ENV:-candidate-a}"
COGNI_NODE="${COGNI_NODE:-poly}"
GRAFANA_POSTGRES_USER="${GRAFANA_POSTGRES_USER:-app_readonly}"
GRAFANA_POSTGRES_DATABASE="${GRAFANA_POSTGRES_DATABASE:-cogni_${COGNI_NODE}}"
GRAFANA_POSTGRES_SSLMODE="${GRAFANA_POSTGRES_SSLMODE:-disable}"
UID_DEFAULT="cogni-${COGNI_ENV}-${COGNI_NODE}-postgres"
GRAFANA_POSTGRES_DATASOURCE_UID="${GRAFANA_POSTGRES_DATASOURCE_UID:-$UID_DEFAULT}"
NAME="Postgres - ${COGNI_ENV} ${COGNI_NODE}"

host_only="${GRAFANA_POSTGRES_HOST%%:*}"
if [[ "${GRAFANA_POSTGRES_ALLOW_PUBLIC_HOST:-0}" != "1" ]]; then
  case "$host_only" in
    localhost|127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|postgres|*.internal|*.local)
      ;;
    *)
      cat >&2 <<EOF
Refusing public-looking Postgres host: ${GRAFANA_POSTGRES_HOST}

Use Grafana Cloud Private Data Source Connect (PDC) or another private network path,
then set GRAFANA_POSTGRES_HOST to the internal host:port visible from that agent.
Set GRAFANA_POSTGRES_ALLOW_PUBLIC_HOST=1 only for a deliberate temporary experiment.
EOF
      exit 1
      ;;
  esac
fi

payload=$(
  jq -n \
    --arg name "$NAME" \
    --arg uid "$GRAFANA_POSTGRES_DATASOURCE_UID" \
    --arg url "$GRAFANA_POSTGRES_HOST" \
    --arg user "$GRAFANA_POSTGRES_USER" \
    --arg database "$GRAFANA_POSTGRES_DATABASE" \
    --arg sslmode "$GRAFANA_POSTGRES_SSLMODE" \
    --arg password "$GRAFANA_POSTGRES_PASSWORD" \
    --arg pdc_network_id "${GRAFANA_PDC_NETWORK_ID:-}" \
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
    }
    | if $pdc_network_id != "" then
        .jsonData.enableSecureSocksProxy = true
        | .jsonData.secureSocksProxyUsername = $pdc_network_id
      else
        .
      end'
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
