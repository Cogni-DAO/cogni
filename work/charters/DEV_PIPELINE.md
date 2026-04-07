---
id: chr.dev-pipeline
type: charter
title: "Development Pipeline Maturity"
state: Active
summary: "End-to-end maturity tracker: idea → design → implement → validate → deploy → observe → promote → feedback → eval. The core lifeblood of CI/CD."
created: 2026-04-06
updated: 2026-04-06
---

# Development Pipeline Maturity

> How well does the AI system track and drive work items end-to-end, from idea to production?

## Goal

Track maturity across every stage of the development pipeline — from idea to production and back. Each stage gets a percentage score based on what infrastructure exists, what's automated, and what's AI-driven. Make gaps visible so engineering investment targets the weakest link.

## Projects

| Project                      | Relationship                                    |
| ---------------------------- | ----------------------------------------------- |
| `proj.cicd-services-gitops`  | Deploy pipeline + image promotion               |
| `proj.operator-plane`        | Dashboard, streams, AI tools                    |
| `proj.development-workflows` | Status-driven lifecycle, skills, agent dispatch |

## Constraints

- No CI status on dashboard — PRs have no visible CI state on the operator dashboard
- No deploy events in stream — deploys happen but dashboard doesn't know
- Git manager not active — PR manager agent exists but isn't scheduled
- No work item → PR → deploy linkage — three systems (work/, GitHub, deploy) are disconnected
- No eval pipeline — can't measure if AI output quality is improving

## Relationship to Other Charters

| Charter        | Relationship                                                             |
| -------------- | ------------------------------------------------------------------------ |
| ENGINEERING    | Parent — this is ENGINEERING's core mission operationalized              |
| DATA_STREAMS   | Sibling — data streams tracks _data source_ maturity; this tracks _SDLC_ |
| SUSTAINABILITY | Consumer — observability feeds back into pipeline health                 |
| EVALS          | Consumer — eval results validate pipeline output quality                 |

## The Chain

```
IDEA → DESIGN → IMPLEMENT → VALIDATE → FLIGHT → OBSERVE → PROMOTE → FEEDBACK → EVAL
 │        │          │           │          │        │          │          │         │
 ▼        ▼          ▼           ▼          ▼        ▼          ▼          ▼         ▼
/idea   /design   /implement  CI+tests   canary   telemetry  preview→   reviews    AI
/bug    /spec     /closeout   PR review  deploy   logs+      prod       rollback   graph
/task             branch+PR   playwright  gate    metrics    promotion  hotfix     quality
```

## Maturity Levels (Universal)

| Level | Meaning                                                           |
| ----- | ----------------------------------------------------------------- |
| 0%    | No tooling — fully manual, human-only                             |
| 20%   | Scripts/CLI exist — human triggers manually                       |
| 40%   | Semi-automated — human initiates, automation executes             |
| 60%   | AI-assisted — AI agent can perform with human approval            |
| 80%   | AI-driven — AI agent performs autonomously, human reviews results |
| 100%  | Closed-loop — AI performs, validates, and self-corrects           |

## Pipeline Stage Scorecard

### Stage 1: Ideation & Triage

_Work item creation and routing._

| Capability              | Tool/Code                       | Maturity | Notes                                                     |
| ----------------------- | ------------------------------- | -------- | --------------------------------------------------------- |
| Create work items       | `/idea`, `/bug`, `/task` skills | **40%**  | AI creates via skill, human reviews frontmatter           |
| Triage routing          | `/triage` skill                 | **40%**  | AI routes story→done, task→design/implement; needs review |
| Priority assignment     | Manual in frontmatter           | **20%**  | Human sets priority/rank; no AI recommendation            |
| Duplicate detection     | None                            | **0%**   | No tooling to detect duplicate work items                 |
| Work item ↔ PR linking | `pr:` and `branch:` fields      | **20%**  | Fields exist but populated manually; no auto-detection    |

**Stage score: ~25%**

### Stage 2: Design & Specification

_Technical design before implementation._

| Capability              | Tool/Code                         | Maturity | Notes                                 |
| ----------------------- | --------------------------------- | -------- | ------------------------------------- |
| Spec writing            | `/design`, `/spec` skills         | **40%**  | AI writes specs; human reviews        |
| Design review           | `/review-design` skill            | **40%**  | AI performs review; structured output |
| Architecture validation | `dep-cruiser` + boundary rules    | **60%**  | Automated boundary enforcement in CI  |
| Contract-first types    | Zod contracts in `src/contracts/` | **60%**  | Enforced by lint rules + TypeScript   |

**Stage score: ~50%**

### Stage 3: Implementation

_Code writing, branching, and PR creation._

