---
id: proj.agent-workforce
type: project
primary_charter: ENGINEERING
title: Agent Workforce — LangGraph Roles on Temporal Schedules
state: Active
priority: 0
estimate: 5
summary: "Multi-role agent workforce using configurable LangGraph graphs, one reusable Temporal workflow, and WorkItemPort queue filtering — replacing the OpenClaw-based mission-control operator loop"
outcome: "Multiple AI agents run on independent Temporal schedules, each a LangGraph catalog entry with its own system prompt, tool set, and queue filter. CEO triages all work. Git Reviewer drives PRs to merge. Adding a role = adding a catalog entry, not writing code."
assignees:
  - derekg1729
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, workforce, langgraph, temporal]
---

# Agent Workforce — LangGraph Roles on Temporal Schedules

## Goal

Replace the OpenClaw-based mission-control operator loop with LangGraph graphs running on Temporal schedules. Each role is a catalog entry (system prompt + tools + queue filter). One reusable `RoleHeartbeatWorkflow` orchestrates all roles.

## Context

### What exists and works

- **5 LangGraph graphs** in `LANGGRAPH_CATALOG` — all using `createReactAgent`
- **GraphRunWorkflow** — generic Temporal orchestration for any graph
- **PrReviewWorkflow** — proven pattern: gather context → run graph → act on result
- **GraphExecutorPort** — fully decorated (billing, observability, credit checks)
- **WorkItemQueryPort** — typed work queue with filtering
- **Temporal schedules** — governance heartbeat already fires hourly

### What's broken

- Mission-control is a shell-script CLI (`mc-controller.ts` + `mc-status.sh`) invoked by OpenClaw
- One agent, one global queue, no role specialization
- PR #562 sat 2 weeks — no agent owns PR lifecycle
- System prompts hardcoded per graph factory — can't create roles without new factory files

## As-Built Specs

- [Agent Roles](../../docs/spec/agent-roles.md) — Full design: parameterized graphs, reusable workflow, catalog-as-registry

## Roadmap

### Crawl (P0) — Two Roles on LangGraph + Temporal

**Goal:** CEO Operator and Git Reviewer running as LangGraph graphs on Temporal schedules.

| Deliverable                                                                 | Status      | Est | Work Item |
| --------------------------------------------------------------------------- | ----------- | --- | --------- |
| Add `systemPrompt` to `CreateReactAgentGraphOptions` + `CatalogEntry`       | Not Started | 0.5 | task.0207 |
| Create `createOperatorGraph` generic factory                                | Not Started | 0.5 | task.0207 |
| CEO Operator catalog entry + system prompt                                  | Not Started | 1   | task.0207 |
| Git Reviewer catalog entry + system prompt                                  | Not Started | 1   | task.0207 |
| Operator tools: `work_item_query`, `work_item_transition`, `discord_post`   | Not Started | 2   | task.0207 |
| `RoleHeartbeatWorkflow` + activities (pick, build context, process outcome) | Not Started | 2   | task.0208 |
| Wire `HEARTBEAT` schedule to `RoleHeartbeatWorkflow`                        | Not Started | 1   | task.0208 |
| Add `PR_LIFECYCLE` schedule to repo-spec.yaml                               | Not Started | 0.5 | task.0208 |

### Walk (P1) — Feedback Loop + More Roles + Dashboard

**Goal:** Outcome logging, PM/Analyst roles, webhook triggers, dashboard.

| Deliverable                                                           | Status      | Est | Work Item            |
| --------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Outcome logging per role dispatch                                     | Not Started | 1   | (create at P1 start) |
| PM Triage role (catalog entry + prompt + `needs_triage` filter)       | Not Started | 1   | (create at P1 start) |
| Data Analyst role (catalog entry + prompt + metrics labels filter)    | Not Started | 1   | (create at P1 start) |
| Webhook trigger for Git Reviewer (GitHub PR events → Temporal signal) | Not Started | 2   | (create at P1 start) |
| Dashboard API: role snapshots from workflow results                   | Not Started | 2   | (create at P1 start) |
| Prompt versioning and A/B testing                                     | Not Started | 2   | (create at P1 start) |

### Run (P2) — Self-Improving + Cross-Role

**Goal:** Prompts improve from feedback. Roles escalate to each other.

| Deliverable                                                          | Status      | Est | Work Item            |
| -------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Self-improving prompts (metaprompt reviews failures, proposes edits) | Not Started | 2   | (create at P2 start) |
| Cross-role escalation (reviewer → PM → CEO via work item creation)   | Not Started | 2   | (create at P2 start) |
| Role performance dashboard (success rate, time-to-resolution)        | Not Started | 2   | (create at P2 start) |

## Constraints

- `CATALOG_IS_ROLE_REGISTRY` — Adding a role = adding a catalog entry (config, not code)
- `ONE_WORKFLOW_ALL_ROLES` — `RoleHeartbeatWorkflow` is reusable across all roles
- `REUSE_GRAPH_RUN_WORKFLOW` — Delegates to existing `GraphRunWorkflow` via `executeChild`
- `PROMPT_IS_THE_PLAYBOOK` — System prompt IS the role's instructions
- `EXISTING_FACTORIES_UNCHANGED` — Poet, brain, ponderer, research, pr-review keep their hardcoded prompts

## Dependencies

- [x] `@cogni/langgraph-graphs` — graph catalog and factories
- [x] `@cogni/graph-execution-core` — GraphExecutorPort
- [x] `@cogni/temporal-workflows` — GraphRunWorkflow
- [x] `@cogni/work-items` — WorkItemQueryPort
- [x] Temporal infrastructure (deployed)

## Design Notes

**Why not a "Role" type/port:** A role IS a catalog entry + queue filter + schedule. These are configuration, not application state. No CRUD, no port, no adapter.

**Why not per-role workflows:** All roles follow the same loop: pick item → build context → run graph → act on result. One parameterized workflow handles all roles.

**Why keep OpenClaw:** OpenClaw serves Discord-bound conversational agents (poet channel, ideas channel). Operator/governance agents move to LangGraph + Temporal because they need structured output, tool calling, and Temporal's durability guarantees.

**Relationship to task.0162:** task.0162 (mc-controller.ts) is superseded. The controller logic moves into `RoleHeartbeatWorkflow` activities. The typed pieces (signals, policy, snapshots) evolve into workflow input/output types.
