---
id: proj.agent-workforce
type: project
primary_charter: ENGINEERING
title: Agent Workforce Architecture
state: Active
priority: 0
estimate: 5
summary: "Capability × workflow-shape × domain-activities. New agent = new capability (config) + existing workflow shape. New shape only when trigger/lifecycle materially differs."
outcome: "CEO and Git Reviewer running as LangGraph capabilities on Temporal schedules. Adding an agent = 1 catalog entry + 1 RoleSpec. PR review stays as webhook shape. Sweep agents use scheduled-sweep shape."
assignees:
  - derekg1729
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, workforce, langgraph, temporal]
---

# Agent Workforce Architecture

## Goal

Three axes, independent:

- **Capability** (many) — prompt + tools + output schema → catalog entry
- **Workflow shape** (few) — trigger + lifecycle → reusable Temporal workflow
- **Domain activities** (by integration) — GitHub, work items, Discord → shared

## As-Built Specs

- [Agent Roles](../../docs/spec/agent-roles.md) — Three axes, workflow shapes, RoleSpec binding

## Roadmap

### Crawl (P0) — Two Capabilities, One New Workflow Shape

| Deliverable                                                              | Status      | Est | Work Item |
| ------------------------------------------------------------------------ | ----------- | --- | --------- |
| `systemPrompt` on graph options + CatalogEntry                           | Not Started | 0.5 | task.0211 |
| `createOperatorGraph` factory behind seam                                | Not Started | 0.5 | task.0211 |
| CEO + Git Reviewer catalog entries + prompts                             | Not Started | 1   | task.0211 |
| Operator tools: `work_item_query`, `work_item_transition`                | Not Started | 2   | task.0211 |
| `RoleSpec` type + 2 constants                                            | Not Started | 0.5 | task.0212 |
| `ScheduledSweepWorkflow` + activities (claim, context, outcome, release) | Not Started | 2   | task.0212 |
| Temporal schedules for CEO + Git Reviewer                                | Not Started | 0.5 | task.0212 |

### Walk (P1) — Metrics + More Capabilities

| Deliverable                                            | Status      | Est | Work Item |
| ------------------------------------------------------ | ----------- | --- | --------- |
| Role-level metrics (backlog, SLA, success rate, spend) | Not Started | 2   | (P1)      |
| PM + Data Analyst capabilities (same sweep shape)      | Not Started | 2   | (P1)      |
| Webhook shape for Git Reviewer (complement to sweep)   | Not Started | 2   | (P1)      |

### Run (P2) — Self-Improving

| Deliverable                          | Status      | Est | Work Item |
| ------------------------------------ | ----------- | --- | --------- |
| Outcome logging + prompt improvement | Not Started | 2   | (P2)      |
| Long-running approval workflow shape | Not Started | 2   | (P2)      |

## Constraints

- `CAPABILITY_IS_CONFIG` — adding agent = catalog entry + RoleSpec, never new workflow
- `SHAPES_ARE_FEW` — new workflow shape only when trigger/lifecycle materially differs
- `ACTIVITIES_BY_DOMAIN` — shared by integration (GitHub, work items), not per-agent
- `CLAIM_NOT_READ` — scheduled sweep uses claim()/release()

## Design Notes

**Why not one generic workflow:** PR review (webhook → evaluate → write back) and CEO sweep (cron → claim item → act → release) have different triggers, lifecycles, and side effects. Forcing them into one workflow means every activity does something different per role — a switch statement in disguise.

**Why not per-agent workflows:** Most agents share a shape. CEO, PM, Data Analyst all sweep a queue on a schedule. One `ScheduledSweepWorkflow` handles all of them. `PrReviewWorkflow` handles all webhook-triggered evaluations. New shape is rare (1-2/year).

**How existing PR review fits:** `PrReviewWorkflow` IS the webhook shape. It stays. The new `git-reviewer` capability uses the sweep shape to catch stale PRs that webhooks missed. They're complementary.

## Dependencies

- [x] `@cogni/langgraph-graphs` — catalog + factories
- [x] `@cogni/temporal-workflows` — GraphRunWorkflow, PrReviewWorkflow
- [x] `@cogni/work-items` — claim()/release()
- [x] Temporal infrastructure
