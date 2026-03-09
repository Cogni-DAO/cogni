---
id: new-attribution-pipeline-guide
type: guide
title: New Attribution Pipeline
status: draft
trust: draft
summary: Step-by-step cookbook for building a new attribution pipeline — from adding plugins to composing new workflow shapes.
read_when: Adding an enricher, allocator, selection policy, or building a new pipeline shape (e.g., quarterly review vs weekly collection).
owner: derekg1729
created: 2026-03-09
verified: 2026-03-09
tags: [attribution, temporal, dev]
---

# New Attribution Pipeline

## When to Use This

You want to extend the attribution system. This guide covers three levels of change, from simplest to most complex:

1. **Add a plugin** — new enricher, allocator, or selection policy within an existing pipeline shape
2. **Create a new profile** — a new combination of existing plugins
3. **Build a new pipeline shape** — a new workflow orchestration (e.g., quarterly review)

Start from the simplest level that solves your problem.

## Preconditions

- [ ] Familiar with [Attribution Pipeline Overview](../spec/attribution-pipeline-overview.md) — end-to-end map
- [ ] Familiar with [Plugin Attribution Pipeline Spec](../spec/plugin-attribution-pipeline.md) — contracts and interfaces
- [ ] Familiar with [New Temporal Workflow Guide](new-temporal-workflow.md) — workflow basics
- [ ] `pnpm check` passes

## Architecture

```
repo-spec.yaml
     │
     │  attribution_pipeline: "cogni-v0.0"
     ▼
┌─────────────────────────────────┐
│ PipelineProfile                 │
│  enricherRefs: [echo.v0]       │  ◄── selects which plugins run
│  allocatorRef: weight-sum-v0   │
│  selectionPolicyRef: promotion │
│  defaultWeightConfig: { ... }  │
└────────────┬────────────────────┘
             │
   ┌─────────┴──────────┐
   ▼                    ▼
Enrichers          Allocators         Selection Policies
(evaluate +        (compute           (filter receipts →
 lock)              credits)           selections)
```

**Package split:**

| Package                                 | What changes            | What stays stable             |
| --------------------------------------- | ----------------------- | ----------------------------- |
| `@cogni/attribution-pipeline-contracts` | Never (framework)       | Interfaces, registries, types |
| `@cogni/attribution-pipeline-plugins`   | Often (implementations) | —                             |
| `@cogni/attribution-ledger`             | Rarely (domain)         | Types, math, epoch window     |

Dependency direction: `plugins → contracts → ledger`. Never reverse.

## Level 1: Add a Plugin

### New Enricher

An enricher scores or annotates receipts. It produces an evaluation (draft during collection, locked at review).

**1. Create the plugin directory:**

```
packages/attribution-pipeline-plugins/src/plugins/my-scorer/
├── descriptor.ts    # constants, payload type, EVALUATION_REF
└── adapter.ts       # implements EnricherAdapter
```

**2. Implement the descriptor** (`descriptor.ts`):

```typescript
export const MY_SCORER_EVALUATION_REF = "cogni.my_scorer.v0";

export interface MyScorerPayload {
  readonly scores: ReadonlyArray<{
    readonly receiptId: string;
    readonly score: number;
  }>;
}
```

**3. Implement the adapter** (`adapter.ts`):

```typescript
import type {
  EnricherAdapter,
  EnricherContext,
} from "@cogni/attribution-pipeline-contracts";
import {
  MY_SCORER_EVALUATION_REF,
  type MyScorerPayload,
} from "./descriptor.js";

export function createMyScorerAdapter(): EnricherAdapter {
  return {
    descriptor: {
      evaluationRef: MY_SCORER_EVALUATION_REF,
      algoRef: "my-scorer-algo",
      schemaRef: `${MY_SCORER_EVALUATION_REF}/1.0.0`,
      outputSchema: myScorerPayloadSchema, // Zod schema
    },

    async evaluateDraft(ctx: EnricherContext): Promise<MyScorerPayload> {
      // ctx.epochId, ctx.nodeId, ctx.attributionStore, ctx.logger
      // Read receipts via ctx.attributionStore (I/O is allowed in adapters)
      const receipts =
        await ctx.attributionStore.getSelectedReceiptsWithMetadata(ctx.epochId);
      const scores = receipts.map((r) => ({
        receiptId: r.receiptId,
        score: computeScore(r),
      }));
      return { scores };
    },

    async buildLocked(ctx: EnricherContext): Promise<MyScorerPayload> {
      // Same logic as evaluateDraft for most enrichers.
      // Called at review time to produce the locked (immutable) evaluation.
      return this.evaluateDraft(ctx);
    },
  };
}
```

