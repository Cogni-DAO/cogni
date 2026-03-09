#!/bin/bash
# Grafana Health Queries - Readonly metrics for governance
# Usage: ./queries.sh <command>
# Env vars: DEPLOY_ENV (production|preview, default: production)
#           TIME_WINDOW (1h|6h|24h, default: 1h)
# Commands: cost, tokens, errors, http-errors, log-errors, memory, alerts, incidents, deployments, all

set -euo pipefail

# Load from workspace env (required, no defaults)
: "${GRAFANA_URL:?GRAFANA_URL not set - run /env-update}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set - run /env-update}"
TOKEN="${GRAFANA_SERVICE_ACCOUNT_TOKEN}"
# Strip trailing slash to prevent double-slash in URLs (causes 301 redirect)
GRAFANA_URL="${GRAFANA_URL%/}"

# Environment selection (production or preview)
ENV="${DEPLOY_ENV:-production}"

# Time window for metrics (1h, 6h, 24h)
TIME_WINDOW="${TIME_WINDOW:-1h}"

# Datasource UIDs (stable)
PROM_UID="grafanacloud-prom"
LOKI_UID="grafanacloud-logs"

# Helper: Query Prometheus instant
prom_query() {
  local query="$1"
  curl -s -G "${GRAFANA_URL}/api/datasources/uid/${PROM_UID}/resources/api/v1/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "query=${query}"
}

# Helper: Query Loki instant
loki_query() {
  local query="$1"
  curl -s -G "${GRAFANA_URL}/api/datasources/proxy/uid/${LOKI_UID}/loki/api/v1/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "query=${query}"
}

# Helper: Extract single value
extract_value() {
  jq -r '.data.result[0].value[1] // "0"'
}

# --- Commands ---

cmd_cost() {
  echo -n "LLM Cost (${TIME_WINDOW}): $"
  prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[${TIME_WINDOW}]))" \
    | extract_value | awk '{printf "%.4f", $1}'
  echo ""
}

cmd_tokens() {
  echo -n "Tokens (${TIME_WINDOW}): "
  prom_query "sum(increase(ai_llm_tokens_total{env=\"${ENV}\"}[${TIME_WINDOW}]))" \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""
}

cmd_llm_errors() {
  echo -n "LLM Errors (${TIME_WINDOW}): "
  prom_query "sum(increase(ai_llm_errors_total{env=\"${ENV}\"}[${TIME_WINDOW}]))" \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""
}

# Legacy alias
cmd_errors() {
  cmd_llm_errors
}

cmd_http_errors() {
  echo "HTTP Errors (${TIME_WINDOW}):"

  # 4xx total
  echo -n "  4xx: "
  prom_query "sum(increase(http_requests_total{env=\"${ENV}\", status=\"4xx\"}[${TIME_WINDOW}]))" \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""

  # 4xx breakdown by route (top offenders, skip zeros)
  prom_query "topk(5, sum by (route) (increase(http_requests_total{env=\"${ENV}\", status=\"4xx\"}[${TIME_WINDOW}])))" \
    | jq -r '.data.result[] | select((.value[1] | tonumber) > 0) | "    \(.metric.route): \(.value[1] | tonumber | floor)"'

  # 5xx total
  echo -n "  5xx: "
  prom_query "sum(increase(http_requests_total{env=\"${ENV}\", status=\"5xx\"}[${TIME_WINDOW}]))" \
    | extract_value | awk '{printf "%.0f", $1}'
  echo ""

  # 5xx breakdown by route (top offenders, skip zeros)
  prom_query "topk(5, sum by (route) (increase(http_requests_total{env=\"${ENV}\", status=\"5xx\"}[${TIME_WINDOW}])))" \
    | jq -r '.data.result[] | select((.value[1] | tonumber) > 0) | "    \(.metric.route): \(.value[1] | tonumber | floor)"'

  # Overall error rate
  echo -n "  Error Rate: "
  prom_query "sum(increase(http_requests_total{env=\"${ENV}\", status=~\"4xx|5xx\"}[${TIME_WINDOW}])) / sum(increase(http_requests_total{env=\"${ENV}\"}[${TIME_WINDOW}])) * 100" \
    | extract_value | awk '{printf "%.1f%%", $1}'
  echo ""
}

cmd_log_errors() {
  echo "Log Errors (${TIME_WINDOW}):"
  # Count warn+error logs per service (level is a string label, not numeric)
  loki_query "sum by (service) (count_over_time({app=\"cogni-template\", env=\"${ENV}\"} | json | level=~\"warn|error|fatal\" | __error__=\"\" [${TIME_WINDOW}]))" \
    | jq -r '(.data.result // [])[] | "  \(.metric.service): \(.value[1])"'
}

cmd_memory() {
  echo -n "Memory Pressure: "
  prom_query 'max(container_memory_working_set_bytes{job="cadvisor"} / container_spec_memory_limit_bytes{job="cadvisor"} * 100)' \
    | extract_value | awk '{printf "%.0f%%", $1}'
  echo ""
}

cmd_alerts() {
  echo -n "Alert Rules: "
  curl -s "${GRAFANA_URL}/api/ruler/grafana/api/v1/rules" \
    -H "Authorization: Bearer ${TOKEN}" \
    | jq -r 'if type == "object" then keys | length else 0 end'
}

