---
id: bug.0193
type: bug
title: "scheduler-worker houses workflow definitions — should be thin composition root"
status: needs_implement
priority: 3
rank: 50
estimate: 3
summary: "services/scheduler-worker/ contains 3,738 lines of business code (workflows + activities + domain) vs 1,949 lines of bootstrap. Workflows are deterministic/sandboxed and belong in a shared package. Worker should be import + register + start."
outcome: "packages/temporal-workflows/ owns all workflow definitions + activity type contracts; services/scheduler-worker/ is thin composition root (bootstrap + activity wiring only)"
spec_refs: [temporal-patterns-spec, packages-architecture-spec]
assignees: []
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-03-24
updated: 2026-03-25
labels: [scheduler, architecture]
---

# scheduler-worker houses workflow definitions

## Symptoms

- Adding `PrReviewWorkflow` required adding `@cogni/langgraph-graphs` to the worker's Dockerfile — a graph package has no business being in the worker binary
- Worker service is 66% business logic, 34% infrastructure
- Every new webhook→graph flow will add more domain code to the worker
- App code starting workflows (dispatch.server.ts, completion.server.ts, finalize route) constructs args inline with no shared type contract — drift risk

## Root Cause

Workflow definitions live in `services/scheduler-worker/src/workflows/` instead of a shared package. The worker should be a thin composition root: import workflows, wire activities, start.

## Design

### Outcome

Workflow definitions and their type contracts become a shared package importable by both the worker (for `workflowsPath` bundling) and the app (for type-safe workflow input construction). Worker becomes a thin composition root.

### Approach

**Solution**: Create `packages/temporal-workflows/` containing all workflow definitions, activity type interfaces, activity profiles, and workflow I/O types. Worker keeps activity implementations, domain logic, adapters, bootstrap, and observability.

**Reuses**:

- Existing package shape from `packages/scheduler-core/` (capability package pattern per packages-architecture spec)
- Existing `tsup` + `tsc -b` composite build pipeline
- Existing `activity-profiles.ts` and workflow barrel pattern — moved, not rewritten
- Temporal SDK's native `proxyActivities<T>()` for typed activity proxies

**Rejected**:

1. **Generic `Step<Input, Output>` framework** — Temporal SDK already provides typed composition via `proxyActivities<T>()`, typed workflow functions, and `executeChild()`. A custom Step abstraction adds indirection without value. The existing workflows are already well-typed with explicit interfaces.

2. **Separate `packages/temporal-activities/` for activity types** — Only ~4 interfaces with ~20 functions total. Not enough surface to justify a separate package. Co-locating activity type interfaces with the workflows that consume them is simpler and follows the "keep together what changes together" principle.

3. **Plugin architecture for workflows** — The attribution pipeline's descriptor+adapter+profile pattern is for variable-step pipelines where different configurations select different enrichers. Workflows are fixed orchestrations, not pluggable pipelines. Wrong abstraction.

4. **Moving `domain/review.ts` to the package** — Only consumed by `activities/review.ts` (which stays in the worker). Not imported by any workflow. Moving it creates a package dependency on `@cogni/repo-spec` for no consumer benefit. If more domain modules appear that workflows need, reconsider.

### Package structure

```
packages/temporal-workflows/
├── src/
│   ├── index.ts                          # Public type exports ONLY (safe to import anywhere)
│   ├── scheduler.ts                      # Barrel: GraphRunWorkflow, PrReviewWorkflow
│   ├── ledger.ts                         # Barrel: CollectEpoch, Finalize, stages
│   ├── workflows/
│   │   ├── graph-run.workflow.ts          # (moved from worker)
│   │   ├── pr-review.workflow.ts          # (moved from worker)
│   │   ├── collect-epoch.workflow.ts      # (moved from worker)
│   │   ├── finalize-epoch.workflow.ts     # (moved from worker)
│   │   └── stages/
│   │       ├── collect-sources.workflow.ts
│   │       └── enrich-and-allocate.workflow.ts
│   ├── activity-types.ts                 # Activity interface definitions (SchedulerActivities, ReviewActivities, LedgerActivities, EnrichmentActivities)
│   └── activity-profiles.ts              # Shared timeout/retry configs (moved from worker)
├── tests/
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── AGENTS.md
```

