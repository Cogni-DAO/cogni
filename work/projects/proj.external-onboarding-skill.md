---
id: proj.external-onboarding-skill
type: project
primary_charter: chr.community
title: "External Entity Onboarding Skill — DAO-in-a-Box for AI Experiments"
state: Active
priority: 0
estimate: 4
summary: Internet-connected skill file + node-template subdir scaffold that gives external AI experiment teams the keys to becoming a Cogni DAO — from repo setup through deployment
outcome: External teams can invoke a single skill (online or sandbox-delivered) that scaffolds their repo, configures their DAO identity, sets up agentic dev tooling, and guides them to first deploy
assignees:
  - cogni-dev
created: 2026-03-22
updated: 2026-03-22
labels:
  - onboarding
  - community
  - skills
  - external
---

# External Entity Onboarding Skill — DAO-in-a-Box for AI Experiments

> Related: `/node-setup` skill (internal), `proj.agentic-interop`, `proj.oss-research-node`

## Goal

Many AI experiments want to become DAOs. Their engineering teams need a turnkey path from "we have a repo" to "we're a deployed, sovereign Cogni node." Today, `/node-setup` is internal-only and assumes the operator is already inside this repo. This project creates an **external-facing skill** that can be delivered as an internet-accessible file, run through a sandbox (OpenClaw), ported into their git repo, and maintained on their main branch — a complete **online skill -> sandbox -> git -> main** pipeline.

The skill must work for teams with zero Cogni context. It should be opinionated about structure (node-template subdir layout) but flexible about their existing codebase. It's the "keys to success" document for external engineering teams.

## Roadmap

### Crawl (P0) — Standalone Skill File + Subdir Scaffold

**Goal:** A single, internet-accessible skill markdown file that an external team can point Claude Code or Codex at. It scaffolds the Cogni node-template subdir structure into their existing repo and walks them through DAO formation.

| Deliverable                                                                                                 | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Audit `/node-setup` SKILL.md — extract what's reusable vs internal-only                                     | Not Started | 1   | —         |
| Define the node-template subdir layout (`.cogni/`, `work/`, `docs/`, `CLAUDE.md`, `AGENTS.md`, infra/)      | Not Started | 2   | —         |
| Write `external-onboarding.skill.md` — self-contained, internet-fetchable skill file                        | Not Started | 3   | —         |
| Skill covers: repo identity injection, `.cogni/repo-spec.yaml` generation, DAO wizard link, env scaffolding | Not Started | 2   | —         |
| Skill covers: CLAUDE.md + AGENTS.md generation tailored to their project                                    | Not Started | 2   | —         |
| Skill covers: agentic dev setup (both Claude Code and Codex entry points)                                   | Not Started | 2   | —         |
| Host skill file at a stable URL (GitHub raw or docs site)                                                   | Not Started | 1   | —         |
| Test: fresh repo + skill invocation produces valid scaffold that passes `pnpm check:docs` equivalent        | Not Started | 2   | —         |

### Walk (P1) — Sandbox Delivery + Interactive Onboarding

**Goal:** External teams can onboard through a sandbox OpenClaw session that runs the skill interactively, producing a PR to their repo.

| Deliverable                                                                            | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| OpenClaw workspace config for onboarding agent (SOUL.md + channel routing)             | Not Started | 2   | (create at P1 start) |
| Sandbox agent reads the external skill file and drives the conversation                | Not Started | 2   | (create at P1 start) |
| Git relay integration: sandbox produces a PR to the external team's repo               | Not Started | 2   | (create at P1 start) |
| Interactive credential collection: prompt for API keys, wallet addresses, domain names | Not Started | 1   | (create at P1 start) |
| Onboarding status dashboard: track which phases the entity has completed               | Not Started | 2   | (create at P1 start) |
| Test: end-to-end sandbox onboarding of a fresh GitHub repo                             | Not Started | 3   | (create at P1 start) |

