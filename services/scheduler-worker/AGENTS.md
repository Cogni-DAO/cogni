# scheduler-worker-service · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

**SCHEDULER_WORKER_SERVICE:** Thin Temporal Worker composition root. Connects to Temporal, registers workflows from `@cogni/temporal-workflows`, wires activity implementations with concrete deps, and starts workers. Runs independently of the Next.js app, enabling horizontal scaling.

## Pointers

- [Scheduler Spec](../../docs/spec/scheduler.md) - Full scheduler specification
- [Temporal Patterns](../../docs/spec/temporal-patterns.md) - Temporal patterns and anti-patterns
- [Temporal Workflows Package](../../packages/temporal-workflows/AGENTS.md) - Workflow definitions + activity interfaces
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
├── adapters/        # Concrete implementations (Octokit, GitHub App auth)
│   └── ingestion/   # GitHub poll adapter + webhook normalizer + token provider
├── observability/   # Logger factory (sole pino importer), redaction
├── main.ts          # Entry point: env() → makeLogger() → startSchedulerWorker() + startLedgerWorker()
├── worker.ts        # Temporal Worker lifecycle: workflowsPath → @cogni/temporal-workflows/scheduler
├── ledger-worker.ts # Temporal Worker for ledger-tasks: workflowsPath → @cogni/temporal-workflows/ledger
└── health.ts        # HTTP readiness probe
```

**Note:** Workflow definitions, activity type interfaces, activity profiles, and review domain logic live in `@cogni/temporal-workflows`. This service is the composition root that wires activities and starts workers.

### Hard rules (enforced by dep-cruiser)

- **WORKER_IS_DUMB**: scheduler-worker is a thin composition root. It wires activity implementations with concrete deps and starts Temporal workers. Domain-specific logic lives in packages.
- **activities/ import ports only** — never adapters/, bootstrap/, or @cogni/db-client
- **bootstrap/container.ts is the only place** that instantiates concrete adapters
- **observability/logger.ts is the only file** that imports pino directly
- **ports/ contains no implementations** — pure type re-exports from packages

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

- This directory **does**: Connect to Temporal, register workflows from `@cogni/temporal-workflows` (GraphRunWorkflow, PrReviewWorkflow, CollectEpochWorkflow, FinalizeEpochWorkflow, CollectSourcesWorkflow, EnrichAndAllocateWorkflow), implement and wire activities with concrete deps (scheduler, review, ledger, enrichment), dispatch enrichment and allocation via `@cogni/attribution-pipeline-plugins` registries
- This directory **does not**: Define workflow logic (that's in `@cogni/temporal-workflows`), import from src/, create/modify/delete schedules (CRUD is authority), define port interfaces (those live in packages)

## Dependencies

- **Internal:** `@cogni/temporal-workflows` (workflow defs, activity types, domain logic), `@cogni/scheduler-core` (ports), `@cogni/ingestion-core` (ports), `@cogni/attribution-ledger` (domain logic + epoch window), `@cogni/attribution-pipeline-contracts` (enricher validation, profile resolution, allocator dispatch), `@cogni/attribution-pipeline-plugins` (built-in registries), `@cogni/db-client` (adapters, bootstrap only), `@cogni/repo-spec` (identity from `.cogni/repo-spec.yaml`), `@cogni/ids`
- **External:** `@temporalio/worker`, `@temporalio/activity`, `@octokit/webhooks-methods`, `pino`, `viem`, `zod`

## Change Protocol

- Update this file when env vars, activities, or layer boundaries change
- Coordinate with `@cogni/temporal-workflows` AGENTS.md when activity signatures change
- Changes require updating docker-compose.dev.yml

## Notes

- Per NO_WORKER_RECONCILIATION: Temporal handles scheduling natively
- Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: scheduledFor comes from Schedule action
- Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API with Idempotency-Key
- Workflow definitions extracted to `@cogni/temporal-workflows` (bug.0193)
