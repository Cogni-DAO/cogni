---
id: common-mistakes
type: guide
title: Common Agent Mistakes
status: active
trust: reviewed
summary: Top mistakes agents make and how to avoid them
read_when: Before implementing features, debugging failures, or reviewing code
owner: derekg1729
created: 2026-03-07
verified: 2026-03-07
tags: [agents, mistakes, troubleshooting]
---

# Common Agent Mistakes

## Architecture Violations

- Import `adapters` from `features` or `core` (layer boundary violation)
- Create files in wrong architectural layer
- Import `@langchain/*` from `src/**` (must be in `packages/langgraph-graphs/`)
- Import internal files instead of public entry points (`public.ts`, `index.ts`)

## Contract & Type Mistakes

- Create manual type definitions for contract shapes (use `z.infer`)
- Modify contracts without updating dependent routes/services
- Skip contract-first: always update `src/contracts/*.contract.ts` before touching routes
- Two PRs claim "parity" on a shared policy without a parity test that runs **identical fixtures** through **both** implementations. Parallel test suites that each pass independently prove only self-consistency, not agreement. See `tests/ci-invariants/single-node-scope-parity.spec.ts` for the pattern (shared JSON fixtures + reference classifier; both sides assert against the same expected outcomes).

## Tooling Misunderstandings

- Use `console.log` (use Pino server logger / clientLogger for browser)
- Running `pnpm check` after every small change — it takes 5-10 minutes. Run the specific suite for your change instead:

### Run the right test suite for your change

| What you changed           | Run this                               |
| -------------------------- | -------------------------------------- |
| TypeScript types / imports | `pnpm typecheck`                       |
| Lint / formatting          | `pnpm lint:fix && pnpm format`         |
| `src/` unit logic          | `pnpm test:unit`                       |
| Contract shapes            | `pnpm test:contract`                   |
| `packages/` code           | `pnpm test:packages:local`             |
| `services/` code           | `pnpm test:services:local`             |
| Architecture / imports     | `pnpm arch:check`                      |
| AGENTS.md / docs           | `pnpm check:docs`                      |
| Specific test file         | `pnpm vitest run path/to/file.test.ts` |

Run `pnpm check` as a final gate before commit — not after every edit.

**Do not run `pnpm check:full`** — it requires Docker and full stack infrastructure. Agents should use `pnpm check` only. CI handles the full validation.

## Documentation Mistakes

- Restate root AGENTS.md policies in subdirectory files
- Add "none" sections that add no information
- Write AGENTS.md for behavior details (keep those in file headers)

## When Things Fail

### dependency-cruiser violations

Output format: `error  no-<rule-name>: <from-path> → <to-path>`

Fix: check the `may_import` in the source directory's AGENTS.md and `.dependency-cruiser.cjs`. Move the import to the correct layer.

### Lint / format errors

Run `pnpm lint:fix && pnpm format` to auto-fix most issues.

### Architecture test failures

Check `tests/arch/` — these validate layer boundaries. If a new import path is legitimate, update `.dependency-cruiser.cjs` and the relevant AGENTS.md boundaries.

### Type errors after contract changes

Update all consumers: `z.infer<typeof SomeContract>` will propagate the change. Search for the contract name to find all dependents.
