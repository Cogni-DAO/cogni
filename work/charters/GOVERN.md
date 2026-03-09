---
id: chr.govern
type: charter
title: "GOVERN Charter"
state: Active
summary: GOVERN governance charter scaffold for portfolio-balancing heartbeat runs.
created: 2026-02-15
updated: 2026-02-15
---

# GOVERN Charter

## Goal

Accelerate towards the core mission (empowering community-owned DAO AI orgs) through continuous portfolio optimization across all charters.

Drive constant iteration, reflection, and pruning. Balance competing priorities. Maximize velocity while maintaining operator sustainability. Adapt to reality and feedback.

## Projects

### Core mission / priorities

| Priority | Target                                                                               | Charter | Score (0-5) | Status      | Notes |
| -------- | ------------------------------------------------------------------------------------ | ------- | ----------- | ----------- | ----- |
| P0       | Reliability + observability: system health and visibility                            | SUSTAIN | 0           | Not Started |       |
| P1       | Community and messaging: communication channels and engagement                       | COMM    | 0           | Not Started |       |
| P2       | Project management + engineering + introspection workflows: iterate and self-improve | ENG     | 0           | Not Started |       |

### Top projects (max 4)

_Scanned from SUSTAINABILITY, COMMUNITY, and ENGINEERING charters:_

| Project                        | Charter | Why now                                             | Score (0-5) | Status      | Notes                        |
| ------------------------------ | ------- | --------------------------------------------------- | ----------- | ----------- | ---------------------------- |
| `proj.context-optimization`    | SUSTAIN | BLOCKING: GOVERN loops cost $5.50/run → need <$0.50 | 0           | Not Started | In progress but not complete |
| `proj.messenger-channels`      | COMM    | BLOCKING: Zero community reach without channels     | 0           | Not Started | OpenClaw P0                  |
| `proj.observability-hardening` | SUSTAIN | KPIs/tracking needed across all charters            | 0           | Not Started |                              |
| `proj.sourcecred-onchain`      | COMM    | Credit/incentive foundation for community           | 0           | Not Started | Paused; doesn't run          |

## Constraints

- Only 1 human (Derek)
- Lacking clear KPIs and tracking (reliability, finance, project management, etc)
- Limited AI model selection: spend for top models is unsustainably high
- Brand new governance and project management workflows: requires serious introspection, battle-testing, and refinement
- `cogni-git-review` and `cogni-git-admin` (old service prototypes in cogni-dao repo) are offline and must be migrated into this node-template repo

### Skills / resources

| Resource            | Use                                       | Where                     | /skill | Notes                      |
| ------------------- | ----------------------------------------- | ------------------------- | ------ | -------------------------- |
| Charter files       | Scan priorities across all charters       | `work/charters/`          |        | Read-only; no write access |
| Project tracking    | Monitor project status and progress       | `work/projects/`          |        | Read-only; no write access |
| Work items system   | Create and prioritize tasks               | `work/`                   |        | Read-only; no write access |
| Observability stack | Measure actual progress and system health | `services/grafana/`       |        | Not wired to agent yet     |
| Budget/cost data    | Track LLM spend and resource usage        | PostgreSQL billing tables |        | No query access yet        |