| Capability                | Tool/Code                       | Maturity | Notes                                          |
| ------------------------- | ------------------------------- | -------- | ---------------------------------------------- |
| Branch creation           | `/implement` skill + VCS tools  | **60%**  | AI creates branch + implements; human reviews  |
| Code writing              | `/implement` skill              | **60%**  | AI writes code to spec; quality varies         |
| PR creation               | `/closeout` skill               | **60%**  | AI creates PR with summary; human reviews      |
| Contributor protocol      | `/contribute` skill             | **40%**  | External AI agent onboarding; needs refinement |
| Git manager orchestration | `langgraph:pr-manager` (unused) | **20%**  | Agent exists but not scheduled/active          |

**Stage score: ~48%**

### Stage 4: Validation

_CI, testing, and review gates._

| Capability                   | Tool/Code                  | Maturity | Notes                                               |
| ---------------------------- | -------------------------- | -------- | --------------------------------------------------- |
| CI pipeline (lint/type/test) | GitHub Actions `ci.yaml`   | **80%**  | Turborepo-scoped, runs on every PR                  |
| Unit tests                   | Vitest                     | **60%**  | Good coverage on core; gaps in governance/scheduler |
| Stack tests                  | Vitest + testcontainers    | **40%**  | Exist but flaky; require running infra              |
| E2E / Playwright             | Playwright (scaffolded)    | **20%**  | Framework exists; minimal test coverage             |
| PR review bot                | Check Run gate (task.0153) | **40%**  | AI review exists; not connected to merge gate       |
| AI-driven test writing       | None                       | **0%**   | No `/test` auto-generation from spec                |
| CI status → dashboard        | `CiStatusEvent` (planned)  | **10%**  | Event type defined; webhook not wired to stream yet |

**Stage score: ~36%**

### Stage 5: Flighting (Canary Deploy)

_First deployment to canary environment._

| Capability                 | Tool/Code                    | Maturity | Notes                                         |
| -------------------------- | ---------------------------- | -------- | --------------------------------------------- |
| Auto-deploy on merge       | `promote-and-deploy.yml`     | **60%**  | Workflow exists; canary auto-deploys on merge |
| Deploy events → stream     | `DeployEvent` type (planned) | **10%**  | Type defined; not wired to webhook/stream     |
| Deploy status on dashboard | None                         | **0%**   | No visibility into canary deploy status       |
| Rollback capability        | Manual SSH + docker compose  | **20%**  | Manual only; no automated rollback            |
| Smoke tests post-deploy    | None                         | **0%**   | No automated post-deploy validation           |

**Stage score: ~18%**

### Stage 6: Observability

_Telemetry, logging, and monitoring of deployed code._

| Capability               | Tool/Code                           | Maturity | Notes                                         |
| ------------------------ | ----------------------------------- | -------- | --------------------------------------------- |
| Structured logging       | Pino JSON → Alloy → Loki            | **60%**  | Pipeline works; not all services instrumented |
| Metrics collection       | Grafana Cloud (preview/prod)        | **40%**  | Basic infra metrics; no app-level metrics     |
| AI cost tracking         | LiteLLM callbacks → charge_receipts | **10%**  | Pipeline broken (bug.0298); stale image       |
| Process health dashboard | `ProcessHealthCard` + SSE           | **50%**  | Works for operator; no cross-node             |
| Error alerting           | None                                | **0%**   | No automated alerts on errors                 |

**Stage score: ~32%**

### Stage 7: Promotion

_Preview → production promotion pipeline._

| Capability                 | Tool/Code           | Maturity | Notes                                 |
| -------------------------- | ------------------- | -------- | ------------------------------------- |
| Preview environment        | Argo CD (planned)   | **10%**  | Design exists; not operational        |
| Promotion gate             | Manual              | **20%**  | Human decides when to promote         |
| Release PR creation        | Manual              | **20%**  | Human creates release/\* PR to main   |
| Production deploy          | Not operational     | **0%**   | No production environment exists yet  |
| `deploy_verified` tracking | Field on work items | **20%**  | Field exists; never set automatically |

**Stage score: ~14%**

### Stage 8: Feedback & Rollback

_Post-deploy feedback loops._

| Capability               | Tool/Code           | Maturity | Notes                                |
| ------------------------ | ------------------- | -------- | ------------------------------------ |
| User feedback collection | None                | **0%**   | No users yet; no feedback mechanism  |
| Automated rollback       | None                | **0%**   | No automated rollback on failure     |
| Incident management      | `/postmortem` skill | **20%**  | Skill exists; manual trigger         |
| Hotfix workflow          | Manual branch + PR  | **20%**  | Standard git workflow; no fast-track |

**Stage score: ~10%**

### Stage 9: Evaluation

_AI quality measurement and improvement loops._

