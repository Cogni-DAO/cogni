---
id: research.dev-pipeline-dispatch-audit
type: research
title: "Development Pipeline Dispatch Audit"
status: draft
spec_state: proposed
trust: reviewed
summary: "Chain-by-chain audit of the work item dispatch pipeline: what exists, what's wired, what's broken"
read_when: "Wiring agent dispatch, scheduling sweep workflows, or debugging why agents aren't picking up work"
implements: proj.development-workflows
owner: derekg1729
created: 2026-04-08
verified: 2026-04-08
tags: [dispatch, temporal, agents, work-items]
---

# Development Pipeline Dispatch Audit

> Traced 2026-04-08. Every link in the chain from "work item exists" to "agent acts on it."

## Context

The development lifecycle defines 9 statuses, each mapping to one `/command`. The dispatch infrastructure (Temporal workflows, role specs, sweep activities) exists. But agents aren't doing anything. This audit traces why.

## Goal

Map every link in the dispatch chain as EXISTS / WIRED / BROKEN / MISSING. Identify the minimum set of changes to get agents autonomously driving work items.

## Non-Goals

- Designing the long-term WorkItemLifecycleWorkflow (see DEV_PIPELINE.md charter)
- Fixing all issues — just diagnosing them

## Core Invariants

- AUDIT_ONLY: This doc describes as-built state, not aspirational design
- TRACE_COMPLETE: Every link from config → schedule → workflow → activity → API → graph → tool is covered

## Design

### Lifecycle Status Flow

```
  /idea or /bug
       │
       ▼
┌──────────────┐
│ needs_triage │  🟢 /triage skill works. AI routes item.
└──────┬───────┘
       ▼
┌──────────────┐
│needs_research│  🟢 /research skill works.
└──────┬───────┘
       ▼
┌──────────────┐
│ needs_design │  🟢 /design skill works.
└──────┬───────┘
       ▼
┌──────────────┐
│needs_implement│ 🟡 /implement works manually.
└──────┬───────┘     No agent picks this up automatically.
       ▼
┌──────────────┐
│needs_closeout│  🟢 /closeout works.
└──────┬───────┘
       ▼
┌──────────────┐
│ needs_merge  │  🔴 git-reviewer graph has ONE tool:
└──────┬───────┘     GET_CURRENT_TIME. Can't review.
       ▼             Can't transition. Dead on arrival.
┌──────────────┐
│    done      │  🟡 CI runs ✓. Auto-deploy ✓.
└──────────────┘     No post-deploy verify. No feedback.
```

### Dispatch Chain Audit

```
LINK 1: CONFIG
══════════════════════════════════════════════════
.cogni/repo-spec.yaml
  └─ governance.schedules:
       HEARTBEAT ✅ defined
       LEDGER_INGEST ✅ defined
       GIT_REVIEWER ❌ NOT DEFINED
       WORK_ITEM_DISPATCH ❌ NOT DEFINED

Verdict: 🔴 MISSING — no agent role schedules in config


LINK 2: SCHEDULE CREATION
══════════════════════════════════════════════════
syncGovernanceSchedules()
  Location: packages/scheduler-core/src/services/
  Caller: POST /api/internal/ops/governance/schedules/sync
  Trigger: manual HTTP POST only (not at boot, not at deploy)

  Routes:
    LEDGER_INGEST → CollectEpochWorkflow ✅
    Other charters → sandbox:openclaw graph ✅
    Agent roles → ❌ NOT HANDLED (separate system)

RoleSpec constants (role-spec.ts):
    OPERATING_REVIEW_ROLE { cron: "0 */12 * * *" } ✅ defined
    GIT_REVIEWER_ROLE { cron: "0 */4 * * *" }     ✅ defined
    Usage anywhere in codebase:                     ❌ ZERO IMPORTS

Verdict: 🔴 BROKEN — RoleSpecs are dead constants. Nobody reads them.


LINK 3: SWEEP WORKFLOW
══════════════════════════════════════════════════
ScheduledSweepWorkflow
  Location: packages/temporal-workflows/src/workflows/

  Steps:
    1. fetchWorkItemsActivity(queueFilter) ✅
    2. Sort by priority + status weight    ✅
    3. Pick highest-priority item           ✅
    4. Child: GraphRunWorkflow(item)        ✅
    5. processSweepResultActivity(result)   ✅

  Missing:
    - claim() before dispatch              ❌
    - release() after dispatch             ❌
    - Double-dispatch prevention           ❌

Verdict: 🟡 EXISTS + WORKS — but no claim/lock


LINK 4: FETCH ACTIVITY
══════════════════════════════════════════════════
fetchWorkItemsActivity
  Location: services/scheduler-worker/src/activities/
  Calls: GET /api/v1/work/items
  Filters: statuses, types, actor=ai
  Sorts: priority + status weight

  API endpoint exists?                     ✅
  Returns work items?                      ✅
  Tested?                                  ✅

Verdict: 🟢 FULLY WIRED


LINK 5: GRAPH EXECUTION
══════════════════════════════════════════════════
GraphRunWorkflow
  Location: packages/temporal-workflows/src/workflows/

  Steps:
    1. Create graph_runs record             ✅
    2. Mark started                         ✅
    3. executeGraphActivity()               ✅
    4. Mark success/error                   ✅

  Missing:
    - Transition work item on completion   ❌
    - Update claimedByRun                  ❌

Verdict: 🟡 WORKS — but no feedback to work item


LINK 6: GIT-REVIEWER GRAPH
══════════════════════════════════════════════════
langgraph:git-reviewer
  Location: packages/langgraph-graphs/src/catalog.ts

  Tools available:
    ┌────────────────────┬───────┐
    │ GET_CURRENT_TIME   │  ✅   │
    │ core__vcs_list_prs │  ❌   │
    │ core__vcs_ci_status│  ❌   │
    │ core__vcs_merge_pr │  ❌   │
    │ work_item_transition│ ❌   │
    └────────────────────┴───────┘

  Can review a PR?                         ❌
  Can check CI status?                     ❌
  Can transition work item?                ❌
  Can merge?                               ❌

Verdict: 🔴 HOLLOW SHELL — graph exists, can only read clock


LINK 7: OPERATING-REVIEW GRAPH
══════════════════════════════════════════════════
langgraph:operating-review
  Location: packages/langgraph-graphs/src/catalog.ts

  Tools: work_item_transition, work_item_query,
         get_current_time, repo_spec_read

  Can read work items?                     ✅
  Can transition status?                   ✅
  Can review code?                         ❌
  Scheduled?                               ❌

Verdict: 🟡 HAS TOOLS — but not scheduled
```

