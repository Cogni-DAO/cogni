---
id: task.0120
type: task
title: "Extract unified repo-spec reader package (`@cogni/repo-spec`)"
status: needs_merge
priority: 1
rank: 1
estimate: 3
summary: "Extract `.cogni/repo-spec.yaml` parsing into a shared `packages/repo-spec` package with Zod schemas, typed accessors, and pluggable I/O — so both the app and scheduler-worker (and future multi-tenant gateway) share one validated reader."
outcome: "A `@cogni/repo-spec` package owns all repo-spec schemas and parsing. The app's `src/shared/config/repoSpec.*` modules are thin wrappers that delegate to the package. The scheduler-worker imports the package directly instead of duplicating config via env vars. The package accepts arbitrary YAML content (string or parsed object), enabling future multi-tenant use where repo-specs are fetched from external repos."
spec_refs: node-operator-contract-spec
assignees: derekg1729
credit:
project: proj.operator-plane
branch: task/0120-repo-spec-reader
pr: https://github.com/Cogni-DAO/node-template/pull/504
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-01
updated: 2026-03-02
labels: [config, packages, multi-tenant]
external_refs:
---

# Extract Unified Repo-Spec Reader Package (`@cogni/repo-spec`)

## Context

The `.cogni/repo-spec.yaml` file is the governance-managed configuration for a Cogni node — identity, payments, ledger approvers, governance schedules, DAO contracts. Today the reader lives in `src/shared/config/repoSpec.schema.ts` + `repoSpec.server.ts` and is tightly coupled to the Next.js app:

- **Hardcoded `process.cwd()` path** — assumes a single static file at `.cogni/repo-spec.yaml`
- **Imports `CHAIN_ID` from `src/shared/web3/chain.ts`** — couples schema validation to app-level constants
- **scheduler-worker can't use it** — the worker runs in a separate process with no `src/` access; it currently receives config via env vars (`NODE_ID`, `SCOPE_ID`, `CHAIN_ID`) duplicated from repo-spec
- **Future multi-tenant gateway** (proj.operator-plane, story.0116) needs to parse repo-specs from _external_ repos (GitHub App installations) — the reader must accept arbitrary YAML, not just the local file

Per **REPO_SPEC_AUTHORITY** (node-operator-contract spec): "Node authors `.cogni/repo-spec.yml`; Operator consumes snapshot+hash; Operator never invents policy." The package must be the single canonical parser that both Node and Operator code use.

## Requirements

### Package structure

- [ ] New package at `packages/repo-spec/` following existing package conventions (`@cogni/repo-spec`, tsup build, `dist/` exports)
- [ ] **Zod schemas** moved from `src/shared/config/repoSpec.schema.ts` → `packages/repo-spec/src/schema.ts` (single source of truth)
- [ ] **Pure parse function**: `parseRepoSpec(input: string | unknown): RepoSpec` — accepts raw YAML string or pre-parsed object, validates with Zod, returns typed result. No I/O, no caching, no side effects.
- [ ] **Typed accessors**: Pure functions that extract specific config sections from a parsed `RepoSpec` — e.g. `extractLedgerConfig(spec, chainId)`, `extractPaymentConfig(spec, chainId)`, `extractGovernanceConfig(spec)`, `extractLedgerApprovers(spec)`. Chain ID is a parameter, not imported.
- [ ] **No `src/` imports** — the package must not import from `src/shared/web3/chain.ts` or any app-level module. `chainId` is always passed as a parameter where needed.
- [ ] All types exported: `RepoSpec`, `LedgerConfig`, `GovernanceConfig`, `InboundPaymentConfig`, `GovernanceSchedule`, etc.

### App migration

- [ ] `src/shared/config/repoSpec.schema.ts` becomes a **re-export barrel** from `@cogni/repo-spec` (or is deleted, with imports updated)
- [ ] `src/shared/config/repoSpec.server.ts` becomes a **thin wrapper** — handles file I/O (`loadRepoSpec()` reads from disk), caching (module-level singletons), and chain validation (passes `CHAIN_ID` to package functions). No schema logic remains here.
- [ ] All existing consumers (`approver-guard.ts`, `finalize/route.ts`, `review/route.ts`, facades, adapters) continue to work unchanged — they import from `src/shared/config/index.ts` which delegates to the package.

