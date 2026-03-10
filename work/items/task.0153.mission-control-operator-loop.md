---
id: task.0153
type: task
title: "Mission Control: operator loop with WIP tracking, work item execution, financial feedback"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "Replace HEARTBEAT → git-sync with a deterministic operator loop that picks the top work item, dispatches lifecycle skills via brain subagent, tracks WIP across runs, reads real LLM cost data, verifies past decisions via external signals, and circuit-breaks after 3 failures."
outcome: "Each hourly run: sync branches, read real cost/health metrics, check WIP status from last run, pick highest-priority work item, dispatch the appropriate lifecycle skill (/triage, /design, /implement, etc.), record decision as EDO with verification criteria, and post summary to Discord. The agent knows its burn rate, tracks what it started, and escalates stuck work."
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
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [governance, heartbeat, operator, mission-control]
external_refs:
---

# Mission Control: Operator Loop with WIP Tracking and Work Item Execution

## Context

The HEARTBEAT schedule fires hourly via Temporal and routes to `/git-sync`. The agent has zero situational awareness, zero prioritization, and does no actual work. It is observe-and-forget: it cannot tell you what it was working on, whether its last action landed, how much money it has spent, or whether any of its past decisions produced results.

**What already exists but is disconnected:**

| Piece                                                           | Where                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Health metrics (cost, tokens, errors, services, memory, alerts) | `.openclaw/skills/deployment-health/queries.sh`                                   |
| Decision contract (focus/action/no-op with expected outcome)    | `.openclaw/skills/gov-core/SKILL.md`                                              |
| Operator checklist (Orient/Pick/Execute/Maintain/Reflect)       | `gateway-workspace/GOVERN.md`                                                     |
| EDO decision tracking with outcome checks                       | `gateway-workspace/memory/EDO/`                                                   |
| Budget gate                                                     | `gateway-workspace/memory/_budget_header.md`                                      |
| Git sync                                                        | `.openclaw/skills/git-sync/`                                                      |
| Brain delegation model (researcher + brain)                     | `gateway-workspace/SOUL.md`                                                       |
| Lifecycle skills                                                | `/triage`, `/design`, `/implement`, `/closeout`, `/pull-request`, `/test`, `/bug` |
| Prioritized work item index                                     | `work/items/_index.md` (via `/repo/current/`)                                     |

**What is missing:** routing, WIP memory, financial feedback, outcome verification, circuit breaker, and work item execution. This task wires all existing pieces into a single deterministic loop.

## Design

### Research-Backed Principles

These findings constrain the design:

1. **Budget tracker provides continuous signal** (Google BATS) — the agent MUST see its own cost data, not guess. Without real spend data, agents waste 40% more resources.
2. **Reflection-retrieval** (BabyAGI) — store reflections after each task; retrieve past reflections for similar objectives on next run. Improves task quality measurably.
3. **Plan-and-Execute over ReAct** — separate planning (mission-control) from execution (brain subagent). ReAct exhibits goal drift after dozens of steps.
4. **Hard iteration caps** — `MAX_STEPS` is non-negotiable. Circuit breaker: 3 failures on same task means escalate or skip.
5. **External verification over self-correction** — use tests, type checks, git status, Grafana metrics. LLMs cannot self-correct reasoning without external signals.
6. **Outcome tracking, not activity tracking** — measure downstream impact (did the PR merge? did the error rate drop?), not tasks closed.
7. **Stale reasoning detection** — old reasoning becomes misleading. Use fresh context per run, not accumulated history.

### The Operator Loop (centerpiece)

This is a **deterministic checklist** the agent executes in order. No open-ended reasoning. Each step has bounded output and a clear completion signal.

