---
id: agents-md-root-design-research
type: research
title: "Research: Root AGENTS.md Design + Definition-of-Done Directive"
status: active
trust: draft
summary: External guidance survey (agents.md spec, Karpathy, Boris Cherny) plus gap analysis of current root AGENTS.md, proposing a restructured root file that makes the lifecycle + candidate-a validation the single non-negotiable definition of done.
read_when: Rewriting the root AGENTS.md, onboarding new agent types, or debating what belongs in the repo-wide metaprompt vs. subdir/guide/spec docs.
owner: derekg1729
created: 2026-04-19
verified: 2026-04-19
tags: [agents-md, meta, lifecycle, definition-of-done]
---

# Research: Root AGENTS.md Design + Definition-of-Done Directive

> spike: ad-hoc (no work item) | date: 2026-04-19

## Question

What should the root `AGENTS.md` of this repo look like, drawing on (a) the `agents.md` open spec, (b) Andrej Karpathy's LLM-coding principles, (c) Boris Cherny's Claude Code team tips, and (d) our own `docs/spec/development-lifecycle.md` + `docs/spec/ci-cd.md` + `docs/guides/agent-api-validation.md`? Specifically: **how do we embed the directive that an agent's work is not "done" until it has been flighted to `candidate-a` and validated end-to-end?**

## Context

- Root file today: `AGENTS.md` (105 lines) — `CLAUDE.md` is a symlink to it. Below it: 29+ subdir `AGENTS.md` files inheriting a template at `docs/templates/agents_subdir_template.md`.
- Current root covers: mission, workflow principles, agent behavior, environment, API-contracts rule, pointers, `pnpm` command catalog.
- **Gap**: it does not mention the lifecycle (`/triage → /design → /implement → /closeout → /review-implementation`), does not reference the `deploy_verified` gate, does not say "your PR is not done until it has been flighted to `candidate-a` and validated," and does not point agents at `agent-api-validation.md` or the `## Validation` block required by `VALIDATION_REQUIRED` in `development-lifecycle.md`.
- Today a typical agent stops at "tests pass + PR merged" (status = `done`). Our specs already treat that as only the _code_ gate — the flight + QA gate (`deploy_verified: true`) is the real E2E contract but lives in specs that the agent may never read.

---

## Findings

### 1. External guidance (what the world says)

