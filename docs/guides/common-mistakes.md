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

## Tooling Misunderstandings

- Use `console.log` (use Pino server logger / clientLogger for browser)
- Skip `pnpm check` before commit

### What `pnpm check` runs

- `pnpm packages:build` — build workspace packages
- `pnpm typecheck` — TypeScript compiler check
- `pnpm lint` — ESLint + Biome
- `pnpm format:check` — Prettier
- `pnpm test:core` — unit tests (core, features, shared)
- `pnpm test:packages:local` — package unit tests
- `pnpm test:services:local` — service unit tests
- `pnpm check:docs` — AGENTS.md documentation lint
- `pnpm check:root-layout` — root layout validation
- `pnpm arch:check` — dependency-cruiser architecture enforcement

### What `pnpm check` does NOT run

- `pnpm build` (Next.js production build) — a change can pass `check` but fail `build`
- Component tests (`pnpm test:component`) — requires testcontainers
- Stack tests (`pnpm test:stack:*`) — requires running server + DB
- E2E tests (`pnpm e2e`) — requires full Docker stack

**Runtime:** 5-10 minutes. Not a quick lint.

For CI parity: use `pnpm check:full` (much longer, needs Docker).

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
