---
id: proj.agentic-dev-setup
type: project
primary_charter: chr.engineering
title: "Agentic Dev Setup — Clawdbot Steers, Codex + Claude Code Implement"
state: Active
priority: 0
estimate: 5
summary: Establish the three-tier agentic development model where AI/Clawdbot acts as research lead and steering agent, while Codex and Claude Code serve as parallel implementation agents
outcome: A documented, reproducible agentic development setup where Clawdbot drives research/planning/partnership, Codex handles async background implementation, and Claude Code handles interactive implementation — all coordinated through shared work items and git conventions
assignees:
  - cogni-dev
created: 2026-03-22
updated: 2026-03-22
labels:
  - agentic-dev
  - codex
  - claude-code
  - openclaw
  - workflow
---

# Agentic Dev Setup — Clawdbot Steers, Codex + Claude Code Implement

> Related: `proj.development-workflows`, `proj.agentic-project-management`, `proj.sandboxed-agents`, `proj.external-onboarding-skill`

## Goal

Establish a three-tier agentic development model:

1. **Clawdbot (OpenClaw)** — The research lead and steering agent. Conducts deep research, evaluates options, writes specs, creates work items, manages partnerships and external entity onboarding. Runs autonomously as a long-running gateway agent.
2. **Codex (OpenAI)** — Async background implementer. Takes well-scoped tasks, works in isolated environments, produces PRs. Best for parallelizable, well-defined implementation work.
3. **Claude Code (Anthropic)** — Interactive implementer. Pair-programs with human operators, handles complex multi-file changes, runs in the developer's terminal. Best for nuanced, context-heavy work.

The key insight: **Clawdbot steers, Codex and Claude Code row.** The AI research/partnership layer operates at a different cadence and context level than the implementation layer. This project defines the handoff protocols, shared state conventions, and tooling that make this three-tier model work.

## Roadmap

### Crawl (P0) — Define the Agent Roles + Shared Conventions

**Goal:** Document the three-tier model, establish shared conventions for work items and git branches, configure each agent runtime.

| Deliverable                                                                                                      | Status      | Est | Work Item |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Role spec: define Clawdbot's responsibilities (research, specs, work items, partnership, steering)               | Not Started | 2   | —         |
| Role spec: define Codex's responsibilities (async implementation, isolated PRs, test-driven)                     | Not Started | 1   | —         |
| Role spec: define Claude Code's responsibilities (interactive implementation, complex changes, pair-programming) | Not Started | 1   | —         |
| Handoff protocol: how Clawdbot creates work items that Codex/Claude can pick up                                  | Not Started | 2   | —         |
| Git convention: branch naming, commit attribution, PR templates per agent type                                   | Not Started | 1   | —         |
| Codex setup: `codex.md` / `AGENTS.md` config that gives Codex the right context for this repo                    | Not Started | 2   | —         |
| Claude Code setup: verify `.claude/` skills and settings are optimized for the implementer role                  | Not Started | 1   | —         |
| Clawdbot setup: OpenClaw SOUL.md + channel config for the steering/research role                                 | Not Started | 2   | —         |
| Test: Clawdbot creates a work item -> Codex picks it up -> produces a PR                                         | Not Started | 3   | —         |

### Walk (P1) — Parallel Execution + Coordination

**Goal:** Multiple agents work in parallel on different tasks. Coordination happens through work items and git, not direct agent-to-agent communication.

| Deliverable                                                                                                           | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Codex task queue: Clawdbot writes tasks, Codex worker polls and executes                                              | Not Started | 3   | (create at P1 start) |
| Claude Code task integration: `/implement` skill reads from shared work items                                         | Not Started | 1   | (create at P1 start) |
| Conflict prevention: branch reservation system so Codex and Claude don't collide                                      | Not Started | 2   | (create at P1 start) |
| Result validation: automated checks on agent-produced PRs before human review                                         | Not Started | 2   | (create at P1 start) |
| Research pipeline: Clawdbot conducts deep research, writes findings to `docs/research/`, creates implementation tasks | Not Started | 2   | (create at P1 start) |
| Partnership pipeline: Clawdbot engages external entities, runs onboarding skill, tracks partnership status            | Not Started | 3   | (create at P1 start) |
| Observability: which agent produced which PR, cost per agent, success rate                                            | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Coordination + External Teams

**Goal:** The three-tier model works for external teams too. Agents coordinate autonomously with human oversight at approval gates only.

| Deliverable                                                                                                        | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| External team setup: the onboarding skill (from `proj.external-onboarding-skill`) configures all three agent tiers | Not Started | 2   | (create at P2 start) |
| Clawdbot-to-Clawdbot: steering agents across different Cogni nodes coordinate on shared initiatives                | Not Started | 3   | (create at P2 start) |
| Agent dispatch UI: human picks agent runtime (Clawdbot/Codex/Claude) per work item from dashboard                  | Not Started | 3   | (create at P2 start) |
| Autonomous task decomposition: Clawdbot breaks down projects into Codex-sized tasks without human intervention     | Not Started | 3   | (create at P2 start) |
| Cross-node PR review: agents on one node review PRs from agents on another                                         | Not Started | 2   | (create at P2 start) |

