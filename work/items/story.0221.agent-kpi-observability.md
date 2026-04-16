---
id: story.0221
type: story
title: "Agent KPI Observability — agents measure and optimize against their own KPIs"
status: done
priority: 1
rank: 5
estimate: 0
summary: "Emit KPI-relevant metrics from agent runs to Grafana/Loki. Agents query their own KPI actuals vs targets via Grafana MCP and self-adjust. Not human dashboards — agent-consumable data."
outcome: "Every agent role has measurable KPIs flowing through the observability stack. Agents can query their own performance and identify where they're off-target."
spec_refs: []
assignees: []
credit:
project: proj.governance-agents
branch: feat/agent-kpi-observability
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [observability, agents, kpi, grafana, mission-control]
external_refs:
  - feat/mission-control-clean (agent-roles.md RoleSpec with KPIs)
revision: 0
blocked_by: []
deploy_verified: false
---

## Problem

Cogni's agent roles (CEO Operator, Git Reviewer, future PM, Data Analyst) have defined KPIs in the `RoleSpec` type (see `feat/mission-control-clean:docs/spec/agent-roles.md`):

- `backlog_count` — how many items are waiting
- `avg_item_age_hours` — how stale the backlog is
- `pr_merge_rate` — ratio of reviewed PRs that merge
- `spend_usd` — cost per agent run

But today these KPIs exist only as type definitions. No metrics pipeline emits them, no dashboard aggregates them, and agents have no way to read their own performance.

**An unmeasured agent is an unmanaged agent.** Without KPI data flowing, agents can't self-optimize and humans can't verify agent effectiveness.

## Who Benefits

- **Agents** — can query their own KPI actuals vs targets via Grafana MCP, identify where they're off-target, and adjust behavior (e.g., prioritize older items if `avg_item_age_hours` exceeds target)
- **Operators** — can verify agents are meeting SLAs without manually inspecting run logs
- **The platform** — KPI tracking is the foundation for agent self-improvement (walk/run phase)

## What Success Looks Like

1. **Metrics pipeline**: Agent run outcomes emit structured KPI data to Loki (via Pino JSON) and/or Prometheus (via `/metrics` endpoint). At minimum: run count, success/failure, duration, backlog snapshot, spend.

2. **Agent-queryable dashboards**: Grafana dashboards exist for each agent role showing KPI actuals vs targets. These dashboards are queryable via the Grafana MCP server — agents can call `query_prometheus` or `query_loki_logs` to read their own metrics.

3. **Self-alignment signal**: An agent running a scheduled sweep can check "am I meeting my KPIs?" before deciding what to prioritize. The data path: agent → Grafana MCP → `query_prometheus("backlog_count{role='ceo-operator'}")` → compare to `target: 0` → adjust.

## Existing Infrastructure

| Component                  | Status    | Location                                                           |
| -------------------------- | --------- | ------------------------------------------------------------------ |
| Grafana Cloud              | Prod      | Connected via `GRAFANA_CLOUD_*` env vars                           |
| Local Grafana + Loki       | Dev       | `docker-compose`, `infra/compose/configs/alloy-config.*.alloy`     |
| Alloy collector            | Running   | Scrapes Prometheus + ships logs to Loki                            |
| Pino JSON logging          | Active    | All app logs → stdout → Alloy → Loki                               |
| Prometheus `/metrics`      | Active    | `apps/operator/src/shared/observability/server/metrics.ts`         |
| Grafana MCP server         | Connected | `/mcp` reconnects, `query_prometheus`, `query_loki_logs` available |
| RoleSpec + KPI types       | Defined   | `feat/mission-control-clean:docs/spec/agent-roles.md`              |
| `monitoring-expert` skill  | Installed | `.claude/skills/monitoring-expert/`                                |
| `grafana-dashboards` skill | Installed | `.claude/skills/grafana-dashboards/`                               |

## Requirements

1. Define which KPIs can be derived from existing data (run logs, Temporal workflow metrics, DB queries) vs which need new instrumentation
2. Emit KPI-relevant metrics from agent runs — structured log lines and/or Prometheus counters/gauges
3. Create Grafana dashboards (or dashboard JSON) per agent role with KPI panels
4. Verify agents can query their own KPIs via Grafana MCP
5. Document the KPI → metric → dashboard mapping

## Validation

- [ ] An agent role's KPIs appear in Grafana (local dev)
- [ ] `query_prometheus` via Grafana MCP returns actual KPI values
- [ ] An agent graph (e.g., CEO Operator) can read its own backlog_count and compare to target
- [ ] `pnpm check` passes — no regressions from instrumentation changes

## Open Questions

- Should KPI snapshots be stored in the DB (for historical trending) or are Grafana time-series sufficient?
- How frequently should KPI gauges update? Per-run? Per-minute via a scheduled job?
- Should the agent self-alignment logic live in the graph system prompt, in a tool, or as a pre-execution step?