**Key contracts:**

- `evaluateDraft()` — called during `CollectEpochWorkflow` (epoch is `open`)
- `buildLocked()` — called during `autoCloseIngestion` (epoch transitions to `review`)
- Both must be **idempotent** — same inputs produce the same evaluation hash
- I/O is allowed through `ctx.attributionStore` (scoped read access) and external APIs
- The `descriptor.outputSchema` (Zod) validates the return payload at runtime

**4. Register in `registry.ts`:**

```typescript
import { createMyScorerAdapter } from "./plugins/my-scorer/adapter.js";

export function createDefaultRegistries(): DefaultRegistries {
  const myScorerAdapter = createMyScorerAdapter();
  // ...
  const enrichers: EnricherAdapterRegistry = new Map([
    [echoAdapter.descriptor.evaluationRef, echoAdapter],
    [myScorerAdapter.descriptor.evaluationRef, myScorerAdapter],
  ]);
  // ...
}
```

**5. Add to a profile** (see Level 2 below) or update an existing one.

### New Allocator

An allocator takes enrichment evaluations + weight config and computes credit allocations per contributor.

```typescript
import type { AllocatorDescriptor } from "@cogni/attribution-pipeline-contracts";

export const MY_ALLOCATOR: AllocatorDescriptor = {
  algoRef: "my-budget-v0",
  requiredEvaluationRefs: ["cogni.echo.v0"],
  outputSchema: receiptUnitWeightArraySchema, // Zod schema

  async compute(context) {
    // context provides epoch data, evaluations, weight config
    // Return: ReceiptUnitWeight[] (receipt-level unit allocations)
  },
};
```

Register: `allocators.set(MY_ALLOCATOR.algoRef, MY_ALLOCATOR)`.

### New Selection Policy

A selection policy filters which receipts enter the epoch. It runs during `materializeSelection`.

```typescript
import type { SelectionPolicyDescriptor } from "@cogni/attribution-pipeline-contracts";

export const MY_SELECTION_POLICY: SelectionPolicyDescriptor = {
  policyRef: "my-filter-v0",

  select(context) {
    // context provides receipts in the epoch window
    // Return: SelectionDecision[] (which receipts to include/exclude)
  },
};
```

Register: `selectionPolicies.set(MY_SELECTION_POLICY.policyRef, MY_SELECTION_POLICY)`.

## Level 2: Create a New Profile

A profile is a named combination of plugins. It selects which enrichers run (and in what order), which allocator computes credits, and which selection policy filters receipts.

**1. Define the profile:**

```
packages/attribution-pipeline-plugins/src/profiles/my-pipeline.ts
```

```typescript
import type { PipelineProfile } from "@cogni/attribution-pipeline-contracts";

export const MY_PIPELINE_PROFILE: PipelineProfile = {
  profileId: "my-pipeline-v0.0",
  label: "My Pipeline",
  epochKind: "activity",
  selectionPolicyRef: "promotion-based",
  enricherRefs: [
    { enricherRef: "cogni.echo.v0", dependsOnEvaluations: [] },
    {
      enricherRef: "cogni.my_scorer.v0",
      dependsOnEvaluations: ["cogni.echo.v0"],
    },
  ],
  allocatorRef: "weight-sum-v0",
  defaultWeightConfig: {
    "github:pr_merged": 1000,
    "github:review_submitted": 500,
  },
};
```

**2. Register the profile:**

```typescript
// In registry.ts
const profiles: ProfileRegistry = new Map([
  [COGNI_V0_PROFILE.profileId, COGNI_V0_PROFILE],
  [MY_PIPELINE_PROFILE.profileId, MY_PIPELINE_PROFILE],
]);
```

**3. Operators adopt** by changing one line in `repo-spec.yaml`:

```yaml
attribution_pipeline: my-pipeline-v0.0
```

No workflow or activity changes needed. The existing `CollectEpochWorkflow` dispatches enrichers and allocators by profile lookup — the profile is the single configuration surface.

**Enricher ordering:**

- `enricherRefs` is an ordered list — enrichers run in declaration order
- `dependsOnEvaluations` declares which prior evaluations must exist (DAG validation at startup)
- Cycles are detected and rejected

## Level 3: Build a New Pipeline Shape

A new pipeline shape means a different workflow orchestration — different stages, different order, or different triggering logic. Examples:

- **Quarterly review pipeline** — longer window, different enrichers, human-in-the-loop evaluation
- **Real-time attribution** — webhook-triggered, no epoch window
- **Cross-scope aggregation** — collects from multiple scopes, merges

This is the most complex level. You're building a new Temporal workflow (see [New Temporal Workflow Guide](new-temporal-workflow.md)) that reuses existing child workflows and activities.

