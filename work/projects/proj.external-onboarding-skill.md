---
id: proj.external-onboarding-skill
type: project
primary_charter: chr.community
title: "External Entity Onboarding Skill — DAO-in-a-Box for AI Experiments"
state: Active
priority: 0
estimate: 4
summary: Internet-connected skill file that takes external AI experiment teams from zero to sovereign Cogni node — DAO formation, repo-spec identity, payment activation, and deploy
outcome: External teams invoke a skill that generates their repo-spec.yaml, walks them through DAO formation + payment activation, scaffolds agentic dev tooling, and guides them to first deploy
assignees:
  - cogni-dev
created: 2026-03-22
updated: 2026-03-23
labels:
  - onboarding
  - community
  - skills
  - external
  - payments
  - dao
---

# External Entity Onboarding Skill — DAO-in-a-Box for AI Experiments

> Related: `/node-setup` skill (internal), `proj.ai-operator-wallet`, `proj.transparent-credit-payouts`

## Goal

Many AI experiments want to become DAOs. Their engineering teams need a turnkey path from "we have a repo" to "we're a deployed, sovereign Cogni node with active billing." The **center of gravity** is the DAO identity (`repo-spec.yaml`) and the billing pipeline (Split contract + USDC credit top-ups) — everything else (work management, agent config, CI) is secondary scaffolding.

Today, `/node-setup` is internal-only and assumes the operator is already inside a cogni-template fork. This project creates an **external-facing skill** delivered via: **online skill -> sandbox -> git -> main**.

The skill must work for teams with zero Cogni context. It must be opinionated about the economic foundation (DAO + payments are non-negotiable) but flexible about their existing codebase structure.

## Roadmap

### Crawl (P0) — Repo-Spec Generation + DAO Formation + Payment Activation

**Goal:** A self-contained, internet-fetchable skill file that generates `repo-spec.yaml`, walks the team through DAO formation, and activates the billing pipeline. This is the economic spine — without it, the node can't receive payments or govern itself.

| Deliverable                                                                                                                                                 | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Audit `/node-setup` SKILL.md — extract the DAO + payments flow as standalone                                                                                | Not Started | 1   | —         |
| Skill Phase 1: generate `.cogni/repo-spec.yaml` with `node_id`, `scope_id`, `scope_key`, `cogni_dao`                                                        | Not Started | 2   | —         |
| Skill Phase 2: DAO formation — link to cognidao.org/setup/dao wizard, capture contract addresses back into repo-spec                                        | Not Started | 2   | —         |
| Skill Phase 3: operator wallet — Privy setup, `operator_wallet.address` into repo-spec                                                                      | Not Started | 1   | —         |
| Skill Phase 4: payment activation — `node:activate-payments`, Split contract deploy, `payments.status: active` + `payments_in.credits_topup` into repo-spec | Not Started | 2   | —         |
| Skill Phase 5: governance schedules — configure `governance.schedules[]` (charters, crons, entrypoints)                                                     | Not Started | 1   | —         |
| Repo-spec validation gate: skill runs `@cogni/repo-spec` schema validation after each phase                                                                 | Not Started | 1   | —         |
| Host skill file at stable URL (GitHub raw or docs site)                                                                                                     | Not Started | 1   | —         |
| Test: fresh repo + skill invocation produces valid `repo-spec.yaml` that passes schema validation                                                           | Not Started | 2   | —         |

### Walk (P1) — Subdir Scaffold + Agentic Dev Tooling + Sandbox Delivery

**Goal:** With billing active, scaffold the rest: agentic dev config (Claude Code + Codex), node-template subdir layout, and sandbox-delivered interactive onboarding.

| Deliverable                                                                                                      | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Subdir scaffold: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `work/`, `docs/` layout                                   | Not Started | 2   | (create at P1 start) |
| Agentic dev setup: generate CLAUDE.md + codex.md tailored to their project (depends on `proj.agentic-dev-setup`) | Not Started | 2   | (create at P1 start) |
| Activity ledger config: `activity_ledger` section in repo-spec (epoch length, sources, pool config)              | Not Started | 1   | (create at P1 start) |
| PR review gates: `gates[]` config in repo-spec (review-limits, ai-rule)                                          | Not Started | 1   | (create at P1 start) |
| OpenClaw workspace config for interactive onboarding agent (SOUL.md + channel routing)                           | Not Started | 2   | (create at P1 start) |
| Sandbox agent drives the onboarding conversation, produces PR to external repo via git relay                     | Not Started | 3   | (create at P1 start) |
| Test: end-to-end sandbox onboarding of a fresh GitHub repo through to `payments.status: active`                  | Not Started | 3   | (create at P1 start) |

### Run (P2+) — Self-Service Portal + Infrastructure Provisioning

**Goal:** External entities self-serve through a web portal. The skill extends to cover infrastructure provisioning and deployment.

