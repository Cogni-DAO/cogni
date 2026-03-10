---
id: task.0153
type: task
title: "Mission Control: operator loop with WIP tracking, work item execution, financial feedback"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "Replace HEARTBEAT → git-sync with a structured operator loop that picks the top work item, dispatches lifecycle skills via brain subagent, tracks WIP across runs, reads real LLM cost + credit + treasury data, calculates runway, verifies past decisions via external signals, and circuit-breaks after 3 failures."
outcome: "Each hourly run: sync branches, read real cost/health/treasury metrics, calculate runway with color indicator (🟢/🟡/🔴), check WIP status from last run, pick highest-priority work item (finish before starting), dispatch the appropriate lifecycle skill per development-lifecycle spec, record decision as EDO with verification criteria, and post summary with runway to Discord. The agent knows its burn rate, credit balance, treasury balance, and tracks what it started."
spec_refs:
  - ai-governance-data-spec
  - cogni-brain-spec
  - governance-visibility-dashboard
  - development-lifecycle
  - billing-evolution-spec
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control
pr:
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-11
labels: [governance, heartbeat, operator, mission-control]
external_refs:
  - docs/research/autonomous-agent-operator-loops.md
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

**What is missing:** routing, WIP memory, financial feedback (including treasury/credit runway — see [governance-visibility-dashboard research](../../docs/research/governance-visibility-dashboard.md)), outcome verification, circuit breaker, and work item execution. This task wires all existing pieces into a single deterministic loop.

**Key research input:** The governance-visibility-dashboard research (spike for story.0063) identifies credit balance, burn rate, and runway calculation as critical data sources. The 2026-02-15 incident proved that zero credit balance halts all governance silently. This loop must surface runway data with color coding (🟢/🟡/🔴) so the agent knows when funding is running out.

## Design

### Research-Backed Principles

> Full research: [docs/research/autonomous-agent-operator-loops.md](../../docs/research/autonomous-agent-operator-loops.md)

These findings constrain the design:

