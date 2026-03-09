---
id: task.0052
type: task
title: "Get OpenClaw Grafana access — spend visibility for sandbox agents"
status: done
priority: 0
estimate: 1
summary: "We have zero visibility into OpenClaw LLM spend. Need Grafana dashboard access to monitor OpenRouter/LiteLLM usage in real time — token counts, model selection, cost per call. Without this, we're flying blind on a platform that burned $20 in 30 minutes."
outcome: "Grafana dashboard showing real-time OpenClaw LLM spend — per-model cost, token counts, call frequency. Alert rule for spend rate anomalies."
spec_refs:
  - observability
  - openclaw-sandbox-spec
project: proj.reliability
branch: feat/grafana-health-skill
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-15
labels: [openclaw, grafana, observability, cost, p0]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# task.0052 — Get OpenClaw Grafana access

## Context

On 2026-02-14, the OpenClaw sandbox agent burned $20 in ~30 minutes by sending 85K input tokens per call to claude-opus-4.6. We had zero visibility into this until after hitting the OpenRouter weekly key limit. This is unacceptable.

## Requirements

1. **Grafana dashboard access** for OpenClaw/LiteLLM spend data
   - OpenRouter spend per model per hour
   - Token counts (input/output) per call
   - Cost per call breakdown
   - Call frequency / rate

2. **Alert rules** for spend anomalies
   - Spend rate > $X/hour → alert
   - Input tokens > threshold per call → alert
   - Weekly budget approaching limit → alert

3. **LiteLLM spend logs integration**
   - LiteLLM exposes `/spend/logs` API — query and push to Grafana
   - Or configure LiteLLM to push metrics to Prometheus/Loki

## Validation

- Grafana dashboard shows real-time OpenClaw LLM spend per model
- Alert fires when spend rate exceeds threshold
- Token counts visible per call in dashboard

## Investigation Steps

- [ ] Check current Grafana Cloud access — do we have a LiteLLM datasource?
- [ ] Check LiteLLM config for metrics/Prometheus endpoint
- [ ] Check if OpenRouter has a usage API we can poll
- [ ] Set up dashboard with available data sources
- [ ] Create P0 alert rules for spend rate

## Delivery Notes

**Alternative solution implemented:** Skill-based queries instead of dashboards/alerts.

**What was delivered:**

- ✅ OpenClaw gateway Grafana access via `deployment-health` skill
- ✅ Cost/tokens/errors visibility for governance agents
- ✅ Per-service health metrics (memory, CPU, OOMs)
- ✅ Environment and time window selection (production/preview, 1h/6h/24h)
- ✅ Claude Code `/deployment-health` command wrapper

**Not yet implemented (follow-up work):**

- ❌ Grafana dashboards (governance queries directly instead)
- ❌ Alert rules for spend anomalies (manual monitoring via skill)
- ❌ LiteLLM spend logs integration (using existing Loki/Prometheus data)

Governance agents can now query system health via skill. Dashboards/alerts can be added later if skill queries prove insufficient.

## PR / Links

- Branch: feat/grafana-health-skill
- Related: bug.0037 (gateway proxy billing records $0 cost)
- Related: task.0027 (Alloy infra metrics)
- Related: task.0028 (Grafana P0 alert rules)
- Spec: docs/spec/observability.md
- Spec: docs/spec/openclaw-sandbox-spec.md

## Attribution

-
