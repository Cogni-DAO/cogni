---
id: new-temporal-workflow-guide
type: guide
title: New Temporal Workflow
status: draft
trust: draft
summary: Step-by-step cookbook for adding a new Temporal workflow with activities to the scheduler-worker service.
read_when: Building a new Temporal workflow, adding activities, or wiring a new task queue.
owner: derekg1729
created: 2026-03-09
verified: 2026-03-09
tags: [temporal, dev]
---

# New Temporal Workflow

## When to Use This

You need to add a new Temporal workflow to the `scheduler-worker` service. This covers creating the workflow, writing activities, registering them with a worker, and testing.

## Preconditions

- [ ] Familiar with [Temporal Patterns Spec](../spec/temporal-patterns.md) — invariants and anti-patterns
- [ ] Familiar with [Architecture Spec](../spec/architecture.md) — hexagonal boundaries
- [ ] `services/scheduler-worker/` builds cleanly (`pnpm check`)
- [ ] Temporal dev server running (`pnpm dev:stack` or standalone)

## Concepts

```
Workflow (deterministic)          Activity (I/O)
┌──────────────────────┐         ┌──────────────────────┐
│ Conditionals, loops  │         │ DB reads/writes      │
│ proxyActivities()    │────────>│ HTTP/API calls       │
│ executeChild()       │         │ LLM invocations      │
│ Timers, signals      │         │ File system ops      │
│ NO I/O               │         │ External services    │
└──────────────────────┘         └──────────────────────┘
```

**Hard rules** (enforced by dep-cruiser and Temporal replay):

- Workflows import `@temporalio/workflow` only — never adapters, DB clients, or `node:*`
- Activities import port interfaces only — never `bootstrap/` or concrete adapters
- `bootstrap/container.ts` is the sole place concrete adapters are instantiated

## Steps

### 1. Define Activity Functions

Create a factory that accepts port interfaces and returns activity functions.

```
services/scheduler-worker/src/activities/my-feature.ts
```

```typescript
import type { MyPort } from "../ports/index.js";
import type { Logger } from "pino";

// --- Deps (ports only) ---
export interface MyFeatureActivityDeps {
  readonly myPort: MyPort;
  readonly logger: Logger;
}

// --- Input/Output types (plain serializable objects) ---
export interface DoSomethingInput {
  readonly itemId: string;
  readonly config: Record<string, number>;
}

export interface DoSomethingOutput {
  readonly resultId: string;
  readonly ok: boolean;
}

// --- Factory ---
export function createMyFeatureActivities(deps: MyFeatureActivityDeps) {
  const { myPort, logger } = deps;

  async function doSomethingActivity(
    input: DoSomethingInput
  ): Promise<DoSomethingOutput> {
    logger.info({ itemId: input.itemId }, "doing something");
    const result = await myPort.doSomething(input.itemId, input.config);
    return { resultId: result.id, ok: true };
  }

  return { doSomethingActivity };
}

export type MyFeatureActivities = ReturnType<typeof createMyFeatureActivities>;
```

**Key patterns:**

- **Closure-based DI**: deps injected via factory, captured in closures
- **Type export**: `export type MyFeatureActivities = ReturnType<typeof createMyFeatureActivities>` — workflows import this type for `proxyActivities<T>()`
- **Serializable I/O**: all inputs/outputs must survive `JSON.stringify` → `JSON.parse`. No `Date`, no `bigint`, no functions. Use ISO strings for dates, decimal strings for bigints.
- **Idempotent**: activities may be retried — use upserts, PK constraints, or idempotency keys

### 2. Create the Workflow

Create a workflow file that orchestrates activities.

```
services/scheduler-worker/src/workflows/my-feature.workflow.ts
```

```typescript
import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";

import type { MyFeatureActivities } from "../activities/my-feature.js";
import { STANDARD_ACTIVITY_OPTIONS } from "./activity-profiles.js";

const { doSomethingActivity } = proxyActivities<MyFeatureActivities>(
  STANDARD_ACTIVITY_OPTIONS
);

export interface MyFeatureWorkflowInput {
  readonly itemId: string;
  readonly config: Record<string, number>;
}

export async function MyFeatureWorkflow(
  input: MyFeatureWorkflowInput
): Promise<void> {
  if (!input.itemId) {
    throw ApplicationFailure.nonRetryable("itemId is required");
  }

  const result = await doSomethingActivity({
    itemId: input.itemId,
    config: input.config,
  });

  if (!result.ok) {
    throw ApplicationFailure.nonRetryable("doSomething failed");
  }
}
```

**Key patterns:**

- **`proxyActivities<T>()`**: creates typed activity stubs. The type parameter is the return type of your activity factory.
- **Shared profiles**: import from `activity-profiles.ts`. Use `STANDARD_ACTIVITY_OPTIONS` for most activities. Use `EXTERNAL_API_ACTIVITY_OPTIONS` for external API calls. Keep intentionally-different configs inline with a rationale comment.
- **`ApplicationFailure.nonRetryable()`**: for validation errors that should not be retried.
- **No I/O**: the workflow file must contain zero I/O. All external calls go through `proxyActivities`.

