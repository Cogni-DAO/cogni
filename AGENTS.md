# AGENTS.md — Cogni-Template

> Scope: repository-wide orientation for all agents. Keep ≤150 lines. Subdir `AGENTS.md` files extend this; they do not override it. Closest file in the tree wins, per the [agents.md open spec](https://agents.md/).

## Mission

A reproducible, open-source foundation for autonomous AI-powered organizations:

- All infra deployable via open tooling (Docker + OpenTofu + Akash)
- All accounting and payments via DAO-controlled crypto wallets
- Strict reproducibility and code discipline across all Cogni repos

## Definition of Done

Your work is **not done** when tests pass locally, and it is **not done** when your PR merges to `main`. It is done when the full lifecycle completes and the feature is proven running on a real environment. All of the following must hold:

1. **Lifecycle completed** — the work item moved through [`/triage` → (`/design`) → `/implement` → `/closeout` → `/review-implementation`](docs/spec/development-lifecycle.md). Every `needs_*` status maps to exactly one `/command`. No ambiguity, no status rot.
2. **Validation block committed** — the task/bug has a `## Validation` section with `exercise:` + `observability:` before `/closeout` creates the PR. (Invariant `VALIDATION_REQUIRED`.)
3. **Code gate green** — PR merged to `main`. `status: done`. This is the _code_ gate only.
4. **Flight gate green** — PR promoted to [`candidate-a`](docs/spec/ci-cd.md#environment-model) via flight. Argo reconciled `Healthy`, `kubectl rollout` clean, `/readyz.version == source-sha-map[app]`.
5. **Feature gate green** — qa-agent exercises the specific feature (not generic `/readyz`), confirms the observability signal lands in Loki at the deployed SHA, and sets `deploy_verified: true` on the work item. (Invariants `DEPLOY_VERIFIED_SEPARATE`, `FEATURE_SMOKE_SCOPED`.)

Reference validation patterns:

- HTTP/API features → [Agent-First API Validation](docs/guides/agent-api-validation.md)
- Other surfaces (CLI, graph, scheduler, infra) → the analog outlined in [Development Lifecycle § Feature Validation Contract](docs/spec/development-lifecycle.md#feature-validation-contract)

`status: done` is the code gate. `deploy_verified: true` is the real gate. Never conflate them.

## Workflow Guiding Principles

- **Think before coding.** State assumptions explicitly. Surface ambiguity. Push back when the prompt implies over-scope or a simpler path exists.
- **Simplicity first.** Write the minimum code that solves the problem. No speculative abstractions. No error handling for impossible cases. Rewrite if complexity exceeds necessity.
- **Surgical changes.** Edit only what the task demands. Match existing style. Mention unrelated issues — don't fix them in the same PR.
- **Goal-driven execution.** Convert every task into a verifiable `## Validation` block and loop to green. The `exercise:` + `observability:` pair _is_ your success criterion.
- **Spec first.** Write the plan before code. Confirm with the user when intent is unclear.
- **Port, don't rewrite.** When refactoring, copy working logic verbatim and change only the boundary. Business logic rewritten from scratch reintroduces bugs the original already solved.
- **Prune aggressively.** Delete noise; keep signal. Summarize after each step. Keep context <40% of the window.

## Verification Loop

- **During iteration:** `pnpm check:fast` — typecheck + lint/format auto-fix + unit tests. Run targeted tests for what you changed.
- **Pre-commit:** `pnpm check` — once per session, never repeated. This is the full static gate.
- **Pre-merge (CI):** `pnpm check:full` (~20 min). Stack-test success is the required CI gate. Check PR status after push.
- **Post-merge:** candidate-a flight + qa-agent exercise + Loki confirmation → `deploy_verified: true`. This closes the Definition-of-Done loop.

## Agent Behavior

- Follow this file as primary instruction. Subdir `AGENTS.md` may extend but may not override core principles.
- Never modify files outside your assigned scope. Never commit on a branch you did not create.
- Use git worktrees for isolated work — never `checkout`/`stash` on the user's main worktree.
- Treat corrections as durable rules. When the user corrects an approach, update this file or the relevant guide so the mistake doesn't repeat.
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
- **Observability:** Pino JSON → Alloy → local Loki (dev) or Grafana Cloud (preview/prod)
- **Node layout:** sovereign node code lives under `nodes/{node}/` (`app/`, `graphs/`, `.cogni/`)

## Pointers

**Lifecycle & CI/CD** (read these before starting non-trivial work)

- [Development Lifecycle](docs/spec/development-lifecycle.md) — status-driven flow, `/command` dispatch, invariants
- [CI/CD Pipeline](docs/spec/ci-cd.md) — trunk-based model, candidate-a flight, promotion
- [Agent-First API Validation](docs/guides/agent-api-validation.md) — reference validation flow for API features

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
pnpm check:fast               # iteration gate (typecheck + lint/format fix + unit)
pnpm check                    # pre-commit gate — once per session
pnpm check:full               # CI-parity gate (~20 min)
pnpm test:component           # component tests (isolated testcontainers)
pnpm test:stack:dev           # stack tests (requires dev:stack:test running)
```

`:fast` variants skip Docker rebuilds for faster startup.
