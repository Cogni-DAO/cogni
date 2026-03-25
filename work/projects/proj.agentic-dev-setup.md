---
id: proj.agentic-dev-setup
type: project
primary_charter: chr.engineering
title: "Agentic Dev Setup — Clawdbot Steers, Codex + Claude Code Implement"
state: Active
priority: 0
estimate: 5
summary: Three-tier agentic development model — Clawdbot as research/partnership lead, Codex + Claude Code as implementation agents — coordinated through repo-spec identity and shared git conventions
outcome: A documented, reproducible agentic development setup where Clawdbot drives research/planning/partnership, Codex handles async background implementation, and Claude Code handles interactive implementation — each configured per-node via repo-spec
assignees:
  - cogni-dev
created: 2026-03-22
updated: 2026-03-23
labels:
  - agentic-dev
  - codex
  - claude-code
  - openclaw
  - workflow
---

# Agentic Dev Setup — Clawdbot Steers, Codex + Claude Code Implement

> Related: `proj.external-onboarding-skill`, `proj.development-workflows`, `proj.agentic-project-management`, `proj.sandboxed-agents`

## Goal

Establish a three-tier agentic development model:

1. **Clawdbot (OpenClaw)** — Research lead and steering agent. Conducts deep research, evaluates options, writes specs, manages partnerships and external entity onboarding. Long-running gateway agent. The **agentic research and partnership team.**
2. **Codex (OpenAI)** — Async background implementer. Takes well-scoped tasks, works in isolated environments, produces PRs. Best for parallelizable, well-defined work.
3. **Claude Code (Anthropic)** — Interactive implementer. Pair-programs with human operators, handles complex multi-file changes. Best for nuanced, context-heavy work.

**Clawdbot steers, Codex and Claude Code row.**

The model is anchored to the node's `repo-spec.yaml` identity — governance schedules drive Clawdbot's heartbeat, the billing pipeline tracks cost per agent tier, and the DAO contract governs spending authority. Without a valid repo-spec, there's no node to develop against.

## Roadmap

### Crawl (P0) — Configure Each Agent Runtime + Handoff Protocol

**Goal:** Each agent tier is configured, documented, and can produce work against the node's repo-spec identity. Handoff from Clawdbot -> implementers works through git-backed work items.

| Deliverable                                                                                                    | Status      | Est | Work Item |
| -------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Clawdbot SOUL.md: steering persona — research methodology, partnership protocols, work item creation           | Not Started | 2   | —         |
| Clawdbot channel config: routing for research, partnership, governance heartbeat                               | Not Started | 1   | —         |
| Clawdbot billing: governance schedule in repo-spec drives heartbeat cadence, LiteLLM tracks cost per run       | Not Started | 2   | —         |
| Codex config: `AGENTS.md` at repo root — repo context, conventions, how to validate, repo-spec awareness       | Not Started | 2   | —         |
| Codex billing: attribute Codex API spend to the node's billing pipeline (OpenRouter or direct)                 | Not Started | 2   | —         |
| Claude Code config: verify `.claude/` skills and settings optimized for implementer role                       | Not Started | 1   | —         |
| Claude Code billing: LiteLLM proxy attribution for interactive sessions                                        | Not Started | 1   | —         |
| Handoff protocol: Clawdbot creates work items with spec refs + acceptance criteria, implementers claim via git | Not Started | 2   | —         |
| Git convention: branch naming, commit attribution (`Co-authored-by: clawdbot`, `codex`, `claude-code`)         | Not Started | 1   | —         |
| Test: Clawdbot creates a work item -> Codex picks it up -> produces a PR -> cost attributed in billing         | Not Started | 3   | —         |

### Walk (P1) — Parallel Execution + Research/Partnership Pipeline

**Goal:** Multiple agents work in parallel. Clawdbot drives research and external entity partnerships. Cost per agent tier is visible in the node's billing dashboard.

| Deliverable                                                                                                                   | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Codex task queue: Clawdbot writes tasks, Codex worker polls and executes                                                      | Not Started | 3   | (create at P1 start) |
| Conflict prevention: branch reservation so Codex and Claude don't collide on the same files                                   | Not Started | 2   | (create at P1 start) |
| Research pipeline: Clawdbot conducts deep research, writes to `docs/research/`, creates implementation tasks                  | Not Started | 2   | (create at P1 start) |
| Partnership pipeline: Clawdbot engages external AI experiments, runs onboarding skill from `proj.external-onboarding-skill`   | Not Started | 3   | (create at P1 start) |
| Agent cost dashboard: per-tier spend (Clawdbot/Codex/Claude), cost per PR, burn rate — sourced from LiteLLM + charge_receipts | Not Started | 2   | (create at P1 start) |
| Result validation: automated `pnpm check` on agent-produced PRs before human review                                           | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Coordination + External Team Setup

**Goal:** The three-tier model works for external teams via the onboarding skill. Agents coordinate autonomously with human oversight at approval gates only.

| Deliverable                                                                                               | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| External team setup: onboarding skill configures all three agent tiers against their repo-spec            | Not Started | 2   | (create at P2 start) |
| Clawdbot-to-Clawdbot: steering agents across Cogni nodes coordinate on shared initiatives                 | Not Started | 3   | (create at P2 start) |
| Agent dispatch UI: human picks agent runtime per work item from operations dashboard                      | Not Started | 3   | (create at P2 start) |
| Autonomous task decomposition: Clawdbot breaks projects into Codex-sized tasks without human intervention | Not Started | 3   | (create at P2 start) |
| Cross-node billing: when Clawdbot on Node A creates work for Codex on Node B, cost flows through x402     | Not Started | 2   | (create at P2 start) |

## Constraints

