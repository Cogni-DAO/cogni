---
name: test-expert
description: Authoritative 1-page reference for the cogni-template test pyramid — enforcement vs test layers, vitest configs, infra prereqs, what agents can/can't run locally, coverage tracking, and the non-obvious gotchas that bite every time. Use this skill whenever the user is writing a new test, asking "which layer does this belong in", debugging a flaky test, hitting CWD/env-loading issues, deciding between unit/component/stack/external, running any `pnpm test:*` or `pnpm arch:check` / `pnpm lint` command, working with testcontainers, touching fake adapters or `APP_ENV=test`, troubleshooting skip-gates, seeing errors from `.env.test` not loading, wondering about coverage or whether a test will run in CI, or trying to decide whether to run stack/e2e locally vs defer to CI. Also trigger when the user mentions mocking the database, Privy/GitHub App construction errors in tests, the smee proxy, `pnpm test:smee`, validating the agent API, or anything that smells like test-environment setup. Short-circuits the usual "spelunk through docs + configs" lookup.
---

# test-expert

Reference desk for writing and debugging tests in this monorepo. Leads with the matrix; gotchas follow because half of test failures here trace back to one of eight repeated mistakes.

There are two distinct things people lump together as "tests":

- **Enforcement** — static checks run in CI that fail builds when rules are violated (typecheck, lint, dep-cruiser, format, doc invariants).
- **Test layers** — vitest (+ Playwright) suites that exercise code behavior.

The matrix below separates them because their tradeoffs, speeds, and fix patterns are different.

## Enforcement matrix (not vitest — static checks)

| Check           | Command                  | What it enforces                                         | Fix when it fails                           |
| --------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| **Typecheck**   | `pnpm typecheck`         | TS types across workspace                                | Fix the type, don't `any`-cast              |
| **Lint**        | `pnpm lint`              | Biome + ESLint rules                                     | `pnpm lint:fix` auto-fixes most             |
| **Format**      | `pnpm format:check`      | Prettier + Biome format                                  | `pnpm format` auto-fixes                    |
| **Arch**        | `pnpm arch:check`        | `.dependency-cruiser.cjs` layer / entry-point boundaries | Refactor the import, don't disable the rule |
| **Docs**        | `pnpm check:docs`        | AGENTS.md headers, metadata, work-item index             | Fix the frontmatter                         |
| **Root layout** | `pnpm check:root-layout` | Project root structure invariants                        | Move the misplaced file                     |

All of the above run in `ci.yaml`. Local bundle: `pnpm check:fast` (iteration) → `pnpm check` (once, pre-commit).

## Test layer matrix (vitest + Playwright)

| Layer              | Config                             | Tests live in                   | Proves                                                                                                                                                     | Infra needed                                       | Command                    | In PR CI?                                                                                                                                                                                                        |
| ------------------ | ---------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**           | `vitest.config.mts`                | `tests/unit/`                   | Pure logic, no I/O                                                                                                                                         | None                                               | `pnpm test`                | ✅ (via `test:ci`)                                                                                                                                                                                               |
| **Meta**           | same                               | `tests/meta/`                   | Doc / spec invariants                                                                                                                                      | None                                               | `pnpm test:meta`           | ✅                                                                                                                                                                                                               |
| **Contract**       | same                               | `tests/contract/`               | Zod shapes vs route handlers                                                                                                                               | None (in-memory)                                   | `pnpm test:contract`       | ✅                                                                                                                                                                                                               |
| **Ports**          | same                               | `tests/ports/`                  | Every adapter implements its port                                                                                                                          | None                                               | (in `pnpm test`)           | ✅                                                                                                                                                                                                               |
| **Security**       | same                               | `tests/security/`               | Auth, RLS, injection guards                                                                                                                                | None                                               | (in `pnpm test`)           | ✅                                                                                                                                                                                                               |
| **Arch (meta)**    | same                               | `tests/arch/`                   | _Enforcement itself hasn't been weakened_ — spawns `depcruise` against arch-probe fixtures to prove rules still catch violations                           | None (subprocess)                                  | `pnpm test:arch`           | ✅                                                                                                                                                                                                               |
| **Lint (meta)**    | same                               | `tests/lint/`                   | Verifies lint-rule config hasn't been weakened — same meta-test pattern as `tests/arch/`. Catches an LLM disabling an ESLint/Biome rule to make a PR pass. | None                                               | `pnpm test:lint`           | ✅                                                                                                                                                                                                               |
| **Component**      | `vitest.component.config.mts`      | `tests/component/*.int.test.ts` | Adapter ↔ real Postgres                                                                                                                                   | Testcontainers (Docker)                            | `pnpm test:component`      | ✅                                                                                                                                                                                                               |
| **Stack (single)** | `vitest.stack.config.mts`          | `tests/stack/`                  | Full HTTP through one node                                                                                                                                 | `dev:stack:test` or `docker:test:stack`            | `pnpm test:stack:dev`      | ✅                                                                                                                                                                                                               |
| **Stack (multi)**  | `vitest.stack-multi.config.mts`    | `tests/stack/`                  | Cross-node isolation / routing                                                                                                                             | `dev:stack:full:test`                              | `pnpm test:stack:multi`    | ✅                                                                                                                                                                                                               |
| **External**       | `vitest.external.config.mts`       | `tests/external/` (non-money)   | Real 3rd-party APIs                                                                                                                                        | GH App creds, Ollama, optional `pnpm test:smee`    | `pnpm test:external`       | ❌                                                                                                                                                                                                               |
| **External money** | `vitest.external-money.config.mts` | `tests/external/money/`         | Real on-chain + real OpenRouter spend                                                                                                                      | Funded wallet, `dev:stack` running, OpenRouter key | `pnpm test:external:money` | ❌                                                                                                                                                                                                               |
| **E2E**            | Playwright                         | `nodes/operator/app/e2e/`       | Production-like black box                                                                                                                                  | `docker:stack`                                     | `pnpm e2e`                 | ❌ — **currently not triggered anywhere** (known gap; the old `staging-preview.yml` runner was deleted during the flighting/CI-CD refactor). Tests exist and are runnable locally; automated invocation is TODO. |

