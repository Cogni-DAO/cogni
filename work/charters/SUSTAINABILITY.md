---
id: chr.sustainability
type: charter
title: "SUSTAINABILITY Charter"
state: Active
summary: SUSTAINABILITY governance charter scaffold for budget signal and recommendation loops.
created: 2026-02-15
updated: 2026-02-15
---

# SUSTAINABILITY Charter

## Goal

Align incentives, monitoring, and workflows to build sustained syntropy and symbiosis with the living world around it. Reduce sprawl, entropy, and inefficient consumption.
Cogni is a self-governing deployed application. This project must remain durable and reliable over time.
Increase KPI awareness of yourself and all things involved in keeping you running.

## Projects

### Core mission / priorities

| Priority | Target                                                                                     | Score (0-5) | Status      | Notes |
| -------- | ------------------------------------------------------------------------------------------ | ----------- | ----------- | ----- |
| P0       | Cogni has full observability over Cogni: it's codebase, deployment, community, impact, etc | 0           | Not Started |       |
| P1       | Financial sustainability: budget awareness, cost control, spend monitoring                 | 0           | Not Started |       |
| P2       | Self healing: Autonomous governance loops that empower syntropy without humans.            | 0           | Not Started |       |

### Top projects (max 4)

| Project                        | Why now                                                                         | Score (0-5) | Status      | Notes |
| ------------------------------ | ------------------------------------------------------------------------------- | ----------- | ----------- | ----- |
| `proj.observability-hardening` | Enables full system visibility and KPI feedback loops.                          | 0           | Not Started |       |
| `proj.ai-operator-wallet`      | Agent wallet for autonomous spending + budget tracking (P0: OpenRouter credits) | 0           | Not Started |       |
| `proj.governance-agents`       | Foundation for autonomous governance loops.                                     | 0           | Not Started |       |
| `proj.reliability`             | Keeps the system operational over long time horizons.                           | 0           | Not Started |       |

## Constraints

- Execution 100% dependent on one human (Derek)
- Agent has no access to observability data yet
- Agent has no access to community channels yet
- Agent cannot autonomously trigger deployments or restarts

### Skills / resources

| Resource               | Use                              | Where                                | /skill | Notes                                 |
| ---------------------- | -------------------------------- | ------------------------------------ | ------ | ------------------------------------- |
| Deployment health      | System health, cost, per-service | `.openclaw/skills/deployment-health` | ✓      | v0 Grafana MVP - data not trustworthy |
| Scheduler + Temporal   | Governance loop execution        | `services/scheduler-worker/`         |        | Runtime exists; no agent hook         |
| OpenClaw gateway       | AI agent runtime + channels      | `services/openclaw-gateway/`         |        | Not wired to agent yet                |
| Work items system      | Issue/task tracking              | `work/` directory                    |        | Read-only; no write access            |
| Database observability | Usage metrics, billing data      | PostgreSQL tables                    |        | No query access yet                   |
