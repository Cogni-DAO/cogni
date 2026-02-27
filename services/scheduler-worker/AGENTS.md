# scheduler-worker-service · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Last reviewed:** 2026-02-27
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
│   └── index.ts     # ExecutionGrantWorkerPort, ScheduleRunRepository
├── activities/      # Temporal activities (I/O via injected ports)
├── workflows/       # Temporal workflows (deterministic, no I/O)
├── adapters/        # Concrete implementations (Octokit, GitHub App auth)
│   └── ingestion/   # GitHub source adapter + token provider
├── observability/   # Logger factory (sole pino importer), redaction
├── main.ts          # Entry point: env() → makeLogger() → startSchedulerWorker() + startLedgerWorker()
├── worker.ts        # Temporal Worker lifecycle: createContainer() → createActivities()
├── ledger-worker.ts # Temporal Worker for ledger-tasks queue: createLedgerActivities()
└── health.ts        # HTTP readiness probe
```

### Hard rules (enforced by dep-cruiser)

- **activities/ and workflows/ import ports only** — never adapters/, bootstrap/, or @cogni/db-client
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
- **Env:** Validated in `src/bootstrap/env.ts` via Zod. Required: `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`, `DATABASE_URL`, `SCHEDULER_API_TOKEN` (secret), `APP_BASE_URL`, `NODE_ID`, `SCOPE_ID`, `SCOPE_KEY`. Optional: `GITHUB_REVIEW_APP_ID`, `GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64`, `GITHUB_REVIEW_INSTALLATION_ID`, `GITHUB_REPOS`, `LOG_LEVEL`, `SERVICE_NAME`, `HEALTH_PORT`.
- **Files considered API:** `src/main.ts` (entry point), `Dockerfile`

## Responsibilities

- This directory **does**: Connect to Temporal, register GovernanceScheduledRunWorkflow + CollectEpochWorkflow + FinalizeEpochWorkflow, execute scheduler activities (validateGrant, executeGraph, updateRun, createRun), ledger activities (ensureEpochForWindow, loadCursor, collectFromSource, insertReceipts, saveCursor, materializeSelection, computeAllocations, ensurePoolComponents, autoCloseIngestion, finalizeEpoch), and enrichment activities (evaluateEpochDraft, buildLockedEvaluations), handle SIGTERM/SIGINT
- This directory **does not**: Import from src/, create/modify/delete schedules (CRUD is authority), define port interfaces (those live in packages)

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

- **Internal:** `@cogni/scheduler-core` (ports), `@cogni/ingestion-core` (ports), `@cogni/attribution-ledger` (domain logic + epoch window), `@cogni/db-client` (adapters, bootstrap only), `@cogni/ids`
- **External:** `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity`, `pino`, `viem` (EIP-191 verification), `zod`

## Change Protocol

- Update this file when env vars, activities, or layer boundaries change
- Coordinate with SCHEDULER_SPEC.md and TEMPORAL_PATTERNS.md invariants
- Changes require updating docker-compose.dev.yml

## Notes

- Per NO_WORKER_RECONCILIATION: Temporal handles scheduling natively
- Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: scheduledFor comes from Schedule action
- Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API with Idempotency-Key (`temporalScheduleId:scheduledFor`)
- **Cleanup:** `VcsTokenProvider` in `@cogni/ingestion-core` should be renamed to `VcsTokenProviderPort` for consistency