```
HEARTBEAT trigger arrives
  │
  ▼
/mission-control skill
  │
  ├─ Step 1. SYNC (existing git-sync, ~5s)
  │     Run /git-sync. If it fails, log and continue.
  │
  ├─ Step 2. OBSERVE (~10s, cheap curl calls only)
  │     a. Run queries.sh all → capture health snapshot
  │     b. Run mc-billing.sh → get 24h cost, 7d cost, burn rate
  │     c. Read work/items/_index.md from /repo/current/
  │     d. Truncate each output to ≤500 chars
  │
  ├─ Step 3. CHECK WIP (~5s)
  │     Read WIP.md. For each active entry:
  │       - Check completion signal (git status, PR state, work item status)
  │       - If DONE → move to WIP.md completed section, record reflection
  │       - If STALE (started >3 runs ago, no progress) → increment fail_count
  │       - If fail_count ≥ 3 → CIRCUIT BREAK: post Discord escalation,
  │         mark item as blocked in WIP.md, move on
  │
  ├─ Step 4. CHECK PAST DECISIONS (~5s)
  │     Read edo_index.md. For each EDO with by_date ≤ now:
  │       - Query the verification_method (metric query, git status, etc.)
  │       - Record verdict: confirmed | failed | inconclusive
  │       - Write verdict back to EDO file
  │
  ├─ Step 5. UPDATE BUDGET (~2s)
  │     Read _budget_header.md. Update with REAL data from mc-billing.sh:
  │       - period_spend_usd (from 24h cost)
  │       - burn_rate_usd_per_day (from 7d cost / 7)
  │       - estimated_runway_days
  │     If over budget → set CAN_DISPATCH=false
  │
  ├─ Step 6. PICK WORK ITEM (exactly 1)
  │     If CAN_DISPATCH=false → skip to Step 8 with reason "over_budget"
  │     If WIP has an active non-blocked item → continue that item
  │     Otherwise: read _index.md, pick top-priority item by:
  │       active_alerts > needs_implement > needs_design > needs_triage
  │     Write selection to WIP.md with start_time and expected_signal
  │
  ├─ Step 7. DISPATCH (the expensive part — brain subagent)
  │     Determine lifecycle stage from work item status:
  │       needs_triage    → /triage
  │       needs_design    → /design
  │       needs_implement → /implement
  │       needs_test      → /test
  │       needs_review    → /pull-request
  │       needs_closeout  → /closeout
  │       active alert    → /bug (create work item first)
  │     Delegate to brain subagent with:
  │       - work item path
  │       - lifecycle skill to run
  │       - max_tokens budget (from remaining budget)
  │       - expected completion signal
  │     Record dispatch in WIP.md
  │
  ├─ Step 8. RECORD
  │     a. Write EDO file (if action taken) with:
  │        - decision, evidence_refs, expected_outcome
  │        - verification_method (specific query or check)
  │        - by_date (next run time)
  │     b. Update edo_index.md
  │     c. Write reflection to WIP.md completed section (if any item finished)
  │
  └─ Step 9. REPORT → Discord governance channel
        One message, three lines:
          Health: <nominal|degraded|critical> | Cost: $X.XX/24h ($X.XX/7d)
          Action: <dispatched /skill on task.XXXX> | <no-op: reason>
          EDO checks: N confirmed, N failed, N inconclusive
```

### WIP.md Format

Persisted at `gateway-workspace/memory/mission-control/WIP.md`. This is the agent's working memory across runs.

```markdown
# Work In Progress

## Active

- item: task.0142
  skill: /implement
  started: 2026-03-10T12:00Z
  expected_signal: "PR created on feat/attribution-v2 branch"
  fail_count: 0
  last_checked: 2026-03-10T13:00Z
  last_status: "branch exists, 2 commits since dispatch"

## Blocked (circuit-breaker tripped)

- item: task.0099
  skill: /implement
  started: 2026-03-09T10:00Z
  blocked_at: 2026-03-10T12:00Z
  fail_count: 3
  reason: "Type errors persist after 3 attempts"
  escalation: "Discord message sent 2026-03-10T12:01Z"

## Completed (last 10, for reflection-retrieval)

- item: task.0138
  skill: /design
  started: 2026-03-08T14:00Z
  completed: 2026-03-08T15:00Z
  signal_met: true
  reflection: "Design file accepted on first attempt. Work item had clear requirements."
```

### mc-billing.sh Design

Simple script that extracts cost data from the existing `queries.sh` infrastructure and calculates burn rate.