### Key design decisions

**1. Subpath exports per task queue**

The package exposes three entry points:

| Export                                | Contains                                          | Consumed by                                                      |
| ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `@cogni/temporal-workflows`           | Types only (inputs, outputs, activity interfaces) | App (type-safe workflow starts), worker (activity type checking) |
| `@cogni/temporal-workflows/scheduler` | Workflow functions for scheduler-tasks queue      | Worker `workflowsPath` only                                      |
| `@cogni/temporal-workflows/ledger`    | Workflow functions for ledger-tasks queue         | Worker `workflowsPath` only                                      |

The main entry exports **only types** — importing it from the app cannot accidentally pull workflow sandbox code into Next.js. The subpath exports contain actual workflow functions and are only used by the worker's `workflowsPath` config.

**2. Explicit activity type interfaces**

Currently workflows import activity types via `import type { Activities } from "../activities/index.js"` — a type-only import that couples the package boundary. After extraction, activity types become explicit interfaces in the package:

```typescript
// packages/temporal-workflows/src/activity-types.ts
export interface SchedulerActivities {
  validateGrantActivity(input: ValidateGrantInput): Promise<void>;
  createGraphRunActivity(input: CreateGraphRunInput): Promise<void>;
  executeGraphActivity(input: ExecuteGraphInput): Promise<ExecuteGraphResult>;
  updateGraphRunActivity(input: UpdateGraphRunInput): Promise<void>;
}

export interface ReviewActivities {
  createCheckRunActivity(input: CreateCheckRunInput): Promise<number>;
  fetchPrContextActivity(input: FetchPrContextInput): Promise<PrContext>;
  postReviewResultActivity(input: PostReviewResultInput): Promise<void>;
}
// ... LedgerActivities, EnrichmentActivities
```

The worker's `createActivities()` factory returns satisfy these interfaces. TypeScript enforces the contract at build time. This is the Temporal best practice: explicit activity interfaces rather than inferred `ReturnType<typeof factory>`.

**3. Worker `workflowsPath` resolution**

```typescript
// services/scheduler-worker/src/worker.ts (after)
workflowsPath: require.resolve("@cogni/temporal-workflows/scheduler");

// services/scheduler-worker/src/ledger-worker.ts (after)
workflowsPath: require.resolve("@cogni/temporal-workflows/ledger");
```

The Temporal SDK's webpack bundler follows the import graph from `workflowsPath`. Since the package contains only deterministic code (workflows + `@temporalio/workflow` + pure helpers like `computeEpochWindowV1`), the bundle stays clean.

**4. What stays in the worker**

| Category      | Files                                                   | Why stays                                              |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Bootstrap     | `env.ts`, `container.ts`                                | Runtime wiring, env vars, concrete adapters            |
| Activities    | `activities/*.ts`                                       | Need injected deps (Octokit, DB adapters, HTTP client) |
| Domain        | `domain/review.ts`                                      | Only consumed by activities, not workflows             |
| Adapters      | `adapters/ingestion/*`                                  | Concrete GitHub/Octokit implementations                |
| Observability | `observability/*`                                       | pino, metrics, redaction — runtime concerns            |
| Workers       | `main.ts`, `worker.ts`, `ledger-worker.ts`, `health.ts` | Process lifecycle                                      |
| Enrichers     | `enrichers/work-item-linker.ts`                         | Plugin implementation                                  |

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TEMPORAL_DETERMINISM: Package contains zero I/O — only `@temporalio/workflow` imports, pure functions, and type definitions (spec: temporal-patterns-spec)
- [ ] NO_SRC_IMPORTS: Package never imports `@/` or `src/**` paths (spec: packages-architecture-spec)
- [ ] NO_SERVICE_IMPORTS: Package never imports from `services/` (spec: packages-architecture-spec)
- [ ] COMPOSITE_BUILD: Package uses TypeScript composite mode with `tsc -b` (spec: packages-architecture-spec)
- [ ] DIST_EXPORTS: Package exports point to `dist/` for runtime resolution (spec: packages-architecture-spec)
- [ ] PURE_LIBRARY: Package has no process lifecycle — no ports, no env vars, no health checks (spec: packages-architecture-spec)
- [ ] ACTIVITY_TYPES_EXPLICIT: Activity types are explicit interfaces in the package, not `ReturnType<typeof factory>` (enables clean package→service boundary)
- [ ] WORKER_REMAINS_THIN: After extraction, worker contains only bootstrap + activity implementations + domain + adapters + observability
- [ ] SUBPATH_ISOLATION: Main package entry (`@cogni/temporal-workflows`) exports types only — workflow functions only via subpath exports
- [ ] PORT_THEN_VERIFY: Worker activity factories must satisfy package-defined activity interfaces (`satisfies SchedulerActivities`)
- [ ] SIMPLE_SOLUTION: No custom Step<I,O> framework, no plugin architecture for workflows — uses Temporal SDK patterns directly
- [ ] ARCHITECTURE_ALIGNMENT: Follows capability package shape per packages-architecture spec