| Capability                   | Tool/Code                     | Maturity | Notes                                              |
| ---------------------------- | ----------------------------- | -------- | -------------------------------------------------- |
| AI graph evals               | EVALS charter + `/eval` skill | **20%**  | Framework designed; no automated execution         |
| Eval data collection         | None (Doltgres spike done)    | **10%**  | Doltgres adapter works; not wired to eval pipeline |
| Quality regression detection | None                          | **0%**   | No baseline tracking                               |
| Eval → work item feedback    | None                          | **0%**   | No closed loop from eval results to new work items |

**Stage score: ~8%**

### Stage 10: Automated Drive E2E

_The meta-stage: does anything actually drive work items through the pipeline without a human pushing?_

| Capability                        | Tool/Code                                | Maturity | Notes                                                           |
| --------------------------------- | ---------------------------------------- | -------- | --------------------------------------------------------------- |
| CI on every PR                    | GitHub Actions `ci.yaml`                 | **80%**  | Runs automatically; turborepo-scoped                            |
| PR review bot                     | git-reviewer Check Run (task.0153)       | **40%**  | Exists; not wired as merge gate                                 |
| Auto-deploy on canary merge       | `promote-and-deploy.yml`                 | **60%**  | Workflow runs; no post-deploy verification                      |
| Scheduled dispatch infrastructure | `ScheduledSweepWorkflow` + activities    | **40%**  | Code exists and works; **no schedules registered**              |
| Transition table enforcement      | `transitions.ts` + `WorkItemCommandPort` | **60%**  | Enforced at runtime; agents use `core__work_item_transition`    |
| Work item lifecycle workflow      | None (Temporal-based FSM planned)        | **0%**   | Design: one long-running workflow per item; Temporal IS the FSM |
| Staleness detection               | None                                     | **0%**   | No timer-based alerts when items are stuck                      |
| Deploy verification feedback      | `deploy_verified` field exists           | **10%**  | Field defined; never set automatically                          |
| Eval-driven quality gate          | None                                     | **0%**   | No automated quality regression detection                       |
| Claim/release (double-dispatch)   | Ports defined, not called                | **10%**  | `claim()` and `release()` on CommandPort; sweep doesn't use     |

**Stage score: ~20%**

#### Design Direction: Temporal as State Machine

The existing `ScheduledSweepWorkflow` + `GIT_REVIEWER_ROLE` + `fetchWorkItemsActivity` chain is 90% wired. The immediate unlock is registering schedules in `repo-spec.yaml`. The long-term architecture:

```
WorkItemLifecycleWorkflow(itemId)        ← one per work item
├── Signal: advance(toStatus)            ← human/agent override
├── Signal: block(reason)                ← escalation
├── Query: getState()                    ← dashboard reads this
├── Timer: staleAfter(48h)               ← auto-alert on stuck items
└── Loop:
    1. read status from frontmatter
    2. if needs_* → child GraphRunWorkflow (dispatch agent)
    3. await signal or timer
    4. if timer fires → alert + auto-block
    5. goto 1
```

Temporal provides persistence, retry, timeout, audit trail, and exactly-once dispatch for free. No bespoke FSM runtime needed.

**Immediate unlock (no new code):** Add governance schedules to `.cogni/repo-spec.yaml` for `GIT_REVIEWER` and `WORK_ITEM_DISPATCH` roles. The `syncGovernanceSchedules()` function already creates Temporal schedules from config.

## Summary Matrix

```
STAGE              SCORE   ██████████ (10 blocks = 100%)
───────────────────────────────────────────────────────
Ideation            25%    ██░░░░░░░░
Design              50%    █████░░░░░
Implementation      48%    ████░░░░░░
Validation          36%    ███░░░░░░░
Flighting           18%    █░░░░░░░░░
Observability       32%    ███░░░░░░░
Promotion           14%    █░░░░░░░░░
Feedback            10%    █░░░░░░░░░
Evaluation           8%    ░░░░░░░░░░
Automated Drive     20%    ██░░░░░░░░  ← binding constraint
───────────────────────────────────────────────────────
OVERALL             26%    ██░░░░░░░░
```

## Immediate Next Steps

1. **Register work item schedules** — add `GIT_REVIEWER` + `WORK_ITEM_DISPATCH` to `repo-spec.yaml` governance schedules (0 new code; just config)
2. Wire `workflow_run` webhook → `CiStatusEvent` → dashboard (PR #813 in progress)
3. ~~Make PR numbers clickable in Git Activity feed (link to GitHub)~~ ✅ Done
4. Design `WorkItemLifecycleWorkflow` — Temporal-native FSM per work item
5. Design work-item-linked dashboard view (the "Active Work" panel)

## What This Charter Does NOT Own

- Individual data source maturity (→ DATA_STREAMS)
- AI model quality benchmarks (→ EVALS)
- Cost optimization (→ SUSTAINABILITY)
- Agent prompt engineering (→ per-agent specs)

This charter owns the **pipeline itself** — the chain from idea to production and back.
