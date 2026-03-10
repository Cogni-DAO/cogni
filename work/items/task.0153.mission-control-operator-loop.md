---
id: task.0153
type: task
title: "Mission Control: rewrite HEARTBEAT into an autonomous operator loop"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "Replace the git-sync-only HEARTBEAT with a full operator loop: observe (existing queries.sh), orient (delta from STATE.md), decide (gov-core contract), act (delegate to brain), record (EDO + Discord). No new infrastructure — rewire existing skills."
outcome: "The AI agent wakes up hourly, sees system health + work priorities, picks the highest-impact action, does it (or escalates), records the decision with expected outcome, and checks past decisions for effectiveness."
spec_refs:
  - ai-governance-data-spec
  - cogni-brain-spec
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [governance, heartbeat, operator, mission-control]
external_refs:
---

# Mission Control: Rewrite HEARTBEAT into an Autonomous Operator Loop

## Context

The HEARTBEAT schedule fires hourly via Temporal → OpenClaw gateway. Today it routes to `/git-sync`, which merges staging into gov branches and posts to Discord. That's it — the agent has zero situational awareness, zero prioritization, zero action-taking, zero learning.

Meanwhile, **most of the pieces already exist** but are disconnected:

| Piece                                  | Exists?     | Where                                             |
| -------------------------------------- | ----------- | ------------------------------------------------- |
| Health metrics (Prometheus + Loki)     | **Yes**     | `.openclaw/skills/deployment-health/queries.sh`   |
| Decision contract (focus/action/no-op) | **Yes**     | `.openclaw/skills/gov-core/SKILL.md`              |
| Operator checklist (OODA)              | **Yes**     | `gateway-workspace/GOVERN.md`                     |
| EDO decision tracking                  | **Yes**     | `gateway-workspace/memory/EDO/`, `edo_index.md`   |
| Budget gate                            | **Yes**     | `gateway-workspace/memory/_budget_header.md`      |
| Per-charter heartbeat state            | **Yes**     | `gateway-workspace/memory/{CHARTER}/heartbeat.md` |
| Git sync                               | **Yes**     | `.openclaw/skills/git-sync/`                      |
| Work item index                        | **Yes**     | `work/items/_index.md`                            |
| Repo status scan                       | **Yes**     | `.openclaw/skills/repo-status/`                   |
| Brain delegation model                 | **Yes**     | `gateway-workspace/SOUL.md` (researcher + brain)  |
| Credit balance query                   | **No**      | Need `mc-billing.sh` or internal API              |
| Persistent state across runs           | **Partial** | EDO + heartbeat files exist; need STATE.md        |

**The problem is purely routing and orchestration.** HEARTBEAT → git-sync needs to become HEARTBEAT → mission-control (which includes git-sync as step 1 of N).

## Design

### Outcome

The HEARTBEAT agent systematically monitors system health, prioritizes the most important work, takes action on it, tracks effectiveness of past decisions, and improves over time — using almost entirely existing infrastructure.

### Approach

**Solution**: New `mission-control` skill that orchestrates existing skills into an OODA loop. Rewrite SOUL.md routing. Add 1 new script for billing data. Add STATE.md for cross-run memory.

**Reuses**: `deployment-health/queries.sh` (health), `gov-core` (decision contract), `GOVERN.md` (checklist), EDO system (decisions), git-sync (branch maintenance), `work/items/_index.md` (priorities).

**Rejected alternatives**:

- MCP integration — yak-shave to wire into OpenClaw container, CLI scripts already work
- Temporal activities for brief generation — overengineered, the agent IS the brief generator
- New LangGraph graph — the OpenClaw gateway already runs the agent, just needs better instructions
- Full governance data pipeline (signal_events, GovernanceBriefPort) — right architecture, wrong time

### The Operator Loop

```
HEARTBEAT trigger arrives
  │
  ▼
/mission-control skill
  │
  ├─ 1. SYNC: Run git-sync (existing, ~5s)
  │
  ├─ 2. OBSERVE: Run queries.sh all + mc-billing.sh
  │     → System health, LLM costs, errors, services, credit balance
  │
  ├─ 3. ORIENT: Read STATE.md + edo_index.md + _budget_header.md
  │     → What was I doing? What decisions are pending outcome checks?
  │     → Compare current health to last run — what changed?
  │
  ├─ 4. PRIORITIZE: Read work/items/_index.md (via /repo/current/)
  │     → Rank: active alerts > failing runs > needs_merge > needs_implement
  │     → Cap: pick exactly 1 focus (gov-core contract)
  │
  ├─ 5. DECIDE: action or no-op (gov-core output format)
  │     → If action: delegate to brain subagent (writes are sequential)
  │     → If no-op: record reason (no_delta, blocked, wip_full, veto)
  │
  ├─ 6. RECORD:
  │     → Write memory/HEARTBEAT/heartbeat.md (gov-core format)
  │     → If real decision: write EDO file + update edo_index.md
  │     → Check past EDOs for outcome due dates — update verdicts
  │     → Update STATE.md with current priorities + last action
  │
  └─ 7. REPORT: Post to Discord governance channel
        → Health summary (1 line) + action taken (1 line) + EDO check results
```