### Step 1: Decide What to Reuse

The existing pipeline decomposes into child workflows:

```
CollectEpochWorkflow (parent orchestrator)
├── Setup: compute window, derive weights, ensure epoch
├── CollectSourcesWorkflow (child)
│   └── For each source × sourceRef × stream:
│       load cursor → collect → insert receipts → save cursor
├── EnrichAndAllocateWorkflow (child)
│   └── materializeSelection → evaluateEpochDraft → computeAllocations
└── Pool + auto-close (inline, conditional)
```

Each child workflow is independently reusable. Your new pipeline can:

- **Reuse `CollectSourcesWorkflow`** if you need the same source collection logic
- **Reuse `EnrichAndAllocateWorkflow`** if you need the same enrich→allocate sequence
- **Call activities directly** if you need a different ordering or subset
- **Create new child workflows** for stages that don't exist yet

### Step 2: Create the Workflow

```
services/scheduler-worker/src/workflows/my-pipeline.workflow.ts
```

```typescript
import {
  executeChild,
  ParentClosePolicy,
  proxyActivities,
} from "@temporalio/workflow";

import type { LedgerActivities } from "../activities/ledger.js";
import { STANDARD_ACTIVITY_OPTIONS } from "./activity-profiles.js";
import { CollectSourcesWorkflow } from "./stages/collect-sources.workflow.js";

const { ensureEpochForWindow } = proxyActivities<LedgerActivities>(
  STANDARD_ACTIVITY_OPTIONS
);

export interface MyPipelineInput {
  readonly scopeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sources: Record<
    string,
    { attributionPipeline: string; sourceRefs: string[] }
  >;
}

export async function MyPipelineWorkflow(
  input: MyPipelineInput
): Promise<void> {
  // 1. Reuse epoch setup
  const epoch = await ensureEpochForWindow({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    weightConfig: {},
  });

  if (epoch.status !== "open") return;

  // 2. Reuse source collection (existing child workflow)
  await executeChild(CollectSourcesWorkflow, {
    args: [
      {
        epochId: epoch.epochId,
        sources: input.sources,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    ],
    workflowId: `collect-sources-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  });

  // 3. Custom enrichment stage (your new logic)
  await executeChild(MyCustomEnrichmentWorkflow, {
    args: [{ epochId: epoch.epochId }],
    workflowId: `my-enrichment-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  });
}
```

### Step 3: Register

1. Export from `ledger-workflows.ts` barrel
2. Wire activities in `ledger-worker.ts`
3. If new activities are needed, follow [New Temporal Workflow Guide — Step 1](new-temporal-workflow.md#1-define-activity-functions)

### Step 4: Create a Schedule (Optional)

If this pipeline runs on a schedule (like the weekly epoch collection), configure in `repo-spec.yaml` and the schedule sync picks it up. If it's triggered manually or by another workflow, skip this.

## Existing Extension Points

| Extension            | Where                                  | What changes           |
| -------------------- | -------------------------------------- | ---------------------- |
| New enricher         | `plugins/` + `registry.ts`             | Plugin code only       |
| New allocator        | `plugins/` + `registry.ts`             | Plugin code only       |
| New selection policy | `plugins/` + `registry.ts`             | Plugin code only       |
| New profile          | `profiles/` + `registry.ts`            | Config only            |
| New source adapter   | `adapters/ingestion/` + `container.ts` | Adapter + wiring       |
| New pipeline shape   | `workflows/` + `ledger-workflows.ts`   | Workflow orchestration |

## Checklist

- [ ] Plugin implements the correct contract interface (`EnricherAdapter`, `AllocatorDescriptor`, `SelectionPolicyDescriptor`)
- [ ] Plugin is registered in `createDefaultRegistries()`
- [ ] Profile references valid enricherRefs and allocatorRef
- [ ] Enricher `dependsOnEvaluations` forms a DAG (no cycles)
- [ ] `evaluateDraft()` and `buildLocked()` are idempotent (same inputs → same hash)
- [ ] All I/O types are plain serializable objects
- [ ] Child workflows use `parentClosePolicy: TERMINATE`
- [ ] Workflow exported from barrel file
- [ ] `pnpm check` passes

## Related

- [Attribution Pipeline Overview](../spec/attribution-pipeline-overview.md) — end-to-end pipeline map
- [Plugin Attribution Pipeline Spec](../spec/plugin-attribution-pipeline.md) — contract interfaces and invariants
- [New Temporal Workflow Guide](new-temporal-workflow.md) — workflow basics
- [Temporal Patterns Spec](../spec/temporal-patterns.md) — invariants, anti-patterns