## Constraints

- Each agent tier must be independently usable — a team can start with just Claude Code and add Codex/Clawdbot later
- Codex setup must work with OpenAI's Codex CLI conventions (`AGENTS.md` / `codex.md` at repo root)
- Claude Code setup must work with Anthropic's conventions (`.claude/` dir, `CLAUDE.md`, skills)
- Clawdbot setup must work with OpenClaw conventions (SOUL.md, channel config, workspaces)
- All agent outputs flow through git — no proprietary sync protocols between agents
- Human approval gates required for: merges to main/staging, infrastructure changes, spending above threshold
- The model must work for a solo developer (one human + three agent tiers) and scale to teams

## Dependencies

- [ ] `proj.sandboxed-agents` — OpenClaw sandbox infrastructure for Clawdbot
- [ ] `proj.agentic-project-management` — WorkItemPort for structured task handoff
- [ ] `proj.external-onboarding-skill` — external teams need this to set up the three-tier model
- [ ] `proj.development-workflows` — git conventions, PR linkage format
- [ ] OpenAI Codex CLI — must be GA and stable enough to depend on
- [ ] Anthropic Claude Code CLI — must support the skill/settings patterns we define

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why three tiers, not two?

The naive model is "AI writes code, human reviews." This fails at scale because:

1. **Research and implementation are different skills.** Clawdbot does deep research (web search, paper reading, competitive analysis, partnership outreach) that implementation agents shouldn't be distracted by. Implementation agents need focused, well-scoped tasks.
2. **Async and interactive are different workflows.** Codex excels at "here's a task, come back with a PR" — no human in the loop during execution. Claude Code excels at "let's figure this out together" — tight feedback loop with the developer. Using one for both wastes the other's strengths.
3. **Steering is continuous, implementation is episodic.** Clawdbot monitors the project state continuously (roadmap progress, external signals, partnership opportunities). Implementation agents spin up, do work, spin down.

### Handoff protocol (draft)

```
Clawdbot                    Work Items                 Codex / Claude Code
   |                            |                            |
   |-- creates task.XXXX ------>|                            |
   |   (with spec refs,         |                            |
   |    acceptance criteria,     |                            |
   |    estimated complexity)    |                            |
   |                            |<--- claims task -----------|
   |                            |     (sets assignee,        |
   |                            |      creates branch)       |
   |                            |                            |
   |                            |<--- updates status --------|
   |                            |     (in_progress ->        |
   |                            |      needs_review)         |
   |                            |                            |
   |<-- reviews PR -------------|                            |
   |   (validates against spec, |                            |
   |    checks acceptance       |                            |
   |    criteria)               |                            |
```

Work items are the coordination primitive. No direct agent-to-agent messaging in P0.

### Codex vs Claude Code: when to use which

| Signal                                                   | Use Codex      | Use Claude Code  |
| -------------------------------------------------------- | -------------- | ---------------- |
| Task is well-scoped with clear acceptance criteria       | Yes            | Okay             |
| Task requires multi-file refactoring with judgment calls | No             | Yes              |
| Multiple independent tasks can run in parallel           | Yes            | No (one session) |
| Task requires reading external docs or APIs              | Yes (internet) | Yes (internet)   |
| Task requires human input mid-execution                  | No             | Yes              |
| Task requires running the dev stack interactively        | No             | Yes              |
| Task is exploratory / "figure out the right approach"    | No             | Yes              |

### Clawdbot's steering responsibilities

1. **Research** — Deep dives on technologies, protocols, competitive landscape. Writes to `docs/research/`.
2. **Spec authoring** — Translates research into specs with invariants and acceptance criteria.
3. **Task decomposition** — Breaks specs into implementation tasks sized for Codex (small, isolated) or Claude Code (larger, contextual).
4. **Partnership** — Engages external AI experiments about becoming DAOs. Runs the onboarding skill. Tracks relationship status.
5. **Roadmap management** — Updates project deliverable tables, flags blockers, reprioritizes based on signals.
6. **Review** — Validates agent-produced PRs against specs and acceptance criteria.

### Configuration files per agent

**Codex** — needs at repo root:

- `AGENTS.md` or `codex.md` — repo context, conventions, how to run tests
- Access to `work/` for task discovery
- Access to `docs/spec/` for implementation contracts

**Claude Code** — needs in `.claude/`:

- `CLAUDE.md` — already exists, covers repo conventions
- `.claude/skills/` — implementation skills (`/implement`, `/test`, `/closeout`)
- `.claude/settings.json` — permissions, hooks

**Clawdbot (OpenClaw)** — needs in sandbox workspace:

- `SOUL.md` — steering persona, research methodology, partnership protocols
- Channel config — routing for different responsibility areas
- `memorySearch` config — access to work items and specs for context