### Run (P2+) — Self-Service Portal + Partnership Pipeline

**Goal:** External entities can self-serve through a web portal. The onboarding skill evolves into a partnership pipeline.

| Deliverable                                                                                      | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Web portal: "Start your DAO" flow (form -> sandbox session -> PR)                                | Not Started | 3   | (create at P2 start) |
| Skill versioning: external teams pin to a skill version, get upgrade notifications               | Not Started | 2   | (create at P2 start) |
| Post-onboarding health checks: verify deployment, DNS, payments are active                       | Not Started | 2   | (create at P2 start) |
| Partnership tracking: which entities onboarded, their node status, contribution metrics          | Not Started | 2   | (create at P2 start) |
| Skill auto-update: when node-template evolves, downstream skill consumers get migration guidance | Not Started | 3   | (create at P2 start) |

## Constraints

- The skill file must be fully self-contained — no dependencies on being inside this repo at invocation time
- Skill must work with both Claude Code and Codex (no tool-specific assumptions beyond file read/write/shell)
- External teams keep sovereignty over their repo — the skill scaffolds a subdir, it does not take over root
- Node-template subdir layout must be stable and documented before the skill references it
- Skill must not embed secrets, API keys, or credentials — only prompt for them interactively
- The sandbox delivery path (P1) reuses existing OpenClaw + git relay infrastructure from `proj.sandboxed-agents`

## Dependencies

- [ ] `/node-setup` SKILL.md — existing skill to audit and extract from
- [ ] `proj.sandboxed-agents` — git relay for sandbox -> PR pipeline (P1)
- [ ] `.cogni/repo-spec.yaml` schema — must be stable before external teams depend on it
- [ ] DAO formation wizard at cognidao.org/setup/dao — must be publicly accessible
- [ ] `proj.agentic-dev-setup` — agentic tooling setup section of the skill depends on this project's outputs

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Tool source port pipeline: online skill -> sandbox -> git -> main

The delivery pipeline has four stages:

1. **Online skill** — A markdown file hosted at a stable URL. External team fetches it (or their agent does). Contains all instructions for scaffolding a Cogni node inside their repo.
2. **Sandbox** — An OpenClaw agent loads the skill and drives the onboarding conversation interactively. Asks questions, fills templates, validates structure.
3. **Git** — The sandbox produces changes via the git relay (from `proj.sandboxed-agents`). Creates a PR to the external team's repo with the scaffolded structure.
4. **Main** — Team reviews and merges. They now have the node-template subdir in their repo and can run `/node-setup` locally for the remaining infra phases.

### Node-template subdir layout (draft)

When injected into an external repo, the Cogni scaffold creates:

```
their-repo/
  .cogni/
    repo-spec.yaml          # DAO identity, payments config
  .claude/
    skills/                  # Skill files for their agents
    settings.json            # Claude Code permissions + hooks
  work/
    projects/                # Their roadmap
    _templates/              # Work item templates
  docs/
    AGENTS.md                # Root agent instructions
    guides/                  # Operational guides
  CLAUDE.md                  # Agent entry point
  AGENTS.md                  # Subdir agents (if monorepo)
```

This mirrors the cogni-template structure but scoped to a subdir that doesn't conflict with their existing project layout.

### Why a skill file, not a CLI tool?

1. **Zero install** — the team just points their existing AI agent at a URL
2. **Agent-native** — the skill speaks the language agents already understand (markdown instructions)
3. **Composable** — skills can reference other skills, build on each other
4. **Updatable** — change the hosted file, all future invocations get the update
5. **Dual-runtime** — works with Claude Code (SKILL.md convention) and Codex (AGENTS.md convention) without separate tooling

### Relationship to `/node-setup`

`/node-setup` is the internal skill for operators who've already forked cogni-template. This new skill is the **pre-fork** path: it brings the template to an existing external repo. After P0 scaffolding, the external team can then use `/node-setup` for the remaining infrastructure phases (payments, VMs, deploy).