### CI/CD Validation Flow

```
  git push to PR
       │
       ▼
  ┌─────────┐
  │CI trigger│ 🟢 GH Actions, turborepo --affected
  └────┬────┘
       │
       ├─→ typecheck     🟢
       ├─→ lint/format   🟢
       ├─→ unit tests    🟢
       ├─→ build         🟢
       ├─→ component     🟡 gaps in coverage
       └─→ stack tests   🟡 flaky, need infra
              │
              ▼
  ┌──────────────┐
  │  PR Review   │ 🟡 Check Run bot posts (advisory only)
  └──────┬───────┘     git-reviewer can't actually review
         │
         ▼
  ┌──────────────┐
  │Merge → canary│ 🟢 manual but works
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │ Auto-deploy  │ 🟡 promote-and-deploy.yml triggers
  └──────┬───────┘     no smoke test, no deploy event stream
         │
         ▼
  ┌──────────────┐
  │ Canary live  │ 🔴 nobody watching. no alerts.
  └──────────────┘     no feedback to work item.
```

### Summary: What Would Happen If We Turned It On Today

```
IF we register GIT_REVIEWER schedule:
  Temporal cron fires every 4h
    → ScheduledSweepWorkflow runs
      → fetchWorkItemsActivity({ statuses: ["needs_merge"] })
        → picks highest-priority needs_merge item
          → GraphRunWorkflow("langgraph:git-reviewer", item)
            → git-reviewer reads current time
              → exits
                → item stays needs_merge forever
                  → NOTHING HAPPENED
```

### Minimum Viable Fix (3 changes)

```
1. TOOLS: Give git-reviewer VCS + transition tools
   File: packages/langgraph-graphs/src/graphs/operator/tools.ts
   Change: GIT_REVIEWER_TOOL_IDS = [
     GET_CURRENT_TIME,
     VCS_LIST_PRS,        ← can see PRs
     VCS_GET_CI_STATUS,   ← can check CI
     WORK_ITEM_TRANSITION ← can advance status
   ]

2. SCHEDULE: Wire RoleSpecs to actual Temporal schedules
   Either: extend syncGovernanceSchedules to handle roles
   Or: add GIT_REVIEWER to repo-spec.yaml governance.schedules

3. TRIGGER: Call syncGovernanceSchedules at deploy
   Currently: manual POST only
   Needed: call during app boot or deploy script
```

### Trust Gate: Why No Unsupervised AI Yet

```
TRUST LEVEL FOR AUTONOMOUS AGENT ACTIONS:

  Read work items         → safe      ✅ do it
  Transition status       → risky     🟡 needs audit trail
  Create branches         → risky     🟡 adapter-enforced prefix
  Merge PRs               → dangerous 🔴 NEVER without CI green
  Push to production      → forbidden 🔴 human-only

Current state: agents have NO unsupervised actions.
Needed first: eval pipeline proving agent output quality.
Until then: agents propose, humans approve.
```

## Acceptance Checks

- [ ] All links in dispatch chain traced with EXISTS/WIRED/BROKEN/MISSING
- [ ] Minimum viable fix identified with specific file paths
- [ ] Trust gate documented for autonomous actions

## Related

- [DEV_PIPELINE.md](../../work/charters/DEV_PIPELINE.md) — maturity scorecard
- [development-lifecycle.md](../spec/development-lifecycle.md) — status enum + dispatch spec
- [git-overseer.md](../spec/git-overseer.md) — git-manager agent design
- [proj.development-workflows](../../work/projects/proj.development-workflows.md) — parent project
