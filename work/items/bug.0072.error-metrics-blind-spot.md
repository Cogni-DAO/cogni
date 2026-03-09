---
id: bug.0072
type: bug
title: "HTTP errors invisible in dashboards — no error rate metrics, agent reports 0 errors during outage"
status: done
priority: 0
estimate: 2
summary: "The deployment health dashboard and AI agent cannot see HTTP 4xx/5xx errors. `http_requests_total` uses status buckets (2xx/4xx/5xx) but no dashboard panel queries them. The scheduler-worker emits zero Prometheus metrics. During the governance 400 outage, the agent reported '0 errors in last hour' while 4 runs failed every 15 minutes."
outcome: "HTTP error rates are visible in deployment health checks. The AI agent can detect and report error spikes across all services."
spec_refs:
  - observability
assignees: derekg1729
credit:
project: proj.reliability
branch: fix/gov-schedules
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [observability, metrics, governance]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# bug.0072 — HTTP errors invisible in dashboards

## Requirements

### Observed

- `http_requests_total` counter exists with labels `route`, `method`, `status` (buckets: 2xx/4xx/5xx)
- No Grafana dashboard panel queries this metric for error rates
- The deployment-health command checks: container health, LLM spend, `ai_llm_errors_total` — but NOT `http_requests_total{status=~"4xx|5xx"}`
- The scheduler-worker service logs errors via Pino but emits no Prometheus metrics
- No Loki alert rules exist for error log patterns
- Result: agent said "0 errors" during a 100% governance failure rate

### Expected

- Deployment health checks should surface HTTP 4xx/5xx error rates by route
- Error spikes should be detectable by the AI agent without manual LogQL queries
- The deployment-health command should include an error rate section

### Impact

- Silent production outages — errors only discoverable via manual log investigation
- AI agent gives false "all clear" during active incidents

## Allowed Changes

- `.claude/commands/deployment-health.md` — add HTTP error rate queries
- Grafana dashboard provisioning (if any) — add error rate panels
- Future: `src/shared/observability/server/metrics.ts` — consider more granular error metrics

## Plan

- [ ] Add HTTP error rate queries to deployment-health command (PromQL for `http_requests_total{status=~"4xx|5xx"}`)
- [ ] Add Loki error log query section (LogQL for `level>=40` across all services)
- [ ] Test by running deployment-health and verifying governance errors appear

## Validation

**Command:**

Run the deployment-health slash command. It should report non-zero error counts when HTTP errors exist.

## Review Checklist

- [ ] **Work Item:** `bug.0072` linked in PR body
- [ ] **Spec:** observability.md invariants upheld
- [ ] **Tests:** manual verification via deployment-health command
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/bug.0071-bug.0072.handoff.md)
- Related: task.0028 (Grafana Cloud P0 alert rules — complementary)
- Related: task.0027 (Alloy infra metrics — done, but didn't cover HTTP errors)

## Attribution

-
