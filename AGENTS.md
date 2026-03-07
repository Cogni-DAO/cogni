# AGENTS.md — Cogni-Template MetaPrompt

> Scope: repository-wide orientation for all agents. Keep ≤150 lines. Subdirs inherit from this.

## Mission

Provide a reproducible, open-source foundation for autonomous AI-powered organizations:

- All infra deployable via open tooling (Docker + OpenTofu + Akash)
- All accounting and payments via DAO-controlled crypto wallets
- Strict reproducibility and code discipline across all Cogni repos

## Workflow Guiding Principles

- **Spec first:** Write the plan before code. Confirm the plan with the user.
- **Compact progress:** Summarize after each step.
- **Prune aggressively:** Delete noise, keep signal.
- **Delegate cleanly:** Use subagents with narrow scopes.
- **Validate early:** Run `pnpm check` before proposing commits.
- **Update docs:** Reflect any surface changes in AGENTS.md.
- **Full Validation:** `pnpm check:full` is long running, but has CI parity. Use as last required feature validation gate.

## Agent Behavior

- Follow this root file as primary instruction; subdir AGENTS.md may extend but not override core principles.
- Never modify outside assigned directories.
- Keep context lean (<40% window); summarize often.
- Purge incorrect info instead of propagating it.
- If asked to install tools, run: `pnpm install --frozen-lockfile`

## Environment

- **Framework:** Next.js (TypeScript, App Router)
- **Infra:** Docker + OpenTofu → Spheron (managed Akash)
- **Toolchain:** pnpm, Biome, ESLint, Prettier, Vitest, Playwright, SonarQube
- **Observability:** Pino JSON → Alloy → local Loki (dev) or Grafana Cloud (preview/prod). MCP via grafana-local/grafana.
- **CI entrypoint:** `pnpm check`

## API Contracts are the Single Source of Truth

- All HTTP/API request/response shapes **must** be defined in `src/contracts/*.contract.ts` using Zod
- Facades, routes, services, and tests **must** use `z.infer<typeof ...>` from these contracts instead of re-declaring types
- If the contract shape changes, update the contract file first and then fix whatever TypeScript + Zod complain about
- No other manual type definitions are allowed for those shapes

## Pointers

### Documentation & Work

- [Documentation System Guide](docs/README.md) — How to navigate and create docs
- [Work Management Guide](work/README.md) — Charters, projects, and work items
- [Docs Organization Plan](docs/archive/DOCS_ORGANIZATION_PLAN.md) — Full system design
- [Spec Index](docs/reference/SPEC_INDEX.md) — Index of all specifications

### Core Architecture

- [Attribution Pipeline Overview](docs/spec/attribution-pipeline-overview.md)
- [Technical Roadmap](ROADMAP.md)
- [Node vs Operator Contract](docs/spec/node-operator-contract.md)
- [MVP Deliverables](docs/archive/MVP_DELIVERABLES.md)
- [Node Formation Spec](docs/spec/node-formation.md)
- [Chain Deployment Refactor](work/projects/proj.chain-deployment-refactor.md)
- [Architecture](docs/spec/architecture.md)
- [Authorization (RBAC/ReBAC)](docs/spec/rbac.md)
- [Tenant Connections](docs/spec/tenant-connections.md)
- [Tool Use Spec](docs/spec/tool-use.md)
- [Services Migration (project)](work/projects/proj.cicd-services-gitops.md)

### AI & Evals

- [AI Setup Spec](docs/spec/ai-setup.md)
- [Prompt Registry Spec](docs/spec/prompt-registry.md)
- [Tools Authoring](docs/guides/tools-authoring.md)
- [Graph Execution](docs/spec/graph-execution.md)
- [LangGraph Server](docs/spec/langgraph-server.md)
- [LangGraph Patterns](docs/spec/langgraph-patterns.md)
- [Claude SDK Adapter](docs/spec/claude-sdk-adapter.md)
- [n8n Adapter](docs/spec/n8n-adapter.md)
- [OpenClaw Sandbox Integration](docs/spec/openclaw-sandbox-spec.md)
- [OpenClaw Sandbox Controls](docs/spec/openclaw-sandbox-controls.md)
- [AI Evals](docs/spec/ai-evals.md)

### Development

- [Developer Setup](docs/guides/developer-setup.md)
- [Environment & Stack Deployment Modes](docs/spec/environments.md)
- [Database & Migration Architecture](docs/spec/databases.md)
- [Database RLS Spec](docs/spec/database-rls.md)
- [Testing Strategy](docs/guides/testing.md)
- [Feature Development Guide](docs/guides/feature-development.md)
- [UI Implementation Guide](docs/spec/ui-implementation.md)
- [Style & Lint Rules](docs/spec/style.md)

### Operations

- [Observability](docs/spec/observability.md)
- [Repo Specification](.cogni/repo-spec.yaml)
- [Subdir AGENTS.md Policy](docs/templates/agents_subdir_template.md)

## Usage

```bash
pnpm dev                      # start dev server
pnpm dev:stack                # start dev server + infrastructure (main dev workflow)
pnpm dev:stack:test           # start dev server + infrastructure for testing
pnpm dev:stack:test:setup     # first time: create test DB + run migrations
pnpm docker:dev:stack         # start all services containerized (with build)
pnpm docker:dev:stack:fast    # start all services containerized (skip build for speed)
pnpm docker:test:stack        # start all services containerized in test mode (with build)
pnpm docker:test:stack:fast   # start all services containerized in test mode (skip build)
pnpm docker:stack             # start full stack locally (with build)
pnpm docker:stack:fast        # start full stack locally (skip build)
pnpm build                    # build for production
pnpm packages:build           # build workspace packages (tsup JS + tsc declarations)
pnpm packages:clean           # clean package dist/ and .tsbuildinfo
pnpm check                    # lint + type + format validation (fast, no infra)
pnpm check:full               # CI-parity gate: full docker build, stack launch + all test suites
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
pnpm e2e                      # Black box end-to-end tests (run on pnpm docker:stack)
```

**Fast variants:** Commands with `:fast` skip Docker rebuilds, using existing images for faster startup.