### 3. Add a Barrel Export

Add your workflow to the appropriate barrel file so `bundleWorkflowCode` picks it up.

```
services/scheduler-worker/src/workflows/ledger-workflows.ts   (for attribution)
services/scheduler-worker/src/workflows/scheduled-run.workflow.ts  (standalone — no barrel needed)
```

If your workflow belongs to the ledger/attribution domain, add to `ledger-workflows.ts`:

```typescript
export { MyFeatureWorkflow } from "./my-feature.workflow.js";
```

If it's a standalone workflow on its own task queue, the worker references it directly via `workflowsPath`.

### 4. Wire Activities in the Worker

Activities are wired in the worker startup file. Choose the right file based on your task queue.

**Option A: Add to existing worker** (most common)

In `ledger-worker.ts` or `worker.ts`, add your activity factory:

```typescript
const myFeatureActivities = createMyFeatureActivities({
  myPort: container.myPort,
  logger: container.logger,
});

const activities = {
  ...ledgerActivities,
  ...enrichmentActivities,
  ...myFeatureActivities, // spread into the activities object
};
```

**Option B: New task queue** (rare — only for workload isolation)

Create `services/scheduler-worker/src/my-feature-worker.ts` following the pattern in `ledger-worker.ts`. Start it from `main.ts` alongside existing workers.

### 5. Wire Deps in the Container

Add your port to the service container in `bootstrap/container.ts`:

```typescript
export interface MyFeatureContainer {
  myPort: MyPort;
  logger: Logger;
}

// Inside createAttributionContainer() or a new factory:
return {
  // ...existing deps
  myPort: new DrizzleMyPortAdapter(db, logger),
};
```

### 6. Test

**Unit test** (mock activities): Use Temporal's `TestWorkflowEnvironment` — see [Temporal testing docs](https://docs.temporal.io/develop/typescript/testing).

**Stack test** (full Temporal round-trip): Follow the pattern in `tests/stack/attribution/collect-epoch-pipeline.stack.test.ts`. The key structure:

1. Create activities with real deps (or fakes for external services)
2. `bundleWorkflowCode()` compiles TS workflows into a deterministic JS bundle (~30s, run once in `beforeAll`)
3. Start a `Worker` on an **isolated task queue** (`test-${randomUUID()}`) to prevent interference
4. Create a `Client`, start the workflow, `await handle.result()`
5. Assert DB state after workflow completes
6. `afterAll`: `worker.shutdown()`, close connections

### 7. Compose with Child Workflows (Optional)

For complex multi-stage workflows, decompose into child workflows.

```
services/scheduler-worker/src/workflows/stages/my-stage.workflow.ts
```

```typescript
import { proxyActivities } from "@temporalio/workflow";
import type { MyFeatureActivities } from "../../activities/my-feature.js";
import { STANDARD_ACTIVITY_OPTIONS } from "../activity-profiles.js";

const { doSomethingActivity } = proxyActivities<MyFeatureActivities>(
  STANDARD_ACTIVITY_OPTIONS
);

export interface MyStageInput {
  readonly itemId: string;
}

export async function MyStageWorkflow(input: MyStageInput): Promise<void> {
  await doSomethingActivity({ itemId: input.itemId, config: {} });
}
```

In the parent workflow:

```typescript
import { executeChild, ParentClosePolicy } from "@temporalio/workflow";
import { MyStageWorkflow } from "./stages/my-stage.workflow.js";

await executeChild(MyStageWorkflow, {
  args: [{ itemId: "123" }],
  workflowId: `my-stage-${businessKey}`,
  parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
});
```

**Child workflow conventions:**

- `parentClosePolicy: TERMINATE` — children must not outlive parent
- No child-level retry — failures propagate to parent
- Stable `workflowId` derived from business key (idempotency)
- Input types colocated in the child workflow file
- Export from the barrel file (`ledger-workflows.ts`)

## Checklist

- [ ] Workflow contains zero I/O — only `proxyActivities` calls and deterministic logic
- [ ] Activities import port interfaces only — no concrete adapters
- [ ] Activity I/O types are plain serializable objects (no `Date`, no `bigint`, no functions)
- [ ] Activities are idempotent (safe to retry)
- [ ] Workflow exported from barrel file (for `bundleWorkflowCode`)
- [ ] Activities wired in worker startup
- [ ] Deps wired in `bootstrap/container.ts`
- [ ] Shared proxy configs used where applicable; intentional diffs have rationale comments
- [ ] `pnpm check` passes
- [ ] Stack test covers the critical path

## Related

- [Temporal Patterns Spec](../spec/temporal-patterns.md) — invariants, anti-patterns, infrastructure
- [Scheduler Spec](../spec/scheduler.md) — schedule CRUD, execution grants
- [Feature Development Guide](feature-development.md) — hexagonal layer ordering
- [New Attribution Pipeline Guide](new-attribution-pipeline.md) — building attribution-specific workflows
