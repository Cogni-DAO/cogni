---
description: "Deployment health via Grafana metrics and alerts"
user-invocable: false
---

# Deployment Health Check

Readonly health monitoring for governance agents. Queries production metrics and alerts.

**⚠️ v0 MVP:** Data may not be complete or trustworthy. Use for directional signals, not absolute truth.

## Goal

Provide governance agents with high-signal system health data:

- LLM cost and token consumption
- Error rates and alert status
- Container health and resource pressure
- Recent deployment annotations

## Prerequisites

**Required environment variables** (must be set in OpenClaw container):

- `GRAFANA_URL` - Grafana Cloud instance URL
- `GRAFANA_SERVICE_ACCOUNT_TOKEN` - Readonly service account token (Viewer role)

If not set, run `/env-update` to propagate from .env.local to OpenClaw gateway.

## Available Commands

Run `./queries.sh <command>` from this directory:

### Service Overview

- **services** - List all running services
- **health** - Per-service health dashboard (memory, CPU, OOMs)
- **all** - Full health report (services + metrics + alerts)

### Aggregate Metrics

- **cost** - LLM spend in last hour (USD)
- **tokens** - Total tokens consumed (last hour)
- **errors** - LLM error count (last hour, alias for llm-errors)
- **llm-errors** - LLM-specific error count (last hour)
- **breakdown** - Cost/tokens by provider

### Error Visibility

- **http-errors** - HTTP 4xx/5xx errors by route with error rate
- **log-errors** - Warn/error log counts by service (from Loki)

### Alerts & Incidents

- **alerts** - Active alert rules status
- **incidents** - Open incidents count
- **deployments** - Recent annotations (last 24h)

### Legacy (Single Metrics)

- **memory** - Aggregate container memory pressure (%)

## Usage Pattern

```bash
# Production, last 1h (defaults)
./queries.sh all

# Preview environment
DEPLOY_ENV=preview ./queries.sh all

# Last 24 hours
TIME_WINDOW=24h ./queries.sh all

# Preview + 6h window
DEPLOY_ENV=preview TIME_WINDOW=6h ./queries.sh cost
```

## Output Format

Concise per-service dashboard:

```
=== Services ===
  ✓ app
  ✓ scheduler-worker
  ✓ openclaw-gateway
  ...

=== Per-Service Health ===
app:
  Memory: 45%  CPU: 12%  OOMs: 0
scheduler-worker:
  Memory: 23%  CPU: 5%  OOMs: 0
...

=== Aggregate Metrics ===
LLM Cost (1h): $0.05
Tokens (1h): 12450
LLM Errors (1h): 0

=== HTTP Errors ===
HTTP Errors (1h):
  4xx: 24
    graphs.run.internal: 20
    ai.chat: 4
  5xx: 0
  Error Rate: 8.2%

=== Log Errors ===
Log Errors (1h):
  scheduler-worker: 20
  app: 4

=== Cost Breakdown ===
  OpenRouter: $0.045

Tokens by Provider:
  OpenRouter: 11200 tokens

Note: Postgres internals, Temporal workflows, and network stats not included (future)
Note: Alerts & incidents not configured yet
```

## Usage Guidance

**When to use:**

- SUSTAINABILITY governance runs (budget/cost monitoring)
- ENGINEERING governance runs (system health checks)
- Incident investigations (which service is affected?)

**How to interpret:**

- Memory >80% = concerning, may cause OOMs
- OOM events >0 = critical, service was killed
- Cost spikes = investigate model usage
- Empty services list = metric collection failure
- HTTP 4xx on internal routes = config issue (model, grant, input validation)
- HTTP 5xx > 0 = service error, investigate immediately
- HTTP error rate > 5% = concerning, check route breakdown
- Log errors in scheduler-worker = likely governance run failures

**v0 Known Issues:**

- Provider label shows "litellm" instead of actual provider (OpenRouter, etc.)
- Alerts & incidents not configured yet
- Some services may not report metrics (transient containers)

## Design Constraints

- **Readonly only** - Viewer role, no mutations
- **Low context** - Results <500 chars per query
- **High signal** - Metrics over logs
- **Fast** - <2s per query, <10s for all
