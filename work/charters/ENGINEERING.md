---
id: chr.engineering
type: charter
title: "ENGINEERING Charter"
state: Active
summary: ENGINEERING governance charter scaffold for recurring heartbeat runs.
created: 2026-02-15
updated: 2026-05-01
---

# ENGINEERING Charter

## Goal

Ship reliable code that brings charters' goals to life. Maintain quality through testing, CI/CD, and optimization loops. Build skills and workflows that accelerate delivery.

See [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md) for workflow standards.

## Charter Work Requests

_Updated by governance skills - shows what work other charters need from ENGINEERING_

| Charter | Priority | Severity | Work Item                      | Status      | Notes                                               |
| ------- | -------- | -------- | ------------------------------ | ----------- | --------------------------------------------------- |
| SUSTAIN | 0        | High     | `proj.observability-hardening` | Queued      | BLOCKING: Can't optimize what you can't see         |
| COMM    | 0        | High     | `proj.messenger-channels`      | Queued      | BLOCKING: P0 for community reach                    |
| SUSTAIN | 1        | High     | `proj.context-optimization`    | In Progress | $5.50/run unsustainable (needs observability first) |
| SUSTAIN | 1        | Med      | `proj.governance-agents`       | Queued      | Signal infra for governance loops                   |
| COMM    | 2        | Low      | `proj.sourcecred-onchain`      | Paused      | Cred system doesn't run                             |

## Principles

- **Maximize OSS**: Prefer open-source tools and dependencies over proprietary/vendor solutions
- **Test-first reliability**: Code only works if tested end-to-end and aligned with spec invariants
- **Workflow discipline**: Follow the [status-driven lifecycle](../../docs/spec/development-lifecycle.md) — every `needs_*` status maps to one `/command`, dispatched deterministically

## Workflow Health Matrix