### Meta note on `tests/arch/` + `tests/lint/`

These are intentionally separate from the enforcement commands. `pnpm arch:check` validates the codebase _right now_. `tests/arch/` validates that the enforcement itself still works (i.e., that someone — including an LLM — hasn't quietly weakened the dep-cruiser rules to make a failing PR pass). If `arch:check` passes but `tests/arch/` would fail, that's the signal rules have been neutered. `tests/lint/` is the same pattern, currently unimplemented.

## What agents can actually run locally

For ~90% of agent sessions, infra-gated lanes are out of reach. Use this split:

**Always available (no infra):**

- `pnpm test`, `test:meta`, `test:contract`, `test:arch`, `test:ci` (coverage)
- `pnpm typecheck`, `pnpm lint`, `pnpm arch:check`, `pnpm check:docs`, `pnpm check:fast`, `pnpm check`

**Needs Docker running:**

- `pnpm test:component` (spins up testcontainers-postgres per run)
- `pnpm test:external` (testcontainers + external APIs)

**Needs Docker + full stack + secrets — usually defer to CI:**

- `pnpm test:stack:dev` / `:docker` / `:multi` (requires `dev:stack:test` or `docker:test:stack` running, plus `.env.test` populated)
- `pnpm test:external:money` (funded wallet, real $)
- `pnpm e2e` (full docker stack, browser)

**Default agent pattern:** run what you can locally; for stack/e2e/money, push the branch and **defer to CI** (`ci.yaml` runs component + stack:docker), or ask the human to run `pnpm dev:stack:test` locally and then run the stack test against it.

## Coverage — the ignored dial

`pnpm test:ci` runs the unit suite with coverage (lcov + json-summary + text reporters). It's wired in `ci.yaml:128`. Nobody's been tracking the output lately, but the infrastructure is live — a PR adding a coverage report comment or a coverage-diff gate is a small change, not a new project.

If the user asks "is this covered?" or "what's our coverage look like?", the answer is: run `pnpm test:ci` locally, then open `coverage/lcov-report/index.html`. Or (future) wire a CI step to comment coverage deltas on PRs.

## Picking the right layer

Use the lightest layer that can prove the assertion — heavier layers cost minutes, not seconds, and a misplaced test burns budget every CI run.

- Pure logic, no I/O → **Unit**.
- Shape of an HTTP request or response → **Contract** (Zod round-trip, no server).
- Adapter ↔ real Postgres/Drizzle behavior → **Component** (testcontainers).
- Full HTTP request going through middleware, auth, services, DB → **Stack (single)**.
- How nodes behave when cross-calling each other → **Stack (multi)**.
- Real GitHub API / Ollama / OpenRouter behavior → **External**.
- Real on-chain transaction or real OpenRouter spend → **External money**.
- Production-like browser-driven black box → **E2E** (and know it only runs in deploy flows).

If the user is about to mock the database, push back — use **Component** with testcontainers instead. Mocked DBs have previously masked broken migrations here; the convention exists for a reason.

## Related but distinct: agent API validation

When the user's question is "does the machine-agent API actually work end-to-end against canary or a local stack?" — that's **validation**, not testing. See `docs/guides/agent-api-validation.md`: a curl-based checklist for discover → register → execute graph → list runs → stream events. It's a human/agent-driven probe, not a CI suite. Point at that guide when the user is validating the agent API surface rather than writing a unit/component/stack test.

## Gotchas — these bite repeatedly

1. **`APP_ENV=test` swaps fakes via the DI container.** Fake adapters live in `src/adapters/test/*/fake-*.adapter.ts` and are wired in `src/bootstrap/container.ts` via `serverEnv.isTestMode`. LLM is the exception — it's always real LiteLLM, routed to `mock-openai-api` via `litellm.test.config.yaml`. If a stack/component test is calling a real external service, it's almost always a missing fake wiring in the DI container, not a test bug.

2. **dotenv path-CWD trap.** A vitest config that does `config({ path: ".env.test" })` resolves **relative to CWD**, not the config file. It works when the script runs from repo root. It silently **fails to load** if invoked via `pnpm -F <node> ...` or `turbo run ...` because CWD changes to the node's directory. Symptom: skip-gates think creds are missing, tests blow up at provider construction. Fix pattern:

   ```ts
   const env = config({ path: path.resolve(__dirname, "../../../.env.test") });
   ```

3. **Skip-gate must precede provider construction.** External tests that build Privy/GitHub-App/EVM clients must do so _inside_ `describe.skipIf(!hasCreds)` or a gated `beforeAll`, never at module scope. Module-scope construction throws on missing env → the skip never runs → red test instead of a clean skip. Reference: `work/items/bug.0314` documents four real failures from this pattern.

4. **Testcontainers globalSetup uses `pnpm -w db:migrate:direct`.** The `-w` flag (workspace root) matters. Without it, the migrate script isn't found when globalSetup runs under `pnpm -F <node>`. See `nodes/*/app/tests/component/setup/testcontainers-postgres.global.ts`.

5. **Never mock the database.** In component/stack/external tests, use testcontainers or the real DB. Mocked DBs have concealed production migration bugs here before — the testcontainer overhead is cheap insurance.

6. **Sequence non-parallelism for stateful lanes.** Component + external configs use `sequence: { concurrent: false }` + `pool: forks`, `singleFork: true`. Stateful tests (shared GitHub test repo, single testcontainer DB epoch) race catastrophically in parallel. Don't remove this in a new config.

7. **Check discipline.** `pnpm check:fast` during iteration (auto-fixes format/lint, runs unit tests). `pnpm check` once as the pre-commit gate. Never run `pnpm check` more than once per session — it's the heavyweight pipeline.

8. **Time budgets.** Unit test files <1s. Component 5–30s. Stack 30–90s. External up to 3min (`testTimeout: 30_000` per-test; totals add up). If a test is exceeding these, first suspect missing env (see #2), not genuine slowness.

## When the test is already failing

Triage in this order:

1. **Env loaded?** Check the vitest output header for `[dotenv] injecting env (N)` — if `N=0`, `.env.test` didn't load. See gotcha #2.
2. **Creds asserted before construction?** If the stack trace shows the failure inside a provider constructor, not an assertion, see gotcha #3.
3. **Testcontainer started?** If `db:migrate:direct` errors, see gotcha #4. If migrations ran but DB state is surprising, the globalSetup's test-container epoch may not match expectations — check `testcontainers-postgres.global.ts`.
4. **Shared-state flakiness?** If tests pass solo but fail in the suite, see gotcha #6.
5. **External service reachable?** For external lane: is `pnpm test:smee` running for webhook-dependent tests? Is `OLLAMA_URL` reachable? Is the funded wallet still funded for money tests?
6. **Am I the wrong runner?** If the user is an agent hitting a stack test locally without `dev:stack:test` running, the answer may be "push and let CI run it."

## References

- `docs/guides/testing.md` — APP_ENV=test pattern + fake adapter conventions
- `docs/guides/full-stack-testing.md` — stack-test specifics
- `docs/guides/agent-api-validation.md` — machine-agent API validation checklist (validation, not testing)
- `work/items/bug.0314.external-tests-require-more-than-env-test.md` — latest skip-gate + RPC/webhook setup bug
- `work/projects/proj.system-test-architecture.md` — mock-LLM + FakeLlmAdapter strategy
- `nodes/operator/app/tests/external/AGENTS.md` — per-lane invariants for external tests
- `.github/workflows/ci.yaml` — exact CI step list; compare against this matrix if anything above looks wrong
- CLAUDE.md — check-discipline + format-before-commit rules

## Adding a new test — fast recipe

1. Decide layer from the "picking the right layer" list. If unsure, default to the lightest that proves the behavior.
2. Drop the file into that layer's directory with the matching filename pattern (`*.test.ts`, `*.spec.ts`, or `*.int.test.ts` for component).
3. Run the layer's specific command first (`pnpm test:component`, `pnpm test:contract`, etc.), not `pnpm check`. Fastest feedback.
4. If the test needs env or infra, read the relevant config's header TSDoc — every config documents its invariants at the top.
5. If the layer is stack/e2e/money and you're an agent without infra access, open the PR and let CI run it rather than burning a session on local setup.
6. Once the new test passes in isolation, run `pnpm check:fast`. Only run `pnpm check` when ready to commit.
