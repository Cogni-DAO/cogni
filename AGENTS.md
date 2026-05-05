# AGENTS.md — Cogni-Template

> Scope: repository-wide orientation for all agents. Keep ≤150 lines. Subdir `AGENTS.md` files extend this; they do not override it. Closest file in the tree wins, per the [agents.md open spec](https://agents.md/).

> **You are working inside Cogni.** You are not a free-floating coder — you are an agent inside a multi-agent system, and the **operator** (`https://cognidao.org` / `https://test.cognidao.org`) is your peer coordinator, not a deploy button. Every code-change mission flows through it: claim a work-item session, drive through the [development lifecycle](docs/spec/development-lifecycle.md), and close to `deploy_verified: true`. If you are running on a human's machine with their git/gh credentials, you still claim a session before you push — Conductor / Claude Code sessions are not exempt.

> **If you contribute code in this repo, you follow [the Development Lifecycle](docs/spec/development-lifecycle.md). Full stop.** `/triage → (/design) → /implement → /closeout → /review-implementation`, with a `## Validation` block before `/closeout`, ending in `deploy_verified: true` on candidate-a — proven by you, by hand. Read that spec before opening any PR.

## Mission

A reproducible, open-source foundation for autonomous AI-powered organizations:

- All infra deployable via open tooling (Docker + OpenTofu + Akash)
- All accounting and payments via DAO-controlled crypto wallets
- Strict reproducibility and code discipline across all Cogni repos

## Definition of Done

You are done when **all** of the following are true — not before:

1. **Lifecycle completed** — work item moved through the [`/triage → (/design) → /implement → /closeout → /review-implementation`](docs/spec/development-lifecycle.md) flow. Every `needs_*` status maps to exactly one `/command`.
2. **Validation block committed** — `## Validation` section with `exercise:` + `observability:` is on the work item before `/closeout` creates the PR. (Invariant `VALIDATION_REQUIRED`.)
3. **Code gate green** — PR merged to `main`. `status: done`. _This is only the code gate._
4. **Flight gate green** — promoted to [`candidate-a`](docs/spec/ci-cd.md#environment-model) via flight. Argo `Healthy`, rollout clean, `/version.buildSha` matches the source-sha map.
5. **Feature gate green — by your own hand** — you (or qa-agent) have hit the real candidate-a URL with the `exercise:` from your validation block, got the expected response, and queried Loki for the observability signal at the deployed SHA and seen _your own request_ in the logs. Post the `/validate-candidate` scorecard on the PR; that scorecard is the source evidence for flipping `deploy_verified: true`.

`status: done` = code gate. `deploy_verified: true` = real gate. Never conflate.

Reference interaction patterns:

- HTTP / API surfaces → [Agent-First API Validation](docs/guides/agent-api-validation.md)
- Other surfaces (CLI, graph, scheduler, infra) → [Development Lifecycle § Feature Validation Contract](docs/spec/development-lifecycle.md#feature-validation-contract)

## Human-Review Gates

The lifecycle has exactly two named human-review gates. Outside these, drive yourself:

- **`needs_review` (post-`/design`)** — agent posts the design doc, stops, waits for a human or `/review-design` agent before `/implement`.
- **`needs_human_qa` (post-flight)** — agent posts the `/validate-candidate` scorecard on the PR, stops, waits for human / qa-agent visual sign-off before merge.

Everything between is operator-↔-agent iteration. If you stop at any other point, you've over-escalated.

## Required Agent Loop

For code contributions, follow this sequence unless a human explicitly narrows the task to local analysis only:

1. **Discover + register** — `GET /.well-known/agent.json`, then `POST /api/v1/agent/register` for a Bearer token.
2. **Adopt one work item, one node** — list/create through `/api/v1/work/items`; keep one work item ≈ one PR ≈ **one node** (`single-node-scope` is a CI gate). Cross-node changes need a separate item.
3. **Coordinate execution** — claim/heartbeat/link PR through the operator work-item session endpoints while you work. Poll `GET /api/v1/work/items/$ID/coordination`; **`nextAction` is authoritative** — it's the operator's pushback channel and overrides your plan.
4. **Implement + prove locally** — run the smallest targeted lint/type/test/db checks that cover the edited surface.
5. **Open PR + flight via operator** — push, open the PR, wait for CI, then `POST /api/v1/vcs/flight { prNumber }`. **Do not run `gh workflow run candidate-flight.yml` yourself.** The operator endpoint dispatches as the GitHub App, so every flight is auditable to your work-item session — direct `workflow_dispatch` from a human PAT breaks attribution and leaves no operator record.
6. **Validate with `/validate-candidate`** — hit the real candidate-a URL, query Loki for feature-specific logs from your own request, and post the scorecard on the PR.

If you hit a blocker in this contract — auth fails, an endpoint misbehaves, a lifecycle invariant fires that you cannot satisfy — **file a bug against the operator** (`POST /api/v1/work/items {type:'bug', node:'operator', ...}`), link it from your active work-item, and continue if you can or stop if you can't. That's the signal the operator needs to harden the contract; don't paper over it.

## Workflow Guiding Principles

- **Find the existing artifact before writing new code.** At every stage, dive into `docs/spec/`, `docs/guides/`, `.claude/skills/`, `.claude/commands/`, `work/charters/`, and the operator API and use the most relevant one. New code that duplicates an existing port / adapter / guide / skill is net-negative — it poisons the codebase. Extend, don't replicate.
- **Goal-driven execution.** Convert every task into a verifiable `## Validation` block, ship the smallest prototype to candidate-a, then iterate against what the running system actually does. Long plans on paper don't beat a real interaction.
- **Think before coding.** State assumptions. Surface ambiguity. Push back when the prompt implies over-scope or a simpler path exists. _Then ship._
- **Simplicity first.** Write the minimum code that solves the problem. No speculative abstractions. No error handling for impossible cases.
- **Surgical changes.** Edit only what the task demands. Match existing style. Mention drive-by issues — don't fix them in the same PR.
- **Port, don't rewrite.** When refactoring, copy working logic verbatim and change only the boundary. Rewrites reintroduce bugs the original already solved.
- **Work items live in the Cogni API, not markdown.** Before creating a new task/bug/spike, `GET /api/v1/work/items?node=<node>` to check existing, then `POST` to track new work. The legacy `work/items/*.md` corpus is in prod Doltgres at original IDs (`bug.0002` stays `bug.0002`); do not recreate it.
- **Drive to `deploy_verified: true`.** Don't wait for a human between the two named review gates above — run the command, read the log, fix the error, try again. Critical blockers (missing auth, revoked access, destructive-op confirmation) get filed as a bug + escalated; nothing else does.
- **`main` is holy clean.** No "pre-existing" test, type, lint, or `pnpm check` failures on `main`. If you hit one, it's your worktree setup or a bug you just introduced. Bootstrap first ([`docs/guides/new-worktree-setup.md`](docs/guides/new-worktree-setup.md)); if it still fails, it's your PR and you fix it.
- **Prune aggressively.** Delete noise; keep signal. Summarize after each step. Keep context <40% of the window.

For style rules (file headers, comments, deterministic reproducibility), see [`docs/spec/style.md`](docs/spec/style.md).

## Verification Loop

Each stage is a real signal, not a ceremony. Skipping a stage does not save time — it just moves the failure later.

- **During iteration:** `pnpm check:fast:fix` auto-fixes lint/format and runs typecheck + unit; `pnpm check:fast` is the strict variant the pre-push hook runs.
- **Pre-commit:** `pnpm check` — once per session, never repeated. The full static gate.
- **Pre-merge (CI):** `pnpm check:full` (~20 min). Stack-test success is the required CI gate.
- **Post-flight:** run `/validate-candidate` → exercise the feature on the live URL → read your own request back out of Loki → post the scorecard used to flip `deploy_verified: true`.

## Pull Request Discipline

PRs are the durable artifact of a work item. [`/closeout`](.claude/commands/closeout.md) creates them. Every PR body answers:

- **TLDR** — what changed, in 1–2 lines.
- **Deployment impact** — does this need `candidate-flight-infra`? Add or rotate secrets? Touch `deploy/*`? Name it and link the workflow, or say `none`.
- **E2E validation plan** — the `exercise:` + `observability:` pair from the work item's `## Validation` block, verbatim.
- **Validation result** — post-flight comment with the real `exercise:` response and the Loki line proving your own request hit the deployed SHA. This flips `deploy_verified: true`.

## Agent Behavior

- Follow this file as primary instruction. Subdir `AGENTS.md` may extend but may not override core principles.
- **Scale your learnings.** When you hit a mistake or blocker another agent is likely to repeat, edit the relevant guide / spec / command file so the next agent doesn't rediscover it. A 3-line fix to a pointer doc beats a 30-minute onboarding by the next agent.
- Never modify files outside your assigned scope. Never commit on a branch you did not create.
- Use git worktrees for isolated work — never `checkout`/`stash` on the user's main worktree.
- If asked to install tools: `pnpm install --frozen-lockfile`.

## API Contracts are the Single Source of Truth

- All HTTP/API request/response shapes **must** be defined in `src/contracts/*.contract.ts` using Zod.
- Facades, routes, services, and tests **must** use `z.infer<typeof ...>` from these contracts — never re-declare types.
- When a contract shape changes: update the contract file first, then fix whatever TypeScript + Zod complain about.

## Environment

- **Framework:** Next.js (TypeScript, App Router)
- **Infra:** Docker + OpenTofu → k3s / Spheron (managed Akash). Argo CD reconciles from `deploy/*` branches.
- **Toolchain:** pnpm, Biome, ESLint, Prettier, Vitest, Playwright, SonarQube
- **Observability:** Pino JSON → Alloy → local Loki (dev) or Grafana Cloud (preview/prod). Agents query Loki via the `grafana` MCP to read back their own requests at the deployed SHA. Langfuse is the v2 target for AI-call traces.
- **Node layout:** sovereign node code lives under `nodes/{node}/` (`app/`, `graphs/`, `.cogni/`)

## Pointers

**Lifecycle, CI/CD, and validation** — read before starting non-trivial work.

- [Development Lifecycle](docs/spec/development-lifecycle.md) — status-driven flow, `/command` dispatch, invariants
- [CI/CD Pipeline](docs/spec/ci-cd.md) — trunk-based model, candidate-a flight, promotion, source-sha map
- [Agent-First API Validation](docs/guides/agent-api-validation.md) — reference interaction flow for API features
- [`/contribute-to-cogni`](.claude/skills/contribute-to-cogni/SKILL.md) — executable contributor contract

**Architecture & development**

- [Architecture](docs/spec/architecture.md) — hexagonal layering, directory structure, enforcement rules
- [Feature Development Guide](docs/guides/feature-development.md)
- [Developer Setup](docs/guides/developer-setup.md) — local setup + full command catalog
- [Multi-node Dev](docs/guides/multi-node-dev.md) · [Testing Strategy](docs/guides/testing.md) · [Common Agent Mistakes](docs/guides/common-mistakes.md)

**Standards**

- [Style & Lint Rules](docs/spec/style.md) · [AI Setup](docs/spec/ai-setup.md) · [AI Pipeline E2E](docs/spec/ai-pipeline-e2e.md) · [Work Management](work/README.md) · [Subdir AGENTS.md Template](docs/templates/agents_subdir_template.md)

## Usage

Three commands carry most workflow; full catalog in [Developer Setup](docs/guides/developer-setup.md).

```bash
pnpm dev:stack      # primary dev loop (operator + infra)
pnpm check:fast     # strict iteration gate (pre-push)
pnpm check          # pre-commit gate — once per session
```
