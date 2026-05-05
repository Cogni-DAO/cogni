# AGENTS.md — Cogni-Template

> Scope: repository-wide orientation for all agents. Keep ≤150 lines. Subdir `AGENTS.md` files extend this; they do not override it. Closest file in the tree wins, per the [agents.md open spec](https://agents.md/).

> **If you contribute code in this repo, you follow [the Development Lifecycle](docs/spec/development-lifecycle.md). Full stop.** `/triage → (/design) → /implement → /closeout → /review-implementation`, with a `## Validation` block before `/closeout`, ending in `deploy_verified: true` on candidate-a — proven by you, by hand. Read that spec before opening any PR.

## Mission

A reproducible, open-source foundation for autonomous AI-powered organizations:

- All infra deployable via open tooling (Docker + OpenTofu + Akash)
- All accounting and payments via DAO-controlled crypto wallets
- Strict reproducibility and code discipline across all Cogni repos

## How Agents Work Here — In One Paragraph

**Think briefly, then ship to candidate-a and learn from real behavior.** Plan enough to know what you're building and how you'll prove it works — no more. Prototype the smallest thing that produces a real signal. Push it to a PR, flight it to `candidate-a`, then _interact with your own feature on the deployed build_ and _watch your own request land in Loki_. Iterate against what the running system actually does, not what you assumed it would. Your work is not "done" until you have personally driven a real interaction through the deployed candidate-a build and confirmed the observability signal of your own action. The lifecycle commands (`/triage → /design → /implement → /closeout → /review-implementation`) are scaffolding around that loop, not a substitute for it.

## Definition of Done

You are done when **all** of the following are true — not before:

1. **Lifecycle completed** — work item moved through the [`/triage → (/design) → /implement → /closeout → /review-implementation`](docs/spec/development-lifecycle.md) flow. Every `needs_*` status maps to exactly one `/command`.
2. **Validation block committed** — `## Validation` section with `exercise:` + `observability:` is on the work item before `/closeout` creates the PR. (Invariant `VALIDATION_REQUIRED`.)
3. **Code gate green** — PR merged to `main`. `status: done`. _This is only the code gate._
4. **Flight gate green** — promoted to [`candidate-a`](docs/spec/ci-cd.md#environment-model) via flight. Argo `Healthy`, rollout clean, `/version.buildSha` matches the source-sha map (per promoted apps).
5. **Feature gate green — by your own hand** — you (or qa-agent) have hit the real candidate-a URL with the `exercise:` from your validation block, got the expected response, and queried Loki for the observability signal at the deployed SHA and seen _your own request_ in the logs. Post the `/validate-candidate` scorecard on the PR; that scorecard is the source evidence for flipping `deploy_verified: true`.

`status: done` = code gate. `deploy_verified: true` = real gate. Never conflate.

Reference interaction patterns:

- HTTP / API surfaces → [Agent-First API Validation](docs/guides/agent-api-validation.md) (discover → register → auth → execute → list → stream, no browser session)
- Other surfaces (CLI, graph, scheduler, infra) → [Development Lifecycle § Feature Validation Contract](docs/spec/development-lifecycle.md#feature-validation-contract)

## Required Agent Loop

For code contributions, follow this sequence unless a human explicitly narrows the task to local analysis only:

1. **Discover + register** — `GET /.well-known/agent.json`, then `POST /api/v1/agent/register` for a Bearer token.
2. **Adopt one work item** — list/create through `/api/v1/work/items`; keep one work item ≈ one PR.
3. **Coordinate execution** — claim/heartbeat/link PR through the operator work-item session endpoints while you work.
4. **Implement + prove locally** — run the smallest targeted lint/type/test/db checks that cover the edited surface.
5. **Open PR + flight** — push, open the PR, wait for CI, then request/dispatch `candidate-a` flight for the exact head SHA.
6. **Validate with `/validate-candidate`** — hit the real candidate-a URL, query Loki for feature-specific logs from your own request, and post the scorecard on the PR.

## Workflow Guiding Principles

- **Bias for action.** Think until you know what to build and how you'll prove it — then go. Long plans on paper don't beat a running prototype on candidate-a.
- **Work items live in the Cogni API, not markdown.** Before creating a new task/bug/spike, `GET https://preview.cognidao.org/api/v1/work/items?node=<node>` (and `?projectId=<proj>`) to check existing — then `POST /api/v1/work/items` to track new work. Get an apiKey via `/contribute-to-cogni`. The `work/items/*.md` corpus is legacy reference until the importer back-fills it; do not add new files there.
- **Prototype against reality.** Your first goal after planning is a real interaction with a deployed build. Code that only runs locally has not yet earned trust.
- **Close your own loop.** Drive the feature yourself on candidate-a and confirm the observability signal of your own call in Loki. Don't hand the loop off and call it done.
- **Goal-driven execution.** Convert every task into a verifiable `## Validation` block. The `exercise:` + `observability:` pair _is_ your success criterion — loop to green.
- **Think before coding.** State assumptions. Surface ambiguity. Push back when the prompt implies over-scope or a simpler path exists. _Then ship._
- **Simplicity first.** Write the minimum code that solves the problem. No speculative abstractions. No error handling for impossible cases.
- **Code speaks for itself.** No inline comments narrating _what_ code does — names and types are the docs. Put non-obvious _why_ (constraints, invariants, workarounds) in the TSDoc module header; route spec / work-item / design-doc references through its `Links:` field. Cross-file orientation lives in `AGENTS.md` Pointers, not sprawled across source.
- **Surgical changes.** Edit only what the task demands. Match existing style. Mention drive-by issues — don't fix them in the same PR.
- **Deterministic reproducibility.** Everything the system runs on lives in git — infra as code (GitOps via Argo + OpenTofu), memory as code (Dolt ops). Ad-hoc `ssh`, `kubectl`, one-off env vars, and console clicks are fine for a 5-minute experiment; anything that needs to stay gets captured as a script, terraform change, or GitOps commit before the session ends. If it isn't in git, it didn't happen.
- **`main` is holy clean.** There are no "pre-existing" test, type, lint, or `pnpm check` failures on `main`. If you hit one, it's either your worktree setup (missing install, unbuilt packages, missing env) or a bug you just introduced. Bootstrap the worktree first ([`docs/guides/new-worktree-setup.md`](docs/guides/new-worktree-setup.md)); if it still fails, it's your PR and you fix it before asking for help.
- **Port, don't rewrite.** When refactoring, copy working logic verbatim and change only the boundary. Rewrites reintroduce bugs the original already solved.
- **Prune aggressively.** Delete noise; keep signal. Summarize after each step. Keep context <40% of the window.

## Verification Loop

Each stage is a real signal, not a ceremony. Skipping a stage does not save time — it just moves the failure later.

- **During iteration:** `pnpm check:fast:fix` auto-fixes lint/format and runs typecheck + unit; `pnpm check:fast` is the strict (verify-only) variant the pre-push hook runs. If `check:fast` fails with drift, run `check:fast:fix`, commit the result, and retry.
- **Pre-commit:** `pnpm check` — once per session, never repeated. The full static gate.
- **Pre-merge (CI):** `pnpm check:full` (~20 min). Stack-test success is the required CI gate. Check PR status after push.
- **Post-flight:** run `/validate-candidate` → exercise the feature on the live URL → read your own request back out of Loki → post the scorecard used to flip `deploy_verified: true`. This is the gate that actually proves the feature exists.

## Pull Request Discipline

PRs are the durable artifact of a work item. [`/closeout`](.claude/commands/closeout.md) creates them. Every PR body answers:

- **TLDR** — what changed, in 1–2 lines.
- **Deployment impact** — does this need `candidate-flight-infra`? Add or rotate secrets? Touch `deploy/*`? Name it and link the workflow, or say `none`.
- **E2E validation plan** — the `exercise:` + `observability:` pair from the work item's `## Validation` block, verbatim.
- **Validation result** — post-flight comment with the real `exercise:` response and the Loki line proving your own request hit the deployed SHA. This flips `deploy_verified: true`.

## Agent Behavior

- Follow this file as primary instruction. Subdir `AGENTS.md` may extend but may not override core principles.
- **Drive the work to `deploy_verified: true`.** Don't wait for a human to unblock the next step — run the command, read the log, fix the error, try again. Escalate only on truly critical blockers (missing auth, revoked access, destructive-op confirmation).
- **Scale your learnings.** When you hit a mistake or blocker another agent is likely to repeat, edit the relevant guide / spec / command file so the next agent doesn't rediscover it. A 3-line fix to a pointer doc beats a 30-minute onboarding by the next agent. This is how the playbook gets better.
- Never modify files outside your assigned scope. Never commit on a branch you did not create.
- Use git worktrees for isolated work — never `checkout`/`stash` on the user's main worktree.
- If asked to install tools: `pnpm install --frozen-lockfile`.

## API Contracts are the Single Source of Truth

- All HTTP/API request/response shapes **must** be defined in `src/contracts/*.contract.ts` using Zod.
- Facades, routes, services, and tests **must** use `z.infer<typeof ...>` from these contracts — never re-declare types.
- When a contract shape changes: update the contract file first, then fix whatever TypeScript + Zod complain about.
- No other manual type definitions are allowed for these shapes.

## Environment

- **Framework:** Next.js (TypeScript, App Router)
- **Infra:** Docker + OpenTofu → k3s / Spheron (managed Akash). Argo CD reconciles from `deploy/*` branches.
- **Toolchain:** pnpm, Biome, ESLint, Prettier, Vitest, Playwright, SonarQube
- **Observability:** Pino JSON → Alloy → local Loki (dev) or Grafana Cloud (preview/prod). Agents query Loki via the `grafana` MCP to read back their own requests at the deployed SHA. **New MCP / metrics tools will be wired in as validation matures** — Langfuse is the v2 target for AI-call traces. Tool-specific usage details belong in the validation guides, not here.
- **Node layout:** sovereign node code lives under `nodes/{node}/` (`app/`, `graphs/`, `.cogni/`)

## Pointers

**Lifecycle, CI/CD, and validation** — read before starting non-trivial work.

- [Development Lifecycle](docs/spec/development-lifecycle.md) — status-driven flow, `/command` dispatch, invariants, machine-executable contribution graph
- [CI/CD Pipeline](docs/spec/ci-cd.md) — trunk-based model, candidate-a flight, promotion, source-sha map
- [Agent-First API Validation](docs/guides/agent-api-validation.md) — reference interaction flow for API features

**Architecture & development**

- [Architecture](docs/spec/architecture.md) — hexagonal layering, directory structure, enforcement rules
- [Feature Development Guide](docs/guides/feature-development.md) — end-to-end feature flow
- [Developer Setup](docs/guides/developer-setup.md) — local setup + full command catalog
- [Multi-node Dev](docs/guides/multi-node-dev.md) — layout, commands, testing
- [Testing Strategy](docs/guides/testing.md) — test types and when to use each
- [Common Agent Mistakes](docs/guides/common-mistakes.md) — top mistakes and troubleshooting

**Standards**

- [Style & Lint Rules](docs/spec/style.md)
- [AI Setup Spec](docs/spec/ai-setup.md) — correlation IDs, telemetry
- [AI Pipeline E2E](docs/spec/ai-pipeline-e2e.md) — auth, execution, billing, security scorecard
- [Work Management](work/README.md) — charters, projects, work items
- [Subdir AGENTS.md Template](docs/templates/agents_subdir_template.md)

## Usage

Essentials only — full catalog in [Developer Setup](docs/guides/developer-setup.md).

```bash
pnpm dev:stack                # primary dev loop (operator + infra)
pnpm dev:stack:full           # operator + all nodes + infra
pnpm dev:stack:test           # dev server + infra for stack tests
pnpm check:fast               # strict iteration gate — verify-only, no mutation (pre-push runs this)
pnpm check:fast:fix           # auto-fix variant — applies lint/format fixes, fails on residual drift
pnpm check                    # pre-commit gate — once per session
pnpm check:full               # CI-parity gate (~20 min)
pnpm test:component           # component tests (isolated testcontainers)
pnpm test:stack:dev           # stack tests (requires dev:stack:test running)
```

`:fast` variants skip Docker rebuilds for faster startup.