### Scheduler-worker migration

- [ ] `services/scheduler-worker/` adds `@cogni/repo-spec` as a workspace dependency
- [ ] Worker bootstrap reads `.cogni/repo-spec.yaml` via the package (baked into Docker image) instead of relying on `NODE_ID`/`SCOPE_ID`/`CHAIN_ID` env vars
- [ ] Remove `NODE_ID`, `SCOPE_ID`, `CHAIN_ID` from `env.ts` Zod schema (or demote to optional overrides)
- [ ] Remove bare passthrough lines from both docker-compose files
- [ ] Remove from `.env.local.example` and `.env.test.example`
- [ ] Update `container.ts` to source identity from parsed repo-spec
- [ ] Bake `.cogni/repo-spec.yaml` into scheduler-worker Dockerfile

### Tests

- [ ] Unit tests for `parseRepoSpec()` — valid YAML, invalid YAML, missing fields, extra fields
- [ ] Unit tests for each accessor function — happy path + edge cases
- [ ] Existing `tests/unit/shared/config/repoSpec.server.test.ts` continues to pass (may need import path updates)

## Allowed Changes

- `packages/repo-spec/` — **new** package (schema, parse, accessors, tests, package.json, tsconfig, tsup config, AGENTS.md)
- `src/shared/config/repoSpec.schema.ts` — replace with re-exports or delete
- `src/shared/config/repoSpec.server.ts` — slim down to I/O + caching wrapper
- `src/shared/config/index.ts` — update re-exports if needed
- `services/scheduler-worker/package.json` — add workspace dep
- `services/scheduler-worker/src/bootstrap/env.ts` — remove or demote `NODE_ID`/`SCOPE_ID`/`CHAIN_ID`
- `services/scheduler-worker/src/bootstrap/container.ts` — source identity from repo-spec package
- `services/scheduler-worker/Dockerfile` — bake `.cogni/repo-spec.yaml`
- `platform/infra/services/runtime/docker-compose.dev.yml` — remove `NODE_ID`/`SCOPE_ID`/`CHAIN_ID` passthrough
- `platform/infra/services/runtime/docker-compose.yml` — same
- `.env.local.example` — remove `NODE_ID`/`SCOPE_ID`/`CHAIN_ID`
- `.env.test.example` — same
- `tests/unit/shared/config/repoSpec.server.test.ts` — update imports if needed
- `tests/unit/packages/repo-spec/` — **new** test directory
- `pnpm-workspace.yaml` — add `packages/repo-spec` if not auto-discovered
- `tsconfig.json` (root) — add path alias if needed

## Plan

- [ ] Step 1: Scaffold `packages/repo-spec/` — package.json, tsconfig, tsup config, AGENTS.md. Verify `pnpm install --offline --frozen-lockfile` resolves workspace.
- [ ] Step 2: Move Zod schemas from `src/shared/config/repoSpec.schema.ts` → `packages/repo-spec/src/schema.ts`. Add `parseRepoSpec()` function (accepts string or object). Export all types from barrel `index.ts`.
- [ ] Step 3: Add pure accessor functions — `extractPaymentConfig(spec, chainId)`, `extractLedgerConfig(spec)`, `extractGovernanceConfig(spec)`, `extractLedgerApprovers(spec)`, `extractNodeId(spec)`, `extractScopeId(spec)`.
- [ ] Step 4: Write unit tests in `tests/unit/packages/repo-spec/` — parse happy/sad paths, accessor edge cases.
- [ ] Step 5: Migrate `src/shared/config/repoSpec.server.ts` to delegate to package — keep file I/O, caching, and `CHAIN_ID` validation here. Update `repoSpec.schema.ts` to re-export from package.
- [ ] Step 6: Verify all existing consumers compile and existing tests pass. `pnpm check`.
- [ ] Step 7: Wire scheduler-worker to `@cogni/repo-spec` — add workspace dep, bake `.cogni/repo-spec.yaml` into Dockerfile, update `container.ts` to read identity from parsed repo-spec.
- [ ] Step 8: Remove env var hack — drop `NODE_ID`/`SCOPE_ID`/`CHAIN_ID` from `env.ts`, docker-compose files, `.env.*.example`. Verify worker still boots correctly.
- [ ] Step 9: Cleanup — file headers, `pnpm check`, update work item status.