1. **Budget tracker provides continuous signal** ([Google BATS](https://arxiv.org/abs/2511.17006)) — inject live budget/runway data into the agent's context BEFORE the pick/dispatch decision. Budget-unaware agents waste 40% more resources. Comparable accuracy with 40% fewer tool calls when budget signal is visible.
2. **Plan-and-Execute over ReAct** ([Plan-and-Act](https://arxiv.org/html/2503.09572v3)) — separate planning (mission-control procedure) from execution (brain subagent). Plan-and-Execute achieves 92% completion vs 85% for ReAct, and recovers from single-step failures by falling back to the master plan.
3. **External verification over self-evaluation** ([Reflexion](https://arxiv.org/abs/2303.11366), [SWE-Agent](https://arxiv.org/abs/2405.15793)) — never ask "did you succeed?" Use tests, git status, PR state, Grafana metrics. Reflexion achieves 91% pass@1 vs 80% baseline by using test results, not self-judgment.
4. **Reflection-retrieval for similar tasks** ([Reflexion](https://nanothoughts.substack.com/p/reflecting-on-reflexion), [BabyAGI](https://babyagi.org/)) — store reflections after each task; retrieve past reflections for SIMILAR objectives on next run. Before dispatching, scan completed work for same-skill reflections and include in brief.
5. **Same-failure circuit breaker** (production patterns) — track `last_failure_reason`, not just `fail_count`. 3 identical failures = stuck (escalate). 3 different failures = progress through failure modes (continue).
6. **Fresh context per run** ([Devin](https://devin.ai/agents101), [SWE-Agent history collapse](https://arxiv.org/abs/2405.15793)) — each run starts fresh. No accumulated conversation history. Only persistent state: WIP.md, EDO index, _budget_header.md. Stale reasoning corrupts decisions.
7. **Single sub-agent at a time** ([Claude Code](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)) — one brain subagent, one work item, one lifecycle skill. No parallel execution. Sequential is safer for autonomous operation.

### The Operator Loop (centerpiece)

A **structured procedure** with three phases: mechanical data gathering (Steps 1-5), agent judgment for work selection and dispatch (Steps 6-7), and mechanical recording/reporting (Steps 8-9). Each step has bounded output and a clear completion signal.

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
  │     b. Run mc-billing.sh all → get cost, credits, treasury, runway
  │     c. Read work/items/_index.md from /repo/current/
  │     d. Truncate each output to ≤500 chars
  │
  ├─ Step 3. CHECK WIP (~5s)
  │     Read WIP.md. For each active entry:
  │       - Check completion signal (git status, PR state, work item status)
  │       - If DONE → move to WIP.md completed section, record reflection
  │       - If STALE (started >3 runs ago, no progress) → record failure reason
  │         - If same last_failure_reason repeating → increment fail_count
  │         - If different failure reason → reset fail_count to 1 (progress through different modes)
  │       - If fail_count ≥ 3 with SAME reason → CIRCUIT BREAK: post Discord
  │         escalation, mark item as blocked in WIP.md, move on
  │
  ├─ Step 4. CHECK PAST DECISIONS (~5s)
  │     Read edo_index.md. For each EDO with by_date ≤ now:
  │       - Query the verification_method (metric query, git status, etc.)
  │       - Record verdict: confirmed | failed | inconclusive
  │       - Write verdict back to EDO file
  │
  ├─ Step 5. UPDATE BUDGET + RUNWAY (~2s)
  │     Read _budget_header.md. Update with REAL data from mc-billing.sh:
  │       - period_spend_usd (from 24h cost)
  │       - burn_rate_usd_per_day (from 7d cost / 7)
  │       - credit_balance_usd (from cmd_credits, if available)
  │       - treasury_usdc (from cmd_treasury, if available)
  │       - runway_days = (credit_balance_usd + treasury_usdc) / burn_rate_usd_per_day
  │       - runway_indicator: 🟢 >30d, 🟡 7-30d, 🔴 <7d
  │     Budget gate (day 1): if credit balance available, use it.
  │       Otherwise, use daily spend proxy: if period_spend_usd > DAILY_BUDGET_USD → CAN_DISPATCH=false
  │       (DAILY_BUDGET_USD is configurable in mc-billing.sh, default $5.00)
  │
  ├─ Step 6. PICK WORK ITEM (exactly 1)
  │     If CAN_DISPATCH=false → skip to Step 8 with reason "over_budget"
  │     If WIP has an active non-blocked item → continue that item
  │     Otherwise: read _index.md, pick top-priority item by:
  │       active_alerts > needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage
  │       (Finish before starting — items closer to done get priority, per development-lifecycle spec)
  │     Write selection to WIP.md with start_time and expected_signal
  │
  ├─ Step 7. DISPATCH (the expensive part — brain subagent)
  │     Determine lifecycle stage from work item status (per development-lifecycle spec):
  │       needs_merge     → /review-implementation  (weight: 6)
  │       needs_closeout  → /closeout               (weight: 5)
  │       needs_implement → /implement              (weight: 4)
  │       needs_design    → /design                 (weight: 3)
  │       needs_research  → /research               (weight: 2)
  │       needs_triage    → /triage                 (weight: 1)
  │       active alert    → /bug (create work item first, then triage)
  │
  │     REFLECTION RETRIEVAL (from Reflexion research):
  │       Before dispatch, scan WIP.md ## Completed for entries with same skill.
  │       If found, include their reflection text in the brain subagent brief.
  │       Example: dispatching /implement → find last 3 /implement reflections.
  │
  │     READ BUDGET before delegating:
  │       Read _budget_header.md. Include runway_days and burn_rate in brief
  │       so brain subagent sees cost context (BATS: budget signal must be visible).
  │
  │     Delegate to brain subagent with:
  │       - work item path
  │       - lifecycle skill to run
  │       - max_tokens budget (from remaining budget)
  │       - expected completion signal
  │       - relevant reflections from past similar work
  │       - current runway/budget summary
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
          <runway_indicator> Health: <nominal|degraded|critical> | Cost: $X.XX/24h ($X.XX/7d) | Runway: Xd
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
  last_failure_reason: ""
  last_checked: 2026-03-10T13:00Z
  last_status: "branch exists, 2 commits since dispatch"

## Blocked (circuit-breaker tripped)

- item: task.0099
  skill: /implement
  started: 2026-03-09T10:00Z
  blocked_at: 2026-03-10T12:00Z
  fail_count: 3
  last_failure_reason: "Type errors in src/services/attribution.ts — same error 3 runs"
  reason: "Same failure repeated 3 times — circuit breaker tripped"
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

Self-contained script that queries Prometheus directly (reuses `prom_query` helper pattern from queries.sh, not shelling out to it). Also queries credit balance from the app and DAO wallet USDC balance from Base mainnet RPC. Calculates runway with color coding per governance-visibility-dashboard research.

```bash
#!/usr/bin/env bash
# mc-billing.sh — Financial health: LLM cost, credit balance, treasury, runway
# Queries Prometheus directly (same pattern as queries.sh prom_query helper)
# Commands: cost | credits | treasury | runway | all
# Output: machine-readable key=value pairs

set -euo pipefail

# --- Config ---
DAILY_BUDGET_USD="${DAILY_BUDGET_USD:-5.00}"
# DAO wallet address (from .cogni/repo-spec.yaml payments_in.credits_topup.receiving_address)
DAO_WALLET="0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6"
# USDC on Base (ERC-20 contract)
USDC_CONTRACT="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
# Base mainnet RPC (public, no API key needed)
BASE_RPC="${BASE_RPC:-https://mainnet.base.org}"
# App internal endpoint (gateway is on internal network)
APP_URL="${APP_URL:-http://app:3000}"
# Credit unit: 1 credit = $0.0000001 USD (CREDITS_PER_USD = 10_000_000)
CREDITS_PER_USD=10000000

# Load Grafana creds (required for Prometheus queries)
: "${GRAFANA_URL:?GRAFANA_URL not set}"
: "${GRAFANA_SERVICE_ACCOUNT_TOKEN:?GRAFANA_SERVICE_ACCOUNT_TOKEN not set}"
TOKEN="${GRAFANA_SERVICE_ACCOUNT_TOKEN}"
GRAFANA_URL="${GRAFANA_URL%/}"
ENV="${DEPLOY_ENV:-production}"
PROM_UID="grafanacloud-prom"

# --- Helpers ---
prom_query() {
  local query="$1"
  curl -s -G "${GRAFANA_URL}/api/datasources/uid/${PROM_UID}/resources/api/v1/query" \
    -H "Authorization: Bearer ${TOKEN}" \
    --data-urlencode "query=${query}"
}

extract_value() {
  jq -r '.data.result[0].value[1] // "0"'
}

# --- Commands ---
cmd_cost() {
  local cost_24h cost_7d burn_rate
  cost_24h=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[24h]))" | extract_value)
  cost_7d=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[7d]))" | extract_value)
  burn_rate=$(echo "scale=4; ${cost_7d:-0} / 7" | bc 2>/dev/null || echo "0")

  echo "cost_24h_usd=${cost_24h:-0}"
  echo "cost_7d_usd=${cost_7d:-0}"
  echo "burn_rate_usd_per_day=${burn_rate}"
  echo "daily_budget_usd=${DAILY_BUDGET_USD}"
  echo "over_budget=$(echo "${cost_24h:-0} > ${DAILY_BUDGET_USD}" | bc -l 2>/dev/null || echo "0")"
  echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

cmd_credits() {
  # Day 1: attempt to read credit balance from app internal API.
  # Known gap: no auth-free internal endpoint exists yet.
  # See task.0083 (governance health endpoint) and task.0090 (system funding).
  local response balance_credits balance_usd
  response=$(curl -s --max-time 5 "${APP_URL}/api/v1/governance/health" 2>/dev/null || echo "")
  if [ -n "$response" ] && echo "$response" | jq -e '.balance' >/dev/null 2>&1; then
    balance_credits=$(echo "$response" | jq -r '.balance // "0"')
    balance_usd=$(echo "scale=2; ${balance_credits} / ${CREDITS_PER_USD}" | bc 2>/dev/null || echo "0")
    echo "credit_balance_credits=${balance_credits}"
    echo "credit_balance_usd=${balance_usd}"
    echo "credit_source=governance-health-api"
  else
    echo "credit_balance_credits=unknown"
    echo "credit_balance_usd=unknown"
    echo "credit_source=unavailable  # Needs task.0083 (governance health endpoint)"
  fi
}

cmd_treasury() {
  # Query DAO wallet USDC balance on Base mainnet via public RPC.
  # Uses eth_call with ERC-20 balanceOf(address).
  # balanceOf selector: 0x70a08231, address padded to 32 bytes
  local padded_addr call_data response raw_balance balance_usdc
  padded_addr=$(echo "${DAO_WALLET}" | sed 's/0x//' | tr '[:upper:]' '[:lower:]')
  padded_addr=$(printf '%064s' "$padded_addr" | tr ' ' '0')
  call_data="0x70a08231${padded_addr}"

  response=$(curl -s --max-time 10 "${BASE_RPC}" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"${USDC_CONTRACT}\",\"data\":\"${call_data}\"},\"latest\"],\"id\":1}" \
    2>/dev/null || echo "")

  if [ -n "$response" ] && echo "$response" | jq -e '.result' >/dev/null 2>&1; then
    raw_balance=$(echo "$response" | jq -r '.result // "0x0"')
    # USDC has 6 decimals
    balance_usdc=$(printf "%d" "$raw_balance" 2>/dev/null || echo "0")
    balance_usdc=$(echo "scale=2; ${balance_usdc} / 1000000" | bc 2>/dev/null || echo "0")
    echo "treasury_usdc=${balance_usdc}"
    echo "treasury_source=base-mainnet-rpc"
    echo "dao_wallet=${DAO_WALLET}"
  else
    echo "treasury_usdc=unknown"
    echo "treasury_source=rpc-unavailable"
  fi
}

cmd_runway() {
  # Runway = (credit_balance_usd + treasury_usdc) / burn_rate_usd_per_day
  # Requires cost + credits + treasury data. Color code per governance-visibility-dashboard research.
  local cost_7d burn_rate credit_usd treasury_usd total_funds runway_days indicator

  cost_7d=$(prom_query "sum(increase(ai_llm_cost_usd_total{env=\"${ENV}\"}[7d]))" | extract_value)
  burn_rate=$(echo "scale=4; ${cost_7d:-0} / 7" | bc 2>/dev/null || echo "0")

  # Best-effort credit balance
  credit_usd=$(cmd_credits 2>/dev/null | grep 'credit_balance_usd=' | cut -d= -f2)
  [ "$credit_usd" = "unknown" ] && credit_usd="0"

  # Best-effort treasury balance
  treasury_usd=$(cmd_treasury 2>/dev/null | grep 'treasury_usdc=' | cut -d= -f2)
  [ "$treasury_usd" = "unknown" ] && treasury_usd="0"

  total_funds=$(echo "scale=2; ${credit_usd:-0} + ${treasury_usd:-0}" | bc 2>/dev/null || echo "0")

  if [ "$(echo "$burn_rate > 0" | bc -l 2>/dev/null)" = "1" ]; then
    runway_days=$(echo "scale=1; ${total_funds} / ${burn_rate}" | bc 2>/dev/null || echo "0")
  else
    runway_days="infinite"
  fi

  # Color coding: 🟢 >30d, 🟡 7-30d, 🔴 <7d
  if [ "$runway_days" = "infinite" ]; then
    indicator="🟢"
  elif [ "$(echo "$runway_days > 30" | bc -l 2>/dev/null)" = "1" ]; then
    indicator="🟢"
  elif [ "$(echo "$runway_days >= 7" | bc -l 2>/dev/null)" = "1" ]; then
    indicator="🟡"
  else
    indicator="🔴"
  fi

  echo "runway_days=${runway_days}"
  echo "runway_indicator=${indicator}"
  echo "total_funds_usd=${total_funds}"
  echo "burn_rate_usd_per_day=${burn_rate}"
  echo "credit_balance_usd=${credit_usd}"
  echo "treasury_usdc=${treasury_usd}"
}

cmd_all() {
  cmd_cost
  echo "---"
  cmd_credits
  echo "---"
  cmd_treasury
  echo "---"
  cmd_runway
}

# Main
CMD="${1:-all}"
case "$CMD" in
  cost) cmd_cost ;;
  credits) cmd_credits ;;
  treasury) cmd_treasury ;;
  runway) cmd_runway ;;
  all) cmd_all ;;
  *)
    echo "Unknown command: $CMD"
    echo "Available: cost, credits, treasury, runway, all"
    exit 1
    ;;
esac
```

**Day 1 known gaps:**
- **Credit balance**: No auth-free internal endpoint exists yet. `cmd_credits` attempts `GET /api/v1/governance/health` but will return `unknown` until task.0083 (governance health endpoint) is implemented. When credits are unknown, budget gate falls back to daily spend threshold: `cost_24h_usd > DAILY_BUDGET_USD` skips dispatch.
- **Treasury balance**: `cmd_treasury` queries Base mainnet public RPC for DAO wallet USDC balance (address from `.cogni/repo-spec.yaml`). This should work day 1 since the RPC is public and requires no API key.
- **Runway**: When credit balance is unknown, runway is calculated from treasury only. This underestimates but is safe (conservative).

### SKILL.md Structure

The skill file at `.openclaw/skills/mission-control/SKILL.md` is a structured procedure with two phases: a **mechanical phase** (Steps 1-5: bash commands, file reads, no judgment) and a **judgment phase** (Steps 6-7: requires agent reasoning to pick and dispatch work). Step 8-9 are mechanical again.

```markdown
# /mission-control

> Autonomous operator loop. Runs on HEARTBEAT schedule (hourly).

## Phase 1: GATHER (mechanical — bash commands + file reads, no reasoning)

### Step 1: SYNC

Run /git-sync. Log result. Continue regardless of outcome.

### Step 2: OBSERVE

Run these commands and capture output (truncate each to 500 chars):

  bash /repo/current/.openclaw/skills/deployment-health/queries.sh all
  bash /repo/current/.openclaw/skills/mission-control/mc-billing.sh all
  cat /repo/current/work/items/\_index.md | head -80

### Step 3: CHECK WIP

Read /workspace/memory/mission-control/WIP.md (create if missing).
For each item in ## Active:

- Check expected_signal using external tools (gh pr list, git log, etc.)
- If signal met → move to ## Completed with reflection
- If not met → record failure reason in last_failure_reason
  - If SAME reason as last time → increment fail_count
  - If DIFFERENT reason → reset fail_count to 1 (progress through failure modes)
- If fail_count ≥ 3 with same reason → move to ## Blocked, post Discord escalation

### Step 4: CHECK PAST DECISIONS

Read /workspace/memory/EDO/edo_index.md.
For each EDO with by_date ≤ now:

- Run the verification_method listed in the EDO
- Write verdict (confirmed/failed/inconclusive) to the EDO file

### Step 5: UPDATE BUDGET + RUNWAY

From mc-billing.sh output, update /workspace/memory/\_budget_header.md:

- period_spend_usd = cost_24h_usd
- burn_rate = burn_rate_usd_per_day
- credit_balance_usd (from cmd_credits, may be "unknown")
- treasury_usdc (from cmd_treasury)
- runway_days + runway_indicator (🟢/🟡/🔴)

Budget gate decision:
  IF credit_balance_usd is known AND credit_balance_usd ≤ 0 → CAN_DISPATCH=false
  ELSE IF credit_balance_usd is unknown AND cost_24h_usd > daily_budget_usd → CAN_DISPATCH=false
  ELSE → CAN_DISPATCH=true

## Phase 2: DECIDE (requires agent judgment)

### Step 6: PICK WORK ITEM

IF CAN_DISPATCH=false → skip to Step 8, reason="over_budget"
IF WIP ## Active has a non-blocked item → continue it (do NOT start new work)
OTHERWISE → read \_index.md, pick the highest-weight item:

  Priority ordering (finish before starting, per development-lifecycle spec):
    needs_merge     → weight 6 (nearly done, just needs review)
    needs_closeout  → weight 5
    needs_implement → weight 4
    needs_design    → weight 3
    needs_research  → weight 2
    needs_triage    → weight 1
  Within same weight: sort by priority ASC, then rank ASC.

Write selection to WIP.md ## Active with start_time and expected_signal.

### Step 7: DISPATCH

Map work item status to lifecycle skill (per development-lifecycle spec):

  needs_merge     → /review-implementation
  needs_closeout  → /closeout
  needs_implement → /implement
  needs_design    → /design
  needs_research  → /research
  needs_triage    → /triage
  active alert    → /bug (create work item first, then triage)

BEFORE delegating:

1. **Retrieve reflections**: Scan WIP.md ## Completed for entries with the SAME skill.
   Include the last 3 matching reflections in the brain subagent brief.
   (Reflexion research: past experience on similar tasks improves quality.)

2. **Include budget context**: Read /workspace/memory/\_budget_header.md.
   Include runway_days, burn_rate, and runway_indicator in the brief.
   (BATS research: budget signal must be visible to the executor, not just the planner.)

Delegate to brain subagent with: work item path, skill, token budget,
relevant reflections, and budget summary.
Update WIP.md with dispatch details.

## Phase 3: RECORD + REPORT (mechanical)

### Step 8: RECORD

If action taken → write EDO with verification_method and by_date.
Update edo_index.md.
If any item completed → ensure reflection is in WIP.md.

### Step 9: REPORT

Post to Discord governance channel (single message):
Line 1: <runway_indicator> Health: <status> | Cost: $X.XX/24h ($X.XX/7d) | Runway: Xd
Line 2: Action: <skill dispatched on item> OR no-op: <reason>
Line 3: EDO checks: N confirmed, N failed, N inconclusive

EXIT. Do not continue processing.

## Constraints

- MAX_STEPS: 9 (this procedure). No additional steps.
- Exactly 1 work item per run. No sprawl.
- Brain subagent handles all code writes. Mission-control only reads + dispatches.
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
- [ ] STRUCTURED_PROCEDURE: Skill is a 3-phase procedure (gather/decide/record, 9 steps total) — mechanical steps use bash, judgment steps (6-7) use agent reasoning
- [ ] WORK_ITEM_EXECUTION: The loop picks a real work item and dispatches a lifecycle skill
- [ ] WIP_TRACKING: WIP.md persists across runs; each run checks previous work status
- [ ] FINANCIAL_FEEDBACK: \_budget_header.md updated with REAL cost data, credit balance, treasury balance, and runway from mc-billing.sh
- [ ] RUNWAY_VISIBLE: Discord report includes runway_indicator (🟢 >30d, 🟡 7-30d, 🔴 <7d) and runway_days
- [ ] OUTCOME_VERIFICATION: Past EDOs checked via external signals (metrics, git, gh CLI), not self-evaluation
- [ ] CIRCUIT_BREAKER: 3 identical failures (same last_failure_reason) triggers escalation + blocked status. Different failures reset count (progress through failure modes).
- [ ] GOV_CORE_CONTRACT: Decision output follows gov-core format (focus/action/no-op with expected outcome)
- [ ] EDO_ON_REAL_DECISIONS: EDO written only when action taken, not on no-op
- [ ] GIT_SYNC_PRESERVED: Git sync runs as Step 1 (not removed)
- [ ] BOUNDED_CONTEXT: Each observation step output truncated to ≤500 chars
- [ ] COST_DISCIPLINE: Observation is cheap (curl/bash). Only Step 7 (brain dispatch) is expensive. Over-budget skips dispatch.
- [ ] ONE_FOCUS: Exactly one work item per run. WIP continuity preferred over starting new work.
- [ ] REFLECTION_STORED: Completed items include a reflection for future retrieval
- [ ] REFLECTION_RETRIEVED: Before dispatch, scan completed items for same-skill reflections and include in brain brief (Reflexion pattern)
- [ ] BUDGET_SIGNAL_VISIBLE: Brain subagent receives runway + burn rate in its brief, not just pass/fail gate (BATS pattern)
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
