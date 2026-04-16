# Handoff: task.0248 Phase 2 — @cogni/graph-execution-host

## Prereqs

Phase 1 must be merged to `integration/multi-node` first (node-core, node-contracts, node-shared). Phase 2 is tracked as **task.0250** but is part of the task.0248 extraction sequence.

## What

Extract the AI execution stack (~20 files) from `apps/operator/src/` into `packages/graph-execution-host/`. This package is consumed by both Next.js apps AND `services/scheduler-worker/` — it must be PURE_LIBRARY (no env, no Next.js, no process lifecycle).

## Files to extract

The AI execution stack lives in:

- `src/adapters/server/ai/` — decorators (billing, observability, preflight, usage-commit), aggregating executor, providers
- `src/bootstrap/graph-executor.factory.ts` — factory wiring

Key files: `billing-executor.decorator.ts`, `billing-enrichment.decorator.ts`, `observability-executor.decorator.ts`, `preflight-credit-check.decorator.ts`, `usage-commit.decorator.ts`, `aggregating-executor.ts`.

## Dependencies

These files depend on:

- `@cogni/ai-core` (AiEvent, UsageFact, executor types)
- `@cogni/graph-execution-core` (GraphExecutorPort, RunContext)
- `@cogni/node-core` (pricing, billing types)
- Ports: `AccountService`, `AiTelemetryPort`, `UsageService`

They do NOT depend on Next.js, env loading, or DB clients directly — ports are injected.

## Porting playbook (proven in Phase 1)

1. **Create package scaffold** — `packages/graph-execution-host/` with package.json, tsconfig.json, tsup.config.ts, AGENTS.md. Copy patterns from `packages/node-core/`.
2. **Copy files verbatim** — never rewrite business logic. Change only import paths.
3. **Fix imports** — `@/` paths become relative or `@cogni/*` workspace imports.
4. **Build barrel** — `src/index.ts` re-exporting the public surface. Watch for name collisions (use `grep "^export" *.ts | sort` to check).
5. **Wire monorepo** — root tsconfig reference, biome override, workspace dep in consuming apps + scheduler-worker.
6. **Rewire consumers** — change all `@/adapters/server/ai/*` imports to `@cogni/graph-execution-host`.
7. **Delete originals** — from all 4 apps. Keep arch probes.
8. **Merge duplicate imports** — sed creates duplicates when two old paths collapse to one barrel.
9. **Validate** — `pnpm check:fast`.

## Gotchas from Phase 1

- **Missing deps**: Audit ALL `from "@cogni/*"` in the package source. Every one needs a `dependencies` entry in package.json AND a tsconfig `references` entry. The node-core extraction missed `@cogni/attribution-ledger` — caught in review.
- **Barrel collisions**: Two files exporting the same name → TS2308. Use selective re-exports for the less-used one. Grep consumers to decide which name wins.
- **Biome auto-sort**: Pre-commit hook reorders exports alphabetically. Don't fight it — section comments may drift.
- **Main workspace needs `packages:build`**: After merge, the main workspace needs `pnpm packages:build` before tests pass (packages resolve via `dist/`).

## Validation

```bash
pnpm check:fast     # during iteration
pnpm check          # once before commit
```

## Links

- Work item: `work/items/task.0248.node-platform-package-extraction.md` (Phase 2 section)
- Related task: `task.0250` (graph-execution-host design)
- Packages spec: `docs/spec/packages-architecture.md`
- Graph execution spec: `docs/spec/graph-execution.md`