cmd_incidents() {
  echo -n "Open Incidents: "
  curl -s -X POST "${GRAFANA_URL}/api/plugins/grafana-irm-app/resources/api/v1/IncidentsService.QueryIncidents" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{"limit":100}' \
    | jq -r '(.incidents // []) | map(select(.status == "active")) | length'
}

cmd_deployments() {
  echo "Recent Deployments (24h):"
  FROM=$(($(date -u +%s) - 86400))000
  TO=$(date -u +%s)000
  curl -s "${GRAFANA_URL}/api/annotations?limit=5&from=${FROM}&to=${TO}" \
    -H "Authorization: Bearer ${TOKEN}" \
    | jq -r '.[] | "  [\(.time/1000|strftime("%m-%d %H:%M"))] \(.text // "N/A")"'
}

cmd_services() {
  echo "Services:"
  # Use Loki label values API — always available, always per-service
  local result
  result=$(curl -s -G "${GRAFANA_URL}/api/datasources/proxy/uid/${LOKI_UID}/loki/api/v1/label/service/values" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "query={app=\"cogni-template\", env=\"${ENV}\"}")
  local count
  count=$(echo "$result" | jq -r '(.data // []) | length')
  if [ "$count" = "0" ]; then
    echo "  (no services found — check Loki ingestion)"
  else
    echo "$result" | jq -r '.data[] | "  ✓ \(.)"'
  fi
}

cmd_service_health() {
  echo "Per-Service Health:"
  # Top services to monitor
  for service in app scheduler-worker openclaw-gateway litellm temporal postgres; do
    echo ""
    echo "${service}:"

    # Memory usage
    local mem_query="container_memory_working_set_bytes{env=\"${ENV}\", service=\"${service}\"} / container_spec_memory_limit_bytes{env=\"${ENV}\", service=\"${service}\"} * 100"
    local mem=$(prom_query "$mem_query" | jq -r '.data.result[0].value[1] // "0"' | awk '{printf "%.0f%%", $1}')

    # CPU (rate over 1m)
    local cpu_query="rate(container_cpu_usage_seconds_total{env=\"${ENV}\", service=\"${service}\"}[1m]) * 100"
    local cpu=$(prom_query "$cpu_query" | jq -r '.data.result[0].value[1] // "0"' | awk '{printf "%.1f%%", $1}')

    # OOM events
    local oom=$(prom_query "container_oom_events_total{env=\"${ENV}\", service=\"${service}\"}" | jq -r '.data.result[0].value[1] // "0"')

    echo "  Memory: ${mem}  CPU: ${cpu}  OOMs: ${oom}"
  done
}

cmd_cost_breakdown() {
  echo "Cost Breakdown (${TIME_WINDOW}):"
  # Cost by provider
  prom_query "sum by (provider) (increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[${TIME_WINDOW}]))" \
    | jq -r '.data.result[] | "  \(.metric.provider): $\(.value[1] | tonumber * 100 | round / 100)"'

  echo ""
  echo "Tokens by Provider:"
  prom_query "sum by (provider) (increase(ai_llm_tokens_total{env=\"${ENV}\"}[${TIME_WINDOW}]))" \
    | jq -r '.data.result[] | "  \(.metric.provider): \(.value[1] | tonumber | floor) tokens"'
}

cmd_all() {
  echo "=== Environment: ${ENV} ==="
  echo ""
  echo "=== Services ==="
  cmd_services
  echo ""
  echo "=== Per-Service Health ==="
  cmd_service_health
  echo ""
  echo "=== Aggregate Metrics ==="
  cmd_cost
  cmd_tokens
  cmd_llm_errors
  echo ""
  echo "=== HTTP Errors ==="
  cmd_http_errors
  echo ""
  echo "=== Log Errors ==="
  cmd_log_errors
  echo ""
  echo "=== Cost Breakdown ==="
  cmd_cost_breakdown
  echo ""
  echo "=== Alerts & Incidents ==="
  cmd_alerts
  cmd_incidents
  echo ""
  cmd_deployments
  echo ""
  echo "Note: Postgres internals, Temporal workflows, and network stats not included (future)"
  echo "Note: Alerts & incidents not configured yet"
}

# Main
CMD="${1:-all}"
case "$CMD" in
  cost) cmd_cost ;;
  tokens) cmd_tokens ;;
  errors) cmd_errors ;;
  llm-errors) cmd_llm_errors ;;
  http-errors) cmd_http_errors ;;
  log-errors) cmd_log_errors ;;
  memory) cmd_memory ;;
  alerts) cmd_alerts ;;
  incidents) cmd_incidents ;;
  deployments) cmd_deployments ;;
  services) cmd_services ;;
  health) cmd_service_health ;;
  breakdown) cmd_cost_breakdown ;;
  all) cmd_all ;;
  *)
    echo "Unknown command: $CMD"
    echo "Available: cost, tokens, errors, llm-errors, http-errors, log-errors, memory, alerts, incidents, deployments, services, health, breakdown, all"
    exit 1
    ;;
esac
