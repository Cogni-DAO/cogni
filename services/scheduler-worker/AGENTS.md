# scheduler-worker-service · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

**SCHEDULER_WORKER_SERVICE:** Temporal Worker for scheduled graph execution and ingestion. Connects to Temporal, registers workflows and activities, executes scheduled graphs via internal API. Runs independently of the Next.js app, enabling horizontal scaling.

## Pointers

- [Scheduler Spec](../../docs/spec/scheduler.md) - Full scheduler specification
- [Temporal Patterns](../../docs/spec/temporal-patterns.md) - Temporal patterns and anti-patterns
- [Services Architecture](../../docs/spec/services-architecture.md) - Service structure guidelines

## Architecture

```
src/
├── bootstrap/       # Composition root: env parsing + adapter wiring
│   ├── env.ts       # Zod-validated env singleton (config parsing only)
│   └── container.ts # Builds ServiceContainer (concrete adapters → port interfaces)
├── ports/           # Port barrel — re-exports interfaces from packages
│   └── index.ts     # ExecutionGrantWorkerPort, GraphRunRepository
├── activities/      # Temporal activities (I/O via injected ports)
├── workflows/       # Temporal workflows (deterministic, no I/O)
│   ├── stages/      # Child workflows for pipeline stage composition (CollectSources, EnrichAndAllocate)
│   └── activity-profiles.ts  # Shared proxyActivities timeout/retry config profiles
├── adapters/        # Concrete implementations (Octokit, GitHub App auth)
│   └── ingestion/   # GitHub poll adapter + webhook normalizer + token provider
├── observability/   # Logger factory (sole pino importer), redaction
├── main.ts          # Entry point: env() → makeLogger() → startSchedulerWorker() + startLedgerWorker()
├── worker.ts        # Temporal Worker lifecycle: createContainer() → createActivities()
├── ledger-worker.ts # Temporal Worker for ledger-tasks queue: createLedgerActivities()
└── health.ts        # HTTP readiness probe
```

### Hard rules (enforced by dep-cruiser)

- **WORKER_IS_DUMB**: scheduler-worker is a thin orchestration layer. It loads data, dispatches to contracts/plugins, and writes results. It contains zero domain-specific logic (no selection policies, no allocation formulas, no enrichment logic). All pipeline intelligence lives in `@cogni/attribution-pipeline-plugins`.
- **activities/ and workflows/ import ports only** — never adapters/, bootstrap/, or @cogni/db-client
- **bootstrap/container.ts is the only place** that instantiates concrete adapters
- **observability/logger.ts is the only file** that imports pino directly
- **ports/ contains no implementations** — pure type re-exports from packages
- **worker allocation stays generic** — activities/workflows dispatch allocators and selection policies through `@cogni/attribution-pipeline-contracts`, never hardcoded domain logic

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "bootstrap",
    "types"
  ]
}
```

**Critical:**

- Per WORKER_NEVER_CONTROLS_SCHEDULES: Does NOT depend on `ScheduleControlPort`
- Schema access is transitive through `@cogni/db-client`
- SCHEDULER_API_TOKEN is a secret — never log it

## Public Surface

- **Exports:** none (standalone service, not a library)
- **CLI:** `pnpm --filter @cogni/scheduler-worker-service dev|build|start`
- **Env:** Validated in `src/bootstrap/env.ts` via Zod. Required: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `DATABASE_URL`, `SCHEDULER_API_TOKEN` (secret), `APP_BASE_URL`. Optional: `GH_REVIEW_APP_ID`, `GH_REVIEW_APP_PRIVATE_KEY_BASE64`, `GH_REPOS`, `LOG_LEVEL`, `SERVICE_NAME`, `HEALTH_PORT`. Identity (`node_id`, `scope_id`, `chain_id`) read from `.cogni/repo-spec.yaml` via `@cogni/repo-spec` at bootstrap (baked into Docker image).
- **Files considered API:** `src/main.ts` (entry point), `Dockerfile`

## Responsibilities

- This directory **does**: Connect to Temporal, register GraphRunWorkflow (unified: scheduled + API + webhook) + CollectEpochWorkflow + FinalizeEpochWorkflow + CollectSourcesWorkflow + EnrichAndAllocateWorkflow (child workflows), execute scheduler activities (validateGrant, executeGraph, updateRun, createRun), ledger activities (ensureEpochForWindow, loadCursor, collectFromSource, insertReceipts, saveCursor, materializeSelection, computeAllocations, ensurePoolComponents, autoCloseIngestion, finalizeEpoch), dispatch enrichment and allocation via profile/allocator registries from `@cogni/attribution-pipeline-plugins` and `@cogni/attribution-pipeline-contracts`, resolve receipt claimants during materializeSelection (draft) and lock them at autoCloseIngestion, and produce claimant-aware finalized statements from locked claimant records × allocator output via explodeToClaimants()
- This directory **does not**: Import from src/, create/modify/delete schedules (CRUD is authority), define port interfaces (those live in packages), change ledger core contracts for plugin-specific payloads

## Usage

```bash
pnpm --filter @cogni/scheduler-worker-service dev    # requires Temporal + env vars
pnpm --filter @cogni/scheduler-worker-service build
pnpm --filter @cogni/scheduler-worker-service test
docker build -f services/scheduler-worker/Dockerfile -t scheduler-worker .
```

## Standards

- Workflows are deterministic (no I/O) — per TEMPORAL_DETERMINISM
- Activities are plain async functions — all I/O happens here
- Dependencies injected via `ServiceContainer` from `bootstrap/container.ts`
- Env validated via Zod schema in `bootstrap/env.ts` (lazy singleton)
- Graceful shutdown on SIGTERM/SIGINT

## Dependencies

- **Internal:** `@cogni/scheduler-core` (ports), `@cogni/ingestion-core` (ports), `@cogni/attribution-ledger` (domain logic + epoch window), `@cogni/attribution-pipeline-contracts` (enricher validation, profile resolution, allocator dispatch), `@cogni/attribution-pipeline-plugins` (built-in registries), `@cogni/db-client` (adapters, bootstrap only), `@cogni/repo-spec` (identity from `.cogni/repo-spec.yaml`), `@cogni/ids`
- **External:** `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity`, `@octokit/webhooks-methods` (GitHub webhook HMAC-SHA256 verification), `pino`, `viem` (EIP-712 verification), `zod`

## Change Protocol

- Update this file when env vars, activities, or layer boundaries change
- Coordinate with SCHEDULER_SPEC.md and TEMPORAL_PATTERNS.md invariants
- Changes require updating docker-compose.dev.yml

## Notes

- Per NO_WORKER_RECONCILIATION: Temporal handles scheduling natively
- Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: scheduledFor comes from Schedule action
- Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API with Idempotency-Key (`temporalScheduleId:scheduledFor` for scheduled runs, `api:{runId}` for API-triggered runs)
- **Cleanup:** `VcsTokenProvider` in `@cogni/ingestion-core` should be renamed to `VcsTokenProviderPort` for consistency