| Deliverable                                                                                    | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Web portal: "Start your DAO" flow (form -> sandbox session -> PR with repo-spec)               | Not Started | 3   | (create at P2 start) |
| Infrastructure provisioning: VM setup, SSH keys, DNS (extracted from `/node-setup` Phases 4-7) | Not Started | 3   | (create at P2 start) |
| GitHub Secrets automation: CI/CD secret injection for preview + production envs                | Not Started | 2   | (create at P2 start) |
| Post-onboarding health: verify deploy, DNS, payments active, `/readyz` returns 200             | Not Started | 2   | (create at P2 start) |
| Skill versioning: external teams pin to a skill version, get upgrade notifications             | Not Started | 2   | (create at P2 start) |
| Partnership tracking: which entities onboarded, node status, payment activity                  | Not Started | 2   | (create at P2 start) |

## Constraints

- The skill file must be fully self-contained — no dependencies on being inside this repo at invocation time
- Skill must work with both Claude Code and Codex (no tool-specific assumptions beyond file read/write/shell)
- External teams keep sovereignty over their repo — the skill scaffolds into their repo, it does not take over root
- `repo-spec.yaml` schema is the contract — skill output must pass `@cogni/repo-spec` Zod validation
- Skill must not embed secrets, API keys, or credentials — only prompt for them interactively
- DAO formation + payment activation are P0 — everything else (work management, CI, agent config) is P1+
- The sandbox delivery path (P1) reuses existing OpenClaw + git relay infrastructure from `proj.sandboxed-agents`

## Dependencies

- [ ] `/node-setup` SKILL.md — existing skill to audit and extract from
- [ ] `@cogni/repo-spec` package — Zod schema for repo-spec validation (exists, stable)
- [ ] DAO formation wizard at cognidao.org/setup/dao — must be publicly accessible
- [ ] `node:activate-payments` command — must work outside cogni-template fork context
- [ ] `proj.sandboxed-agents` — git relay for sandbox -> PR pipeline (P1)
- [ ] `proj.agentic-dev-setup` — agentic tooling setup section of the skill (P1)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### The repo-spec is the identity spine

Everything flows from `.cogni/repo-spec.yaml`:

```yaml
node_id: "uuid" # Unique node identity — scopes all DB tables
scope_id: "uuid" # Stable opaque scope — DB FK
scope_key: "my-project" # Human-friendly slug

cogni_dao:
  chain_id: "8453" # Base mainnet
  dao_contract: "0x..." # DAO address (from formation wizard)
  plugin_contract: "0x..."
  signal_contract: "0x..."

operator_wallet:
  address: "0x..." # Privy-managed operator wallet

payments:
  status: active # pending_activation -> active

payments_in:
  credits_topup:
    provider: "cogni-usdc-backend-v1"
    receiving_address: "0x..." # Split contract (DAO wallet)
    allowed_chains: ["Base"]
    allowed_tokens: ["USDC"]

governance:
  schedules:
    - charter: ENGINEERING
      cron: "0 9 * * 1"
      timezone: UTC
      entrypoint: heartbeat
```

Without this file, nothing works — no billing, no governance, no identity. The skill's P0 job is to generate this file correctly for an external team's context.

### Tool source port pipeline: online skill -> sandbox -> git -> main

1. **Online skill** — Markdown file at stable URL. External team's agent fetches it.
2. **Sandbox** — OpenClaw agent loads the skill, drives interactive onboarding.
3. **Git** — Sandbox produces PR to external repo via git relay.
4. **Main** — Team reviews, merges. They now have a sovereign node identity.

### Payment activation is non-negotiable in P0

The whole point of becoming a Cogni DAO is economic sovereignty. A node without active payments is just a repo with a config file. The skill must guide teams through:

1. Privy operator wallet setup (3 credentials: App ID, App Secret, Signing Key)
2. `node:activate-payments` command (deploys Split contract on Base)
3. Verification: `payments.status: active` in repo-spec

This is the hard part — it involves real money, real contracts, real keys. The skill must be extremely clear about what each step does and what can go wrong.

### Why a skill file, not a CLI tool?

1. **Zero install** — team points their existing AI agent at a URL
2. **Agent-native** — markdown instructions, the language agents understand
3. **Dual-runtime** — works with Claude Code (SKILL.md) and Codex (AGENTS.md) without separate tooling
4. **Updatable** — change the hosted file, all future invocations get the update

### Relationship to `/node-setup`

`/node-setup` is the internal skill for operators already inside a cogni-template fork. This new skill is the **pre-fork** path for external repos. After P0 (repo-spec + DAO + payments), the external team has a sovereign node. P1 adds the development scaffolding. P2 adds infrastructure provisioning (which is where `/node-setup` Phases 4-7 get reused).