```bash
#!/usr/bin/env bash
# mc-billing.sh — Extract LLM cost data + calculate burn rate
# Uses same Grafana/Prometheus datasource as queries.sh
# Output: machine-readable key=value pairs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUERIES_SH="${SCRIPT_DIR}/../deployment-health/queries.sh"

# Extract 24h and 7d LLM cost from queries.sh cost query
COST_24H=$("$QUERIES_SH" cost 24h 2>/dev/null | grep -o '[0-9.]*' | head -1)
COST_7D=$("$QUERIES_SH" cost 7d 2>/dev/null | grep -o '[0-9.]*' | head -1)

# Calculate burn rate (7d average)
BURN_RATE=$(echo "scale=4; ${COST_7D:-0} / 7" | bc 2>/dev/null || echo "0")

# Output
echo "cost_24h_usd=${COST_24H:-0}"
echo "cost_7d_usd=${COST_7D:-0}"
echo "burn_rate_usd_per_day=${BURN_RATE}"
echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

Day 1 scope: LLM cost from Prometheus only. Credit balance deferred to task.0083 (governance health endpoint).

### SKILL.md Structure

The skill file at `.openclaw/skills/mission-control/SKILL.md` is a deterministic procedure. It is NOT a thinking prompt. The agent executes steps in order, like git-sync but with more steps.

```markdown
# /mission-control

> Autonomous operator loop. Runs on HEARTBEAT schedule (hourly).

## Procedure

You are executing a deterministic checklist. Do NOT freestyle.
Do NOT reason about what to do — follow these steps in order.

### Step 1: SYNC

Run /git-sync. Log result. Continue regardless of outcome.

### Step 2: OBSERVE

Run these commands and capture output (truncate each to 500 chars):
bash /repo/current/.openclaw/skills/deployment-health/queries.sh all
bash /repo/current/.openclaw/skills/mission-control/mc-billing.sh
cat /repo/current/work/items/\_index.md | head -80

### Step 3: CHECK WIP

Read /workspace/memory/mission-control/WIP.md (create if missing).
For each item in ## Active:

- Check expected_signal using external tools (gh pr list, git log, etc.)
- If signal met → move to ## Completed with reflection
- If not met → increment last_checked timestamp
- If fail_count ≥ 3 → move to ## Blocked, post Discord escalation

### Step 4: CHECK PAST DECISIONS

Read /workspace/memory/EDO/edo_index.md.
For each EDO with by_date ≤ now:

- Run the verification_method listed in the EDO
- Write verdict (confirmed/failed/inconclusive) to the EDO file

### Step 5: UPDATE BUDGET

Read mc-billing.sh output. Update /workspace/memory/\_budget_header.md:

- period_spend_usd = cost_24h_usd
- burn_rate = burn_rate_usd_per_day
- runway = budget_remaining / burn_rate
  If period_spend_usd > daily_budget → set CAN_DISPATCH=false

### Step 6: PICK WORK ITEM

If CAN_DISPATCH=false → skip to Step 8, reason="over_budget"
If WIP ## Active has a non-blocked item → continue it (do NOT start new work)
Otherwise → read \_index.md, pick the top-priority item
Write to WIP.md ## Active with start_time and expected_signal

### Step 7: DISPATCH

Map work item status to lifecycle skill:
needs_triage → /triage | needs_design → /design
needs_implement → /implement | needs_test → /test
needs_review → /pull-request | needs_closeout → /closeout
active alert → /bug
Delegate to brain subagent with: work item path, skill, token budget
Update WIP.md with dispatch details

### Step 8: RECORD

If action taken → write EDO with verification_method and by_date
Update edo_index.md
If any item completed → ensure reflection is in WIP.md

### Step 9: REPORT

Post to Discord governance channel (single message):
Line 1: Health: <status> | Cost: $X.XX/24h ($X.XX/7d)
Line 2: Action: <skill dispatched on item> OR no-op: <reason>
Line 3: EDO checks: N confirmed, N failed, N inconclusive

EXIT. Do not continue processing.

## Constraints

- MAX_STEPS: 9 (this checklist). No additional steps.
- Exactly 1 work item per run. No sprawl.
- Brain subagent handles all writes. Mission-control only reads + dispatches.
  Exception: WIP.md, EDO files, \_budget_header.md are written directly.
