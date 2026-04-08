# AGENTS.md — Cogni-Template MetaPrompt

> Scope: repository-wide orientation for all agents. Keep ≤150 lines. Subdirs inherit from this.

## Mission

Provide a reproducible, open-source foundation for autonomous AI-powered organizations:

- All infra deployable via open tooling (Docker + OpenTofu + Akash)
- All accounting and payments via DAO-controlled crypto wallets
- Strict reproducibility and code discipline across all Cogni repos

## Branch Workflow

- **Branch from `main`** (default branch) — `main` is the source of truth
- **PR to `canary`** — canary is the integration branch where CI builds and deploys happen
- **Never commit directly to `main`** — code reaches main via `release/*` PRs after preview validation
- Pipeline: `canary push → build → promote → deploy → verify → E2E → preview → release PR → main`

## Workflow Guiding Principles

- **Spec first:** Write the plan before code. Confirm the plan with the user.
- **Port, don't rewrite:** When refactoring, copy existing working logic verbatim and change only the boundary (I/O layer, calling convention). Never rewrite business logic from scratch — it introduces bugs that the original code already solved.
- **Compact progress:** Summarize after each step.
- **Prune aggressively:** Delete noise, keep signal.
- **Delegate cleanly:** Use subagents with narrow scopes.
- **Validate early:** Run `pnpm check:fast` during iteration (auto-fixes lint/format). Prefer affected and targeted node/package checks over broad repo-wide runs while prototyping.
- **Validate once before commit:** Run `pnpm check` once as the pre-commit gate. Treat it as an expensive session-level gate, not the default inner-loop command.
- **Update docs:** Reflect any surface changes in AGENTS.md.
- **Worktree isolation:** Unless explicitly instructed by the user, assume you need to do your work in an isolated worktree. Check out the worktree from the default branch, and expect to PR your work to `canary`.
- **Full Validation:** `pnpm check:full` runs in CI (~20 min). Check CI status on the PR after push — stack test success is the required gate.

## Agent Behavior

- Follow this root file as primary instruction; subdir AGENTS.md may extend but not override core principles.
- Never modify outside assigned directories.
- Keep context lean (<40% window); summarize often.
- Purge incorrect info instead of propagating it.
- Default implementation agents should optimize for clean, fast, checked code and targeted validation. Use specialist agents for higher-level test authoring, broad validation sweeps, and CI/debug follow-through.
- If asked to install tools, run: `pnpm install --frozen-lockfile`

## Environment

- **Framework:** Next.js (TypeScript, App Router)
- **Infra:** Docker + OpenTofu → Spheron (managed Akash)
- **Toolchain:** pnpm, Biome, ESLint, Prettier, Vitest, Playwright, SonarQube
- **Observability:** Pino JSON → Alloy → local Loki (dev) or Grafana Cloud (preview/prod). MCP via grafana-local/grafana.
- **CI entrypoint:** `pnpm check` (static) → `pnpm check:full` (stack tests)
- **Node layout:** sovereign node code lives under `nodes/{node}/` (`app/`, `graphs/`, `.cogni/`)

## API Contracts are the Single Source of Truth

- All HTTP/API request/response shapes **must** be defined in `src/contracts/*.contract.ts` using Zod
- Facades, routes, services, and tests **must** use `z.infer<typeof ...>` from these contracts instead of re-declaring types
- If the contract shape changes, update the contract file first and then fix whatever TypeScript + Zod complain about
- No other manual type definitions are allowed for those shapes

## Pointers

- [Architecture](docs/spec/architecture.md) — Hexagonal layering, directory structure, enforcement rules
- [Feature Development Guide](docs/guides/feature-development.md) — How to add features end-to-end
- [Common Agent Mistakes](docs/guides/common-mistakes.md) — Top mistakes and troubleshooting
- [Developer Setup](docs/guides/developer-setup.md) — Getting started locally
- [Testing Strategy](docs/guides/testing.md) — Test types, when to use each
- [Style & Lint Rules](docs/spec/style.md) — Code style and lint configuration
- [AI Setup Spec](docs/spec/ai-setup.md) — AI correlation IDs, telemetry
- [AI Pipeline E2E](docs/spec/ai-pipeline-e2e.md) — Auth, execution, billing flow & security scorecard
- [Work Management](work/README.md) — Charters, projects, and work items
- [Subdir AGENTS.md Policy](docs/templates/agents_subdir_template.md) — Template for subdirectory files

## Usage

```bash
pnpm dev                      # start operator dev server
pnpm dev:poly                 # start poly node (port 3100, requires dev:infra)
pnpm dev:resy                 # start resy node (port 3300, requires dev:infra)
pnpm dev:stack                # start operator + infrastructure (main dev workflow)
pnpm dev:stack:full           # start operator + all nodes + infrastructure
pnpm dev:stack:test           # start dev server + infrastructure for testing
pnpm dev:stack:test:setup     # first time: create test DB + run migrations
pnpm dev:infra:tb             # opt-in: start TigerBeetle (needs ~1.2GiB RAM)
pnpm docker:dev:stack         # start all services containerized (with build)
pnpm docker:dev:stack:fast    # start all services containerized (skip build for speed)
pnpm docker:test:stack        # start all services containerized in test mode (with build)
pnpm docker:test:stack:fast   # start all services containerized in test mode (skip build)
pnpm docker:stack             # start full stack locally (with build)
pnpm docker:stack:fast        # start full stack locally (skip build)
pnpm build                    # build for production
pnpm packages:build           # build workspace packages (tsup JS + tsc declarations)
pnpm packages:clean           # clean package dist/ and .tsbuildinfo
pnpm check:fast               # typecheck + lint/format fix + unit tests (use during iteration)
pnpm check                    # ALL static checks: type + lint + format + arch + docs + tests (once before commit)
pnpm check:full               # CI-parity: docker build + stack launch + all test suites (~20 min, runs in CI)
pnpm check:full:fast          # Same as check:full but skip Docker rebuild
pnpm test                     # run unit tests (no server required)
pnpm test:external            # external API tests (requires GITHUB_TOKEN, not in CI)
pnpm test:ci                  # run tests with test coverage statistics
pnpm test:component           # Component tests (isolated testcontainers, no server)
pnpm test:contract            # Contract tests (in-memory, no HTTP)
pnpm test:stack:dev           # Full Stack tests (requires dev:stack:test running)
pnpm test:stack:docker        # Full Stack tests (requires docker:test:stack running)
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts <testfile> # run a specific stack test file
pnpm format                   # prettier format fixes
pnpm check:docs               # lint AGENTS.md documentation
pnpm typecheck:node-template  # typecheck node-template app
pnpm typecheck:poly           # typecheck poly node app
pnpm typecheck:resy           # typecheck resy node app
pnpm e2e                      # Black box end-to-end tests (run on pnpm docker:stack)
```

**Fast variants:** Commands with `:fast` skip Docker rebuilds, using existing images for faster startup.

**Multi-node:** See [docs/guides/multi-node-dev.md](docs/guides/multi-node-dev.md) for layout, commands, and testing guide.