## Design Notes

### Why a package, not just moving files

The current `src/shared/config/` path is only accessible to the Next.js app. The scheduler-worker is a separate TypeScript project under `services/` with its own `tsconfig.json` and **NO_CROSS_IMPORTS** invariant. A workspace package (`packages/repo-spec`) is the established pattern for sharing pure domain logic across services (see `@cogni/attribution-ledger`, `@cogni/scheduler-core`).

### Pure parse + thin server wrapper

The package owns **schema + validation + typed extraction**. The app server wrapper owns **I/O + caching + CHAIN_ID sourcing**. This means the same `parseRepoSpec()` can be called with:

- A local file read (`fs.readFileSync`) — current app behavior
- A string fetched from GitHub API — future multi-tenant gateway
- A test fixture — unit tests, no disk needed

### Cleanup: env var hack for NODE_ID / SCOPE_ID / CHAIN_ID

A quick fix added `NODE_ID`, `SCOPE_ID`, and `CHAIN_ID` as env vars passed through docker-compose to the scheduler-worker (bare passthrough, Zod-validated in `env.ts`). This is a hack — these values are deterministic from `.cogni/repo-spec.yaml` which is already committed to the repo. Propagating them through `.env` files, docker-compose, deploy workflows, and `deploy.sh` is fragile and redundant.

**This task should eliminate the env var duplication.** Once the scheduler-worker can import `@cogni/repo-spec` and call `parseRepoSpec()` on the baked-in `.cogni/repo-spec.yaml`, the `NODE_ID`/`SCOPE_ID`/`CHAIN_ID` env vars become unnecessary for the worker. The cleanup includes:

- Remove `NODE_ID`, `SCOPE_ID`, `CHAIN_ID` from `services/scheduler-worker/src/bootstrap/env.ts` (or make them pure overrides)
- Remove the bare passthrough lines from both docker-compose files
- Remove from `.env.local.example` and `.env.test.example`
- Update `container.ts` to source identity from the package instead of env vars
- Bake `.cogni/repo-spec.yaml` into the scheduler-worker Docker image (COPY in Dockerfile)

### What this does NOT do

- Does NOT add GitHub API fetching for external repo-specs. That's task.0122 / story.0116 scope.
- Does NOT modify the repo-spec YAML format or add new fields.

## Validation

**Command:**

```bash
pnpm check && pnpm test tests/unit/packages/repo-spec/ && pnpm test tests/unit/shared/config/
```

**Expected:** All tests pass. Package builds. No type errors. Existing consumers unchanged.

## Review Checklist

- [ ] **Work Item:** `task.0120` linked in PR body
- [ ] **Spec:** REPO_SPEC_AUTHORITY, NO_CROSS_IMPORTS upheld
- [ ] **Tests:** parse + accessor tests, existing server tests still pass
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-

## Review Feedback

### Revision 1 — STATELESS_CONTAINERS concern (2026-03-02) — WITHDRAWN

Initially flagged Dockerfile `COPY .cogni/repo-spec.yaml` as a STATELESS_CONTAINERS violation. After analysis: the app already bakes repo-spec at build time via Next.js standalone file tracing. Both app and services follow the same model — config baked at build, picked up on each deploy. This is correct for single-node deployments where config changes should go through the build/deploy pipeline.

**Added:** `docs/guides/create-service.md` Step 3b documenting the pattern for future services.