- If any step takes >60s, skip it and note in report.
```

### Files

**Create:**

- `.openclaw/skills/mission-control/SKILL.md` — the operator loop procedure (deterministic checklist)
- `.openclaw/skills/mission-control/mc-billing.sh` — cost extraction + burn rate calculation
- `services/sandbox-openclaw/gateway-workspace/memory/mission-control/WIP.md` — persistent WIP tracker
- `services/sandbox-openclaw/gateway-workspace/memory-templates/mission-control.WIP.md` — bootstrap template

**Modify:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — change `HEARTBEAT` routing to `/mission-control`
- `services/sandbox-openclaw/gateway-workspace/HEARTBEAT.md` — update description
- `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — register mission-control skill

**Keep unchanged:**

- `.openclaw/skills/deployment-health/` — queries.sh called by mc-billing.sh and Step 2
- `.openclaw/skills/git-sync/` — called as Step 1
- `.openclaw/skills/gov-core/` — decision contract used by EDO recording
- `services/sandbox-openclaw/gateway-workspace/GOVERN.md` — checklist pattern reused
- `services/sandbox-openclaw/gateway-workspace/memory/EDO/` — used as-is for decision tracking

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes `HEARTBEAT` to `/mission-control`
- [ ] DETERMINISTIC_PROCEDURE: Skill is a numbered checklist (9 steps), not open-ended reasoning
- [ ] WORK_ITEM_EXECUTION: The loop picks a real work item and dispatches a lifecycle skill
- [ ] WIP_TRACKING: WIP.md persists across runs; each run checks previous work status
- [ ] FINANCIAL_FEEDBACK: \_budget_header.md updated with REAL cost data from mc-billing.sh
- [ ] OUTCOME_VERIFICATION: Past EDOs checked via external signals (metrics, git, gh CLI), not self-evaluation
- [ ] CIRCUIT_BREAKER: 3 consecutive failures on same item triggers escalation + blocked status
- [ ] GOV_CORE_CONTRACT: Decision output follows gov-core format (focus/action/no-op with expected outcome)
- [ ] EDO_ON_REAL_DECISIONS: EDO written only when action taken, not on no-op
- [ ] GIT_SYNC_PRESERVED: Git sync runs as Step 1 (not removed)
- [ ] BOUNDED_CONTEXT: Each observation step output truncated to ≤500 chars
- [ ] COST_DISCIPLINE: Observation is cheap (curl/bash). Only Step 7 (brain dispatch) is expensive. Over-budget skips dispatch.
- [ ] ONE_FOCUS: Exactly one work item per run. WIP continuity preferred over starting new work.
- [ ] REFLECTION_STORED: Completed items include a reflection for future retrieval
- [ ] DISCORD_REPORT: Summary posted to governance channel every run

### Action Taxonomy

Ordered by autonomy level:

| Action                                    | How                            | Autonomous?  |
| ----------------------------------------- | ------------------------------ | ------------ |
| Update WIP.md / EDOs / \_budget_header.md | Direct file write              | Yes          |
| Post to Discord                           | `message` tool                 | Yes          |
| Triage work items                         | Brain subagent + /triage       | Yes          |
| Design work items                         | Brain subagent + /design       | Yes          |
| Create/update work items                  | Brain subagent + git commit    | Yes          |
| Escalate to human                         | Discord message + mark blocked | Yes          |
| Implement code / fix bugs                 | Brain subagent + /implement    | **With EDO** |
| Create PRs                                | Brain subagent + /pull-request | **With EDO** |
| Merge PRs                                 | **No** — human review required | No           |

## Validation

- [ ] Deploy with updated SOUL.md, trigger HEARTBEAT manually via gateway diagnostic script
- [ ] Verify queries.sh output and mc-billing.sh output appear in agent reasoning
- [ ] Verify WIP.md is created on first run with correct format
- [ ] Verify second run reads WIP.md and checks status of previous dispatch
- [ ] Verify \_budget_header.md is updated with real cost numbers (not zeros or placeholders)
- [ ] Verify EDO written for action with verification_method and by_date
- [ ] Verify EDO outcome check runs on subsequent run when by_date is reached
- [ ] Verify circuit breaker: mock 3 failures on same item, confirm Discord escalation posted
- [ ] Verify Discord message has all three lines (health, action, EDO checks)
- [ ] Verify git-sync still runs as Step 1
- [ ] Verify over-budget condition skips dispatch (Step 7) and reports reason
- [ ] Run 3 consecutive heartbeats — verify WIP.md carries context and reflection is stored
