---
id: task.0243
type: task
title: "Work item AI tools + actor eligibility + Operating Review agent"
status: needs_merge
priority: 0
rank: 1
estimate: 3
summary: "Add core__work_item_query + core__work_item_transition tools backed by WorkItemCapability. Add actor eligibility field (human|ai|either) for routing. Rename CEO Operator → Operating Review with 12h planner prompt."
outcome: "AI agents query and triage backlog via typed tools. Actor field gates which items AI can touch. Operating Review produces structured briefs, not worker actions."
spec_refs:
assignees: derekg1729
credit:
project: proj.agentic-project-management
branch: feat/scheduled-sweep-v0
pr: "https://github.com/Cogni-DAO/node-template/pull/676"
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-03-31
labels: [ai-tools, work-items, agents]
external_refs:
---

# Work Item AI Tools + Actor Eligibility + Operating Review

## What Changed

### 1. Work Item Tools (`@cogni/ai-tools`)

- `core__work_item_query` (read_only) — query backlog with filters: status, type, text, actor, project, limit
- `core__work_item_transition` (state_change) — transition status or patch priority/labels/summary
- `WorkItemCapability` interface — bridges tools to `WorkItemQueryPort` + `WorkItemCommandPort`
- Bootstrap wiring: capability factory, tool bindings, container DI

### 2. Actor Eligibility Field (`@cogni/work-items`)

- `ActorKind = "human" | "ai" | "either"` — routing hint for work selection (NOT ownership/provenance)
- Added to `WorkItem` type, `WorkQuery`, frontmatter parsing, adapter matching
- `actor=ai` matches items with `"ai"` or `"either"`. Default: `"either"`.
- Sweep activity always passes `actor=ai` so agents never see human-only items
- Wired through REST API contract, route, facade

### 3. Operating Review Agent (replaces CEO Operator)

- Renamed `ceo-operator` → `operating-review` across graph, catalog, role-spec, UI
- 3-layer prompt: identity + capabilities (with explicit CANNOT list) + methodology
- Schedule: hourly → every 12h
- Output: structured JSON brief (snapshotCounts, triageActions, stuckItems, risks)
- Removed `SCHEDULE_MANAGE` from tool set (planner is read-only on schedules)
- Git Reviewer prompt rewritten to honestly reflect no GitHub API access

## Validation

```bash
pnpm check:fast  # typecheck + lint + tests
pnpm check       # full static checks (1 pre-existing MCP timeout, unrelated)
```