- Each agent tier must be independently usable — a team can start with just Claude Code and add Codex/Clawdbot later
- All agent tiers anchor to `repo-spec.yaml` — no valid repo-spec, no agentic dev
- Codex setup must work with OpenAI's conventions (`AGENTS.md` / `codex.md` at repo root)
- Claude Code setup must work with Anthropic's conventions (`.claude/` dir, `CLAUDE.md`, skills)
- Clawdbot setup must work with OpenClaw conventions (SOUL.md, channel config, workspaces)
- All agent outputs flow through git — no proprietary sync between agents
- Agent spend must be attributable to the node's billing pipeline (LiteLLM proxy audit -> charge_receipts)
- Human approval gates required for: merges to main/staging, infrastructure changes, spending above DAO-governed threshold
- The model must work for a solo developer (one human + three agent tiers) and scale to teams

## Dependencies

- [ ] `@cogni/repo-spec` — schema must support governance schedules (exists) and per-agent billing attribution
- [ ] `proj.sandboxed-agents` — OpenClaw sandbox for Clawdbot gateway mode
- [ ] `proj.external-onboarding-skill` — external teams need this to bootstrap the three-tier model
- [ ] `proj.development-workflows` — git conventions, PR linkage format
- [ ] LiteLLM proxy — must be configured to tag spend per agent tier (exists, needs attribution labels)
- [ ] OpenAI Codex CLI — must be stable enough to depend on for async task execution
- [ ] Anthropic Claude Code CLI — must support skill/settings patterns we define

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Repo-spec anchors everything

The repo-spec isn't just identity — it's the economic contract:

- **`governance.schedules[]`** drives Clawdbot's heartbeat. Each charter gets a cron schedule and entrypoint. Clawdbot wakes up on schedule, reads the node's state, creates/updates work items, engages partnerships.
- **`payments_in.credits_topup`** is the revenue side. The DAO receives USDC, converts to credits. Those credits fund agent execution.
- **LiteLLM proxy audit** is the cost side. Every LLM call through the proxy gets tagged with `agent_tier` (clawdbot/codex/claude). The `charge_receipts` table tracks spend per tier.

The billing loop: **revenue (USDC -> credits) -> agent work (credits burned per LLM call) -> output (PRs, research, partnerships) -> more revenue.**

Without active payments in the repo-spec, there's no budget for agents to work against.

### Why three tiers, not two?

1. **Research and implementation are different skills.** Clawdbot does deep research (web search, competitive analysis, partnership outreach). Implementation agents need focused, well-scoped tasks.
2. **Async and interactive are different workflows.** Codex: "here's a task, come back with a PR." Claude Code: "let's figure this out together."
3. **Steering is continuous, implementation is episodic.** Clawdbot monitors project state via governance heartbeats. Implementation agents spin up, do work, spin down.

### Handoff protocol (draft)

```
Clawdbot                    Work Items                 Codex / Claude Code
   |                            |                            |
   |-- creates task.XXXX ------>|                            |
   |   (spec refs, acceptance   |                            |
   |    criteria, cost estimate,|                            |
   |    billing: node_id)       |                            |
   |                            |<--- claims task -----------|
   |                            |     (sets assignee,        |
   |                            |      creates branch)       |
   |                            |                            |
   |                            |<--- updates status --------|
   |                            |     (in_progress ->        |
   |                            |      needs_review)         |
   |                            |                            |
   |<-- reviews PR -------------|                            |
   |   (validates vs spec,      |                            |
   |    checks cost vs budget)  |                            |
```

Work items are the coordination primitive. Cost attribution flows through `node_id` in the billing pipeline.

### Codex vs Claude Code: when to use which

| Signal                                                   | Use Codex | Use Claude Code  |
| -------------------------------------------------------- | --------- | ---------------- |
| Task is well-scoped with clear acceptance criteria       | Yes       | Okay             |
| Task requires multi-file refactoring with judgment calls | No        | Yes              |
| Multiple independent tasks can run in parallel           | Yes       | No (one session) |
| Task requires human input mid-execution                  | No        | Yes              |
| Task requires running the dev stack interactively        | No        | Yes              |
| Task is exploratory / "figure out the right approach"    | No        | Yes              |

### Clawdbot's steering responsibilities

1. **Research** — Deep dives on technologies, competitive landscape. Writes to `docs/research/`.
2. **Spec authoring** — Translates research into specs with invariants and acceptance criteria.
3. **Task decomposition** — Breaks specs into tasks sized for Codex (small, isolated) or Claude Code (larger, contextual).
4. **Partnership** — Engages external AI experiments about becoming DAOs. Runs `proj.external-onboarding-skill`. Tracks relationship status.
5. **Governance heartbeat** — Runs on cron per `governance.schedules[]` in repo-spec. Reads node state, updates roadmap, flags blockers.
6. **Cost oversight** — Monitors agent spend vs budget. Flags when burn rate exceeds DAO-governed threshold.

### Configuration files per agent

**Codex** — at repo root:

- `AGENTS.md` — repo context, conventions, validation commands, repo-spec awareness
- Access to `work/` for task discovery, `docs/spec/` for implementation contracts
- LiteLLM proxy URL + API key (tagged `agent_tier: codex`)

**Claude Code** — in `.claude/`:

- `CLAUDE.md` — repo conventions (exists)
- `.claude/skills/` — `/implement`, `/test`, `/closeout` (exist)
- LiteLLM proxy attribution via session metadata

**Clawdbot (OpenClaw)** — in sandbox workspace:

- `SOUL.md` — steering persona, research methodology, partnership protocols
- Channel config — routing for research, partnership, governance
- `governance.schedules[]` in repo-spec drives heartbeat cron
- LiteLLM proxy URL (tagged `agent_tier: clawdbot`)