| Source                                                                                                                                                       | Core guidance                                                                                                                                                                                                                                                                                                                     | Takeaway for us                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agents.md` spec](https://agents.md/) (Linux Foundation / Agentic AI Foundation, adopted by Codex, Cursor, Factory, Amp, Jules, Windsurf; 60k+ repos)       | No required fields. Popular sections: overview, build/test, style, testing, security, PR instructions, commit conventions, deployment. Nested files — closest wins.                                                                                                                                                               | Our multi-level `AGENTS.md` tree is already spec-aligned. Keep root minimal and orientation-focused; push specifics down.                                                                                                                                                              |
| [Karpathy's CLAUDE.md](https://github.com/forrestchang/andrej-karpathy-skills) (~30k stars)                                                                  | Four principles: **Think Before Coding** (state assumptions, surface ambiguity), **Simplicity First** (no speculative abstractions, no error handling for impossible cases), **Surgical Changes** (touch only what the task demands), **Goal-Driven Execution** (convert tasks into verifiable success criteria + loop to green). | We already have most of these in `CLAUDE.md` under different wording. Missing: the explicit "convert task → verifiable goal + loop" framing — which maps _exactly_ to our `## Validation` block + `deploy_verified` loop.                                                              |
| [Boris Cherny's tips](https://gist.github.com/joyrexus/e20ead11b3df4de46ab32b4a7269abe0) + [howborisusesclaudecode.com](https://howborisusesclaudecode.com/) | Target **≤200 lines** (Boris's own is ~100). Treat as a **living rule set** — after each mistake, tell the agent to update it. Use plan mode for intent-before-action. **Give the agent a way to verify its output** — that single step is what lets it iterate to great. Use worktrees + subagents to parallelize.               | Our 150-line ceiling is on-target. We already push "`pnpm check` as pre-commit gate" — we have a verification loop for _code_. We're missing the verification loop for _feature behavior post-deploy_, which is precisely what `agent-api-validation.md` + candidate-a flight provide. |
| [2026 research on LLM-generated context files](https://vibecoding.app/blog/agents-md-review)                                                                 | LLM-generated `AGENTS.md` hurts: 5/8 settings saw lower success rates, +2.4–3.9 steps per task, +20–23% inference cost.                                                                                                                                                                                                           | Root `AGENTS.md` must be **hand-curated, short, opinionated**. No autogenerated boilerplate.                                                                                                                                                                                           |

### 2. Our own contract (what our specs already say is "done")

From `docs/spec/development-lifecycle.md`:

- **Lifecycle**: every `needs_*` status maps to exactly one `/command`.
- **Invariant `VALIDATION_REQUIRED`**: every task/bug must have a `## Validation` section with `exercise:` + `observability:` before `/closeout` creates the PR.
- **Invariant `DEPLOY_VERIFIED_SEPARATE`**: `status: done` = PR merged (code gate). `deploy_verified: true` = qa-agent confirmed post-flight (candidate-a health + feature exercise + Loki signal). **Never conflate.**
- **Invariant `FEATURE_SMOKE_SCOPED`**: qa-agent validation must exercise the specific feature, not generic `/readyz`.

From `docs/spec/ci-cd.md`:

- Axiom 3: pre-merge safety happens in `candidate-*` slots.
- Minimum authoritative validation for v0 (§ "Minimum Authoritative Validation"): affected-only checks + build + Argo reconciled Healthy + rollout clean + smoke pack + contract probe (`/version.buildSha == map[app]`).

From `docs/guides/agent-api-validation.md`:

- The agent-first flow is: **discover → register → auth → execute → list runs → stream events** with no browser session.
- Proof criteria include metering path recorded downstream.

**Synthesis**: the three docs already define a precise definition of done. What's missing is the _callout_ at the top of the agent's orientation file that makes this the first and last thing the agent sees.

### 3. Current root `AGENTS.md` — gap analysis

| What's there                                   | What's missing                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Mission, principles, command catalog, pointers | No lifecycle pointer. No mention of `/triage`, `/implement`, `/closeout`, `/review-implementation`.                     |
| "Validate once before commit" (code gate)      | No "your PR is not done until flighted and validated" (deploy gate).                                                    |
| Pointers to architecture, testing, AI pipeline | No pointer to `agent-api-validation.md` as the reference validation contract.                                           |
| Workflow principles                            | No "Goal-Driven Execution" framing — the `## Validation` block is our goal-driven verification loop but isn't surfaced. |
| 105 lines (under the 150 ceiling)              | Command catalog eats ~40 lines and rots; should move to a guide.                                                        |

---

## Recommendation

**Restructure the root `AGENTS.md` around three anchors**: (1) the lifecycle is the workflow, (2) `## Validation` + candidate-a flight is the definition of done, (3) everything else is a pointer.

### Proposed structure (≤150 lines, target ~120)

```
# AGENTS.md — Cogni-Template

> Every agent arriving at this repo reads this file first. Subdirs extend; they do not override.

## Mission
(3–4 lines — unchanged)

## Definition of Done  ← NEW, top-of-fold
Your work is not "done" until ALL of the following hold:
  1. Work item moved through the full lifecycle: /triage → (/design) → /implement → /closeout → /review-implementation.
  2. `## Validation` block with `exercise:` + `observability:` committed before /closeout creates the PR. (See VALIDATION_REQUIRED.)
  3. PR merged to main → promoted to candidate-a via flight.
  4. `deploy_verified: true` set on the work item: candidate-a healthy, feature exercise passes, observability signal confirmed in Loki at the deployed SHA.
Reference validation patterns:
  - HTTP/API features → docs/guides/agent-api-validation.md
  - Other surfaces (CLI, graph, scheduler, infra) → the analog listed in docs/spec/development-lifecycle.md § Feature Validation Contract.
`status: done` alone is not enough. `deploy_verified: true` is the real gate.

## Core Principles (tight — Karpathy-aligned)
- Think before coding: state assumptions, surface ambiguity, push back on over-scope.
- Simplicity first: no speculative abstraction, no error handling for impossible cases.
- Surgical changes: touch only what the task demands; mention drive-by issues, don't fix them.
- Goal-driven execution: convert every task into a verifiable `## Validation` block and loop to green.
- Spec first, port don't rewrite, prune aggressively, delegate cleanly.

## Verification Loop (Boris-aligned)
- During iteration: `pnpm check:fast` (auto-fixes lint/format).
- Pre-commit: `pnpm check` — once, never repeated.
- Pre-merge: CI runs `pnpm check:full`; stack tests are the required gate.
- Post-merge: candidate-a flight + qa-agent exercise + Loki confirmation. `deploy_verified: true` closes the loop.

## Agent Behavior
(5–6 lines — unchanged, plus: "Use git worktrees for isolated work — never checkout/stash on user's main worktree.")

## Environment
(unchanged, 5 lines)

## API Contracts are the Single Source of Truth
(unchanged, 4 lines)

## Pointers
- Lifecycle: docs/spec/development-lifecycle.md  ← NEW, top of list
- CI/CD + candidate-a model: docs/spec/ci-cd.md  ← NEW
- Agent validation reference: docs/guides/agent-api-validation.md  ← NEW
- Architecture, feature-dev guide, common mistakes, testing, style, AI pipeline, work management, subdir template (existing)
- Command catalog: docs/guides/dev-commands.md  ← MOVED (was inline)

## Usage (trimmed)
Three commands only:
  pnpm dev:stack          — primary dev loop
  pnpm check:fast         — iteration gate
  pnpm check              — pre-commit gate
Full catalog → docs/guides/dev-commands.md.
```

### Trade-offs accepted

- **Move the command catalog out**: saves ~35 lines, lets the catalog evolve without churning the root file. Mild cost: one extra click for agents that want the full list.
- **New `## Definition of Done` section** intentionally duplicates a slice of `development-lifecycle.md` and `ci-cd.md`. This is deliberate: the root file is the one place every agent reads; the duplication is the point. Drift risk is low because the section is 4 bullets pointing at the authoritative specs.
- **Loses some prose** on "workflow guiding principles" — folded into tighter Karpathy-style principles. Mild cost: some nuance ("port don't rewrite") gets compressed.

### What stays out (explicitly)

- Tool-specific agent skills or subagent catalogs — belong in `.claude/commands/`, `.openclaw/skills/`, or subdir `AGENTS.md`.
- Full command catalog — moves to `docs/guides/dev-commands.md`.
- Any roadmap / phased plan / open questions — belongs in project docs per `SPEC_NO_EXEC_PLAN`.

## Open Questions

- [ ] Should the `## Definition of Done` reference `deploy_verified` by name even though the field may still be aspirational for some agent types (e.g. docs-only PRs)? Leaning yes — the section can carve out "docs-only / `Spec-Impact: none` exempts you from deploy_verified but not from /closeout + /review-implementation."
- [ ] Do we want a short "AGENTS.md mistakes we've made" log at the bottom (Boris-style "update after each correction")? Pro: captures institutional memory. Con: magnet for drift — 150-line ceiling will erode. Alternative: dedicated `docs/guides/common-mistakes.md` (already exists) stays authoritative; root just points.
- [ ] Should `CLAUDE.md` stop being a symlink and become a separate Claude-Code-specific file (tool-specific agent preferences like permission settings), leaving `AGENTS.md` as the spec-compliant universal file? Today the symlink works because contents are 100% overlap. If Claude Code ever needs divergent rules (e.g. hook config guidance), split.
- [ ] `dev-commands.md` doesn't exist yet. Creating it is the cost of the recommendation.

## Proposed Layout

This research is directional, not a binding plan. If we pursue this:

- **Project**: likely no new project needed — fits under existing `proj.docs-system-infrastructure` or `proj.development-workflows`.
- **Specs**: no new spec. The research confirms `development-lifecycle.md` + `ci-cd.md` + `agent-api-validation.md` are already the authoritative trio; the root `AGENTS.md` should point at them, not duplicate them (beyond the Definition-of-Done summary).
- **Tasks (rough sequence, PR-sized)**:
  1. `task.*`: Rewrite root `AGENTS.md` per the structure above. Validate with `pnpm check:docs`. Check that all subdir `AGENTS.md` still inherit coherently.
  2. `task.*`: Create `docs/guides/dev-commands.md` as the new home for the command catalog. Move current inline block verbatim.
  3. (Optional) `task.*`: Add a CI lint that fails if the root `AGENTS.md` exceeds 150 lines or is missing a `## Definition of Done` heading.
  4. (Optional) `spike.*`: Decide whether to split `CLAUDE.md` from `AGENTS.md` (currently symlinked). Only if we find a Claude-Code-specific divergence worth encoding.

## References

- [agents.md open spec](https://agents.md/) · [GitHub](https://github.com/agentsmd/agents.md)
- [Karpathy's CLAUDE.md — forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)
- [Boris Cherny's Claude Code team tips](https://gist.github.com/joyrexus/e20ead11b3df4de46ab32b4a7269abe0) · [howborisusesclaudecode.com](https://howborisusesclaudecode.com/)
- [Building Claude Code with Boris Cherny — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [2026 review: LLM-generated AGENTS.md hurts performance](https://vibecoding.app/blog/agents-md-review)
- Internal: `docs/spec/development-lifecycle.md`, `docs/spec/ci-cd.md`, `docs/guides/agent-api-validation.md`, `docs/templates/agents_subdir_template.md`