### Files

**Create:**

- `packages/temporal-workflows/package.json` — workspace package with `@temporalio/workflow`, `@cogni/attribution-ledger`, `@cogni/ids` deps
- `packages/temporal-workflows/tsconfig.json` — composite, ESM, strict
- `packages/temporal-workflows/tsup.config.ts` — node platform, 3 entry points (index, scheduler, ledger)
- `packages/temporal-workflows/src/index.ts` — type-only barrel (inputs, outputs, activity interfaces)
- `packages/temporal-workflows/src/scheduler.ts` — workflow barrel for scheduler queue
- `packages/temporal-workflows/src/ledger.ts` — workflow barrel for ledger queue
- `packages/temporal-workflows/src/activity-types.ts` — explicit activity interfaces extracted from factory return types
- `packages/temporal-workflows/src/activity-profiles.ts` — moved from worker
- `packages/temporal-workflows/src/workflows/*.ts` — all workflow files moved from worker
- `packages/temporal-workflows/AGENTS.md` — package docs

**Modify:**

- `services/scheduler-worker/src/worker.ts` — `workflowsPath` → resolve from package; remove local workflow imports
- `services/scheduler-worker/src/ledger-worker.ts` — same
- `services/scheduler-worker/src/activities/*.ts` — import activity interfaces from package, add `satisfies` annotations
- `services/scheduler-worker/package.json` — add `@cogni/temporal-workflows` dep, remove `@temporalio/workflow` (workflows no longer local)
- `services/scheduler-worker/AGENTS.md` — update architecture tree, note workflow extraction
- Root `tsconfig.json` — add `packages/temporal-workflows` to references
- Root `package.json` — add `@cogni/temporal-workflows: workspace:*`
- `.dependency-cruiser.cjs` — add forbidden rule: `packages/temporal-workflows` must not import `services/` or `src/`
- `biome/base.json` — add tsup/vitest config overrides
- `docs/spec/temporal-patterns.md` — update file pointers to new package path

**Delete:**

- `services/scheduler-worker/src/workflows/` — entire directory (moved to package)

**Test:**

- `packages/temporal-workflows/tests/` — unit tests for pure workflow logic (epoch window derivation, conditional branching)
- Existing stack tests continue to work (they start workflows by string name, not import)

### Migration strategy

Port, don't rewrite. Workflow files are copied verbatim — only import paths change:

- `../activities/index.js` → `./activity-types.js` (now importing the interface, not the factory return type)
- `./activity-profiles.js` → stays same (co-located in package)
- `./graph-run.workflow.js` → stays same (co-located in package)
- `../activities/review.js` → `./activity-types.js`
- `../activities/ledger.js` → `./activity-types.js`
- `../activities/enrichment.js` → `./activity-types.js`

No business logic changes. No new features. Pure structural move.

## Validation

```bash
pnpm check        # static: types + lint + boundary enforcement
pnpm check:docs   # AGENTS.md validation
```

Stack tests validate the Temporal bundler correctly resolves workflows from the package (`workflowsPath` → package dist/).

## Attribution

-
