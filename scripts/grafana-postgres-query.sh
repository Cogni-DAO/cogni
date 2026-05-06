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
#   # Positional UID:
#   scripts/grafana-postgres-query.sh '<select ...>' cogni-<env>-<node>-postgres
#
#   # Flag-built UID (uses cogni-<env>-<node>-postgres convention):
#   scripts/grafana-postgres-query.sh '<select ...>' --env candidate-a --node poly
#
#   # Default datasource (env: GRAFANA_POSTGRES_DATASOURCE_UID):
#   GRAFANA_POSTGRES_DATASOURCE_UID=cogni-candidate-a-operator-postgres \
#     scripts/grafana-postgres-query.sh '<select ...>'

set -euo pipefail

SQL="${1:-}"
shift || true

if [[ -z "$SQL" ]]; then
  sed -n '2,21p' "$0" >&2
  exit 2
fi

DS_UID=""
ENV_NAME=""
NODE_NAME=""
while (( $# )); do
  case "$1" in
    --env)  ENV_NAME="${2:-}";  shift 2 ;;
    --node) NODE_NAME="${2:-}"; shift 2 ;;
    --uid)  DS_UID="${2:-}";    shift 2 ;;
    --) shift; break ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  if [[ -z "$DS_UID" ]]; then DS_UID="$1"; shift; else
          echo "extra positional arg: $1" >&2; exit 2
        fi ;;
  esac
done

if [[ -z "$DS_UID" && -n "$ENV_NAME" && -n "$NODE_NAME" ]]; then
  DS_UID="cogni-${ENV_NAME}-${NODE_NAME}-postgres"
fi
DS_UID="${DS_UID:-${GRAFANA_POSTGRES_DATASOURCE_UID:-}}"
if [[ -z "$DS_UID" ]]; then
  echo "datasource UID not set: pass positionally, via --env <env> --node <node>, or set GRAFANA_POSTGRES_DATASOURCE_UID" >&2
  exit 2
fi

if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
  # Source every present file in priority order — any single file may hold only
  # part of the credential set (e.g. .env.cogni has GRAFANA_URL while
  # .env.<env> holds the env-scoped GRAFANA_SERVICE_ACCOUNT_TOKEN).
  for candidate in "${COGNI_ENV_FILE:-}" ./.env.cogni ./.env.canary ./.env.local; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      set -a; . "$candidate"; set +a
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
          datasource: { uid: $uid, type: "grafana-postgresql-datasource" },
          rawSql: $sql,
          format: "table",
          maxDataPoints: 1000,
          intervalMs: 1000
        }
      ]
    }'
)

# -sS (not -fsS) so the JSON error body from Grafana reaches stdout when a
# query fails — callers expect to parse JSON either way and silently swallowed
# errors are debug-hostile.
curl -sS -X POST "${GRAFANA_URL%/}/api/ds/query" \
  -H "Authorization: Bearer ${GRAFANA_SERVICE_ACCOUNT_TOKEN}" \
  -H "content-type: application/json" \
  --data "$payload"