> Regraded 2026-05-01 by `engineering-optimizer` skill (prior grade: 2026-04-19, 12 days stale). Doltgres work-items API shipped in the gap (#1130, #1144, #1180); `/idea` and `/triage` now post to a real DB, not markdown. `validate-candidate` skill landed and is in active use. New rows added for **agent identity / revocation** (zero coverage discovered 2026-05-01) and **autonomous eval loop** (the gap that means we have no autonomous agents — only Derek-led runs). Columns: what a solo agent needs, what exists today, the gap, health. 🔴 poor · 🟡 partial · 🟢 good.

| Workflow stage                    | What a solo agent needs to ship `deploy_verified: true`                                                                         | What exists today                                                                                                            | Gap                                                                                                                                                                                                           | Health |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Intake (`/idea`, `/bug`)          | Distill idea → core I/O + expected user behavior + which existing tools to reuse                                                | Commands; `POST /api/v1/work/items` live on Doltgres                                                                         | Backend is real now. Commands still balloon into planning without action; no reuse-alignment step                                                                                                             | 🟡     |
| Triage (`/triage`)                | Route by type, force scope down, confirm reuse before new code                                                                  | Lifecycle spec + command + `PATCH /api/v1/work/items` on Doltgres                                                            | Same plansturbation failure mode. Threshold for "skip /design" is undefined — agents skip it whenever bug body has the fix                                                                                    | 🟡     |
| Design (`/design`)                | Spec + reuse-aware design doc                                                                                                   | Command, in active use                                                                                                       | Works in practice; no rule for **when** /design is required vs optional. Both bug.5004 + bug.5005 agents skipped it on 2026-05-01 (correctly, but un-codified)                                                | 🟡     |
| Review-Design (`/review-design`)  | Critical second pass on the design before code                                                                                  | Command, in active use                                                                                                       | Works in practice                                                                                                                                                                                             | 🟢     |
| Implement (`/implement`)          | Architecture + feature + testing guides; API-contract rule                                                                      | `architecture.md`, `feature-development.md`, `testing.md`                                                                    | Covered                                                                                                                                                                                                       | 🟢     |
| `## Validation` block authoring   | Exercise + observability recipe per surface (API, graph, scheduler, CLI, infra)                                                 | `agent-api-validation.md` (API only); `validate-candidate` scorecard format locked                                           | API recipes are 🟢. No recipes for graph/scheduler/CLI/infra surfaces                                                                                                                                         | 🟡     |
| Closeout / PR (`/closeout`)       | PR body with TLDR · deploy impact · E2E plan · post-flight validation result                                                    | `/closeout` command + `pr-management-playbook.md`, in active use                                                             | Does not yet enforce the 4-field validation checklist                                                                                                                                                         | 🟡     |
| Flight to `candidate-a`           | Clear app-lever vs infra-lever decision tree + trigger steps                                                                    | `candidate-flight-v0.md`, `ci-cd.md`, `/promote` skill                                                                       | No decision tree; `candidate-flight-infra` has no agent-facing guide                                                                                                                                          | 🟡     |
| Self-exercise on `candidate-a`    | Canonical URL map + auth flow per env + interaction recipes per surface                                                         | `agent-api-validation.md` (API), `validate-candidate` skill with two-axis matrix + family sub-matrix                         | API + UI surfaces have recipes. Graph, scheduler, infra still uncovered                                                                                                                                       | 🟡     |
| Loki self-lookup                  | "Find my own request at the deployed SHA" — LogQL + grafana MCP recipe                                                          | `validate-candidate` skill §6 has tiered recipe; `scripts/loki-query.sh` shell fallback exists                               | Recipe exists, but feature-specific markers are not consistently emitted across nodes — many graphs still only emit ambient logs                                                                              | 🟡     |
| Finalize `deploy_verified: true`  | API-side: PATCH the field. Auditable. Authority recorded                                                                        | Lifecycle spec defines invariant; PATCH endpoint exists                                                                      | **🔴 BLOCKER discovered 2026-05-01: PATCH allowlist excludes `deployVerified`.** Doltgres-stored items literally cannot be flipped via canonical API. Tracked: bug.5005                                       | 🔴     |
| Review (`/review-implementation`) | Critical review + revision loop with loop limit                                                                                 | Command + `revision` field + `LOOP_LIMIT` invariant                                                                          | Covered                                                                                                                                                                                                       | 🟢     |
| **Agent identity / revocation**   | Per-row `principal_id` so a compromised key can be revoked + writes audited                                                     | `knowledge_contributions` has `principal_id` (branch-per-PR flow only). `INTERNAL_WRITES_TO_MAIN` skips it entirely          | **🔴 NEW ROW.** No `created_by` / `edited_by` on `work_items`, `knowledge`, `citations`, `domains`, `sources`. Cannot revoke a leaked key by querying its writes. `dolt_log` records superuser, not principal | 🔴     |
| **Autonomous eval loop**          | E2E synthetic agent walks `/idea → … → /validate-candidate` against preview every operator PR; scorecard catches contract drift | None. `eval` slash-command exists but is design-time only. Old `proj.evals` scaffold expired. `task.0309` qa-agent is paused | **🔴 NEW ROW. The reason no autonomous agent runs end-to-end today.** Without this, every contract regression (e.g. bug.5005, the cursor cap, normalizer outcomes) is discovered by humans in production      | 🔴     |
| Secrets across lanes (cross-cut)  | Agent-facing playbook for dev → candidate-a → preview → prod                                                                    | `SECRET_ROTATION.md` (incident-only)                                                                                         | No proactive-add playbook; agents improvise                                                                                                                                                                   | 🔴     |
| IaC capture (cross-cut)           | "You did X by hand — here's the 5 files to commit" guide                                                                        | `DEPLOYMENT_ARCHITECTURE.md`                                                                                                 | No capture recipe → ad-hoc ops rot out of git                                                                                                                                                                 | 🔴     |
| Dolt memory ops (cross-cut)       | How to write/read memory deterministically                                                                                      | `knowledge-syntropy` spec exists; `core__knowledge_*` tools live; `KNOWLEDGE.md` health scorecard active                     | Spec + tools exist; agent-facing recipe ("how do I cite from a /research run") still informal                                                                                                                 | 🟡     |
| Self-review cycle (meta)          | Scheduled regrade of this matrix + the lifecycle itself                                                                         | First regrade just occurred 2026-05-01 (this edit, by `engineering-optimizer` skill)                                         | One-shot, not scheduled. Needs cadence + owner — propose monthly, owner = engineering-optimizer skill, trigger = `/loop` schedule                                                                             | 🟡     |

**Rollup**: 2 🟢 / 9 🟡 / 7 🔴 across 18 stages (was 4 🟢 / 2 🟡 / 10 🔴 across 16). Net: many reds graduated to yellow as the Doltgres API + validate-candidate skill landed; two new reds surfaced (agent identity, eval loop) that were invisible to the prior grader.

- **Critical-path reds** (block the next autonomous-agent ship):
  - **`Finalize deploy_verified` 🔴** — bug.5005 fix is the smallest unblock. Until this lands, every Doltgres-created work item is permanently `deploy_verified=false` no matter what the agent does. **Currently in flight (Dev B, branch `derekg1729/fix-patch-deploy-verified`).**
  - **`Autonomous eval loop` 🔴** — no synthetic agent runs the lifecycle on preview. This is _the_ reason agents only run Derek-led: there's no harness to catch contract drift between commits, so every regression breaks the next agent. Pareto fix: one operator-side graph that walks a toy bug `/idea → /validate-candidate` against `preview.cognidao.org` and posts a scorecard to the operator PR that triggered it. Doesn't test the agents — tests the contract the agents depend on. Tracked as `proj.autonomous-eval-loop` (new project, see below).
- **Cross-cut reds**:
  - **Agent identity / revocation 🔴** — uncovered 2026-05-01. Add `principal_id NOT NULL` to all writeable Doltgres tables; populate from auth context. Spec amendment to `knowledge-syntropy`.
  - Secrets, IaC capture — unchanged from prior grade.
- **Yellow stripe progress**: `/idea`, `/triage`, `/design`, `Validation block authoring`, `Closeout`, `Flight`, `Self-exercise`, `Loki self-lookup`, `Dolt memory ops`, `Self-review cycle` all moved 🔴 → 🟡. The owner's lived workflow widened — the question now is hardening the surfaces that already exist, not building from zero.

## Key References

| Type  | Path                                                                                              | Purpose                                                           |
| ----- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Spec  | [@docs/spec/architecture.md](../../docs/spec/architecture.md)                                     | System architecture and hex ports                                 |
| Spec  | [@docs/spec/services-architecture.md](../../docs/spec/services-architecture.md)                   | Service boundaries and deployment                                 |
| Spec  | [@docs/spec/system-test-architecture.md](../../docs/spec/system-test-architecture.md)             | Test infrastructure patterns                                      |
| Spec  | [@docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md)                   | Command-driven workflows                                          |
| Guide | [@work/README.md](../README.md)                                                                   | Work management guide                                             |
| Index | [@work/items/\_index.md](../items/_index.md)                                                      | Canonical work item index                                         |
| Trace | [@docs/research/eval-loop-trace-2026-05-01.md](../../docs/research/eval-loop-trace-2026-05-01.md) | Eval-loop baseline trace + D1–D8 assertion corpus for `task.5004` |

## Projects

### Core mission / priorities

| Priority | Target                                                                 | Score (0-5) | Status      | Notes |
| -------- | ---------------------------------------------------------------------- | ----------- | ----------- | ----- |
| 0        | Delivery velocity: tight feedback loops accelerate workflow efficiency | 0           | Not Started |       |
| 1        | Test infrastructure: agents + humans validate before ship              | 0           | Not Started |       |
| 2        | Code quality: specs enforced, best practices followed                  | 0           | Not Started |       |

### Top projects (max 4)

_ENGINEERING-owned infrastructure. Feature delivery projects live in their respective charters; GOVERN handles cross-charter prioritization._

| Project                          | Why now                                                                                                                                                                                                                | Score (0-5) | Status      | Notes                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proj.autonomous-eval-loop`      | **NEW 2026-05-01.** Top critical-path red. Smoke-eval that walks `/idea → /validate-candidate` per operator PR. Catches contract drift before agents discover it in prod. The reason no agent runs autonomously today. | 0           | Not Started | Pareto: one graph, one toy bug, one scorecard. Defer Langfuse/Dolt-eval-registry until contract is stable                                             |
| `proj.agent-identity-revocation` | **NEW 2026-05-01.** Add `principal_id NOT NULL` to writeable Doltgres tables. Cross-cut red. Required before public/x402 contribution flow can land.                                                                   | 0           | Not Started | Spec amendment to `knowledge-syntropy` + adapter changes per node                                                                                     |
| `proj.development-workflows`     | Standardize spec/PR/agent workflows                                                                                                                                                                                    | 1           | In Progress | Doltgres work-items API + validate-candidate skill landed. Next: enforce 4-field validation checklist on `/closeout`; codify when /design is required |
| `proj.context-optimization`      | Token efficiency for multi-call workflows                                                                                                                                                                              | 0           | Not Started | Per `feedback_cost_control` — Opus burn rate unsustainable without prompt caching audit                                                               |

## Constraints

- Development execution 100% dependent on one human (Derek)
- No CI/CD for governance workflows yet (only app CI exists)
- Agents cannot run full stack/comp tests to self-validate code before submitting PRs
- Limited test coverage for governance/scheduler infrastructure
- Development workflows brand new, require iteration and refinement

### Skills / resources

| Resource               | Use                                | Where                                | /skill | Notes                    |
| ---------------------- | ---------------------------------- | ------------------------------------ | ------ | ------------------------ |
| Governance skills      | Charter-scoped governance runs     | `.openclaw/skills/gov-*`             |        | Trigger-routed execution |
| Development skills     | Status-driven lifecycle commands   | `.claude/commands/`                  |        | `needs_*` → `/command`   |
| Test infrastructure    | Mock-LLM, system integration tests | `tests/`, `docker-compose`           |        | Partial coverage         |
| CI/CD pipelines        | GitHub Actions workflows           | `.github/workflows/`                 |        | App CI only; no gov CI   |
| Specs and architecture | Technical contracts and boundaries | `docs/spec/`                         |        | Active specs enforce     |
| Work tracking system   | Projects, tasks, issues            | `work/`                              |        | Via OpenClaw skills      |
| Deployment health      | Per-service health, LLM cost       | `.openclaw/skills/deployment-health` | ✓      | v0 MVP - data incomplete |