### Files

**Create:**

- `.openclaw/skills/mission-control/SKILL.md` — the orchestration skill (deterministic procedure)
- `.openclaw/skills/mission-control/mc-billing.sh` — credit balance + burn rate query
- `services/sandbox-openclaw/gateway-workspace/memory/mission-control/STATE.md` — persistent cross-run state
- `services/sandbox-openclaw/gateway-workspace/memory-templates/mission-control.STATE.md` — bootstrap template

**Modify:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — change `HEARTBEAT` → `/mission-control`
- `services/sandbox-openclaw/gateway-workspace/HEARTBEAT.md` — update description
- `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — register mission-control skill

**Keep unchanged:**

- `.openclaw/skills/deployment-health/` — used as-is by mission-control
- `.openclaw/skills/git-sync/` — called as substep
- `.openclaw/skills/gov-core/` — decision contract referenced
- `services/sandbox-openclaw/gateway-workspace/GOVERN.md` — checklist pattern reused
- `services/sandbox-openclaw/gateway-workspace/memory/EDO/` — used as-is

### mc-billing.sh Design

The gateway container is on `internal` network (reaches `app:3000`) and `cogni-edge` (internet). Two data sources:

```bash
# 1. LLM cost from Prometheus (already in queries.sh, extract for reuse)
#    → ai_llm_cost_usd_total last 24h and 7d

# 2. Credit balance from app internal API
#    → Need: new lightweight endpoint OR piggyback on existing
#    → Simplest: curl http://app:3000/api/readyz (confirms app is up)
#      + query Prometheus for billing_invariant_violation_total
#    → Day 1 fallback: report cost data only, note credit balance as "not yet wired"
```

**Day 1 scope**: LLM cost (24h + 7d) + burn rate estimate from Prometheus. Credit balance deferred to task.0083 (governance health endpoint) or task.0090 (system funding UI).

### STATE.md Format

```markdown
# Mission Control State

## Last Run

- timestamp: 2026-03-10T12:00Z
- health: nominal | degraded | critical
- action: <what was done> | no-op (<reason>)
- focus: <what was being worked on>

## Active Priorities (max 3)

1. <highest priority item with reason>
2. <second priority>
3. <third priority>

## Watching

- <metric or condition being monitored, with threshold>

## Effectiveness Log (last 5)

| EDO | Decision | Expected | Actual | Verdict |
| --- | -------- | -------- | ------ | ------- |
```

### SKILL.md Structure

The skill is a **deterministic checklist** (like git-sync), not a thinking prompt. The agent executes steps in order, collects outputs, makes exactly one decision, and records it.

Key constraints from gov-core:

- Exactly one focus per run
- Exactly one decision: `action` or `no-op`
- Cost guard: `max_tokens`, `max_tool_calls`, `escalation_requested`
- Evidence refs required
- Exit immediately after recording

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes `HEARTBEAT` → `/mission-control`
- [ ] DETERMINISTIC_PROCEDURE: Skill is a checklist, not open-ended reasoning
- [ ] GOV_CORE_CONTRACT: Decision output follows gov-core format exactly
- [ ] EDO_ON_REAL_DECISIONS: EDO written only when action taken, not on no-op
- [ ] OUTCOME_CHECKS: Past EDOs with due dates are checked each run
- [ ] GIT_SYNC_PRESERVED: Git sync runs as step 1 (not removed)
- [ ] BOUNDED_CONTEXT: Each observation step has bounded output (<500 chars)
- [ ] COST_DISCIPLINE: Total run stays within budget_header limits
- [ ] ONE_FOCUS: Exactly one priority picked per run (no sprawl)
- [ ] RESEARCHER_DELEGATES_WRITES: Agent reads/observes; brain subagent does writes
- [ ] STATE_PERSISTED: STATE.md updated every run, survives container restart (workspace volume)
- [ ] DISCORD_REPORT: Summary posted to governance channel every run

### Action Taxonomy (what the agent CAN do)

Ordered by autonomy level:

| Action                   | How                                      | Autonomous?  |
| ------------------------ | ---------------------------------------- | ------------ |
| Update STATE.md / EDOs   | Direct file write                        | Yes          |
| Post to Discord          | `message` tool                           | Yes          |
| Create/update work items | Brain subagent + git commit on gov/ideas | Yes          |
| Triage bugs              | Brain subagent + status update           | Yes          |
| Escalate to human        | Discord message + work item creation     | Yes          |
| Write code / fix bugs    | Brain subagent on gov/development        | **With EDO** |
| Create PRs               | Brain subagent + `gh pr create`          | **With EDO** |
| Merge PRs                | **No** — human review required           | No           |

## Validation

- [ ] Deploy with updated SOUL.md, trigger HEARTBEAT manually via gateway diagnostic script
- [ ] Verify queries.sh output appears in agent reasoning
- [ ] Verify STATE.md is written with correct format
- [ ] Verify Discord message posted with health + action summary
- [ ] Verify git-sync still runs as step 1
- [ ] Verify cost stays within budget_header limits (check LiteLLM spend logs)
- [ ] Run 3 consecutive heartbeats — verify STATE.md carries context across runs
