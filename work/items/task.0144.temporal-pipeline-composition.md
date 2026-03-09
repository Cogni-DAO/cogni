---
id: task.0144
type: task
status: needs_implement
title: "Typed Temporal pipeline composition — shared proxy configs, child workflows, stage I/O types"
priority: 1
rank: 5
estimate: 3
summary: "Decompose CollectEpochWorkflow into typed child workflows for reusable pipeline stages, extract shared activity proxy configs, and define stage I/O interfaces for compile-time safe workflow composition."
outcome: "New attribution workflows can be composed from typed, reusable pipeline stages (child workflows) rather than built as monoliths. CollectEpochWorkflow delegates to CollectSourcesWorkflow and EnrichAndAllocateWorkflow, each independently retryable and visible in Temporal UI."
spec_refs:
  - temporal-patterns-spec
  - plugin-attribution-pipeline-spec
assignees: []
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [attribution, temporal, architecture, dx]
external_refs:
---

# Typed Temporal Pipeline Composition

## Problem

`CollectEpochWorkflow` is a 10-step sequential monolith (227 lines). Adding, reordering, or conditionally skipping stages requires editing one large function. Activity proxy configs (timeout/retry) are copy-pasted across 3 workflows (5 `proxyActivities` blocks total). There is no way to reuse a pipeline stage (e.g., "just run enrichment") from a different workflow context.

This blocks rapid iteration on increasingly complex workflows — each new workflow will duplicate proxy configs and inline activity sequences rather than composing from tested stages.

## Design

### Outcome

Attribution workflows compose from typed, reusable child workflows. `CollectEpochWorkflow` becomes a thin orchestrator calling `CollectSourcesWorkflow` and `EnrichAndAllocateWorkflow` via `executeChild()`. Shared proxy configs eliminate retry duplication. Stage I/O types enforce compile-time safety at workflow boundaries.

### Approach

**Solution**: Three focused deliverables, all within `services/scheduler-worker/`:

#### Rock 1 — Shared Activity Proxy Configs

Extract `proxyActivities` timeout/retry configs into named profiles:

```typescript
// workflows/activity-profiles.ts
export const STANDARD_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "2 seconds",
    maximumInterval: "1 minute",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
} as const satisfies ActivityOptions;

export const EXTERNAL_API_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
} as const satisfies ActivityOptions;

export const GRAPH_EXECUTION_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 1 },
} as const satisfies ActivityOptions;
```

All workflows import from this file instead of inlining configs.

#### Rock 2 — Child Workflow Decomposition

Split `CollectEpochWorkflow` into composable child workflows:

**`CollectSourcesWorkflow`** — the triple-nested collection loop (sources × sourceRefs × streams). Receives epoch context, returns collection summary. This is the longest-running stage and benefits most from independent retry/visibility.

**`EnrichAndAllocateWorkflow`** — materializeSelection → evaluateEpochDraft → computeAllocations. Three sequential activities that always run together. Reusable by future "re-enrich" or "manual recalculate" workflows.

**Pool/close stays inline** in the parent — it's conditional and terminal, not worth a child workflow.

The parent `CollectEpochWorkflow` becomes:

```typescript
export async function CollectEpochWorkflow(raw: ScheduleActionPayload) {
  // Steps 1-4: setup (unchanged — window, weights, epoch)
  // ...
  if (epoch.status !== "open") return;

  if (patched("v2-child-workflows")) {
    // Step 5: collect from all sources
    await executeChild(CollectSourcesWorkflow, {
      args: [
        { epochId, sources: config.activitySources, periodStart, periodEnd },
      ],
      workflowId: `collect-sources-${epoch.epochId}`,
    });

    // Steps 6-8: enrich and allocate
    await executeChild(EnrichAndAllocateWorkflow, {
      args: [
        { epochId, attributionPipeline, weightConfig: epoch.weightConfig },
      ],
      workflowId: `enrich-allocate-${epoch.epochId}`,
    });
  } else {
    // Legacy inline path for in-flight workflows during deploy
    // (existing steps 5-8 code, unchanged)
  }

  // Steps 9-10: pool + auto-close (inline, conditional)
  // (unchanged)
}
```

**`patched("v2-child-workflows")`** gates the transition for replay safety. After all in-flight workflows complete, the old branch can be removed via `deprecatePatch()`.

#### Rock 3 — Typed Stage I/O Interfaces

Define explicit input/output types for each child workflow in a shared types file:

```typescript
// workflows/stage-types.ts

/** Input/output for CollectSourcesWorkflow */
export interface CollectSourcesInput {
  readonly epochId: string;
  readonly sources: Record<
    string,
    { attributionPipeline: string; sourceRefs: string[] }
  >;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CollectSourcesOutput {
  readonly totalEvents: number;
  readonly sourcesCollected: string[];
}

/** Input/output for EnrichAndAllocateWorkflow */
export interface EnrichAndAllocateInput {
  readonly epochId: string;
  readonly attributionPipeline: string;
  readonly weightConfig: Record<string, number>;
}

export interface EnrichAndAllocateOutput {
  readonly totalReceipts: number;
  readonly evaluationRefs: string[];
  readonly totalAllocations: number;
  readonly totalProposedUnits: string;
}
```

Each child workflow imports and uses these types. The parent workflow threads outputs where needed. **No runtime framework** — `executeChild()` already provides type inference. The types file is the compile-time contract.

**Reuses**: Temporal SDK `executeChild()`, `patched()`, `proxyActivities()`. Existing activity functions unchanged. Existing `PipelineProfile` and registry dispatch unchanged.

**Rejected**:

- _Custom `PipelineStep<In, Out>` runtime abstraction_: Wraps `executeChild()` which already provides type safety. Adds indirection for debugging without functional benefit. Just calling functions in sequence doesn't need a framework.
- _Profile-driven stage dispatch (resolve stages from profile)_: Over-engineered. Profiles already dispatch enrichers/allocators. The workflow-level orchestration order is stable — it's the stage internals that vary via plugins.
- _New workflow function names (V2)_: Would require schedule reconfiguration. `patched()` handles the migration transparently.

### Invariants

- [ ] TEMPORAL_DETERMINISM: Child workflows contain zero I/O — only `proxyActivities` calls and deterministic logic (spec: temporal-patterns-spec)
- [ ] REPLAY_SAFE_MIGRATION: `patched("v2-child-workflows")` gates the child workflow transition for in-flight replay safety (spec: temporal-patterns-spec)
- [ ] CHILD_WORKFLOW_ID_STABILITY: Child workflow IDs derived from business key (`epochId`) for idempotency (spec: temporal-patterns-spec)
- [ ] ACTIVITY_IDEMPOTENT: No activity changes — existing idempotency guarantees preserved (spec: temporal-patterns-spec)
- [ ] PROXY_CONFIGS_SINGLE_SOURCE: All `proxyActivities` calls reference shared profiles — no inline timeout/retry configs in workflow files
- [ ] STAGE_IO_TYPED: Every child workflow has explicit `StageInput`/`StageOutput` interfaces in `stage-types.ts`
- [ ] BEHAVIOR_IDENTICAL: Refactor only — same activities called in same order with same inputs. No behavior change.

### Files

**Create:**

- `services/scheduler-worker/src/workflows/activity-profiles.ts` — Named `proxyActivities` config profiles (STANDARD, EXTERNAL_API, GRAPH_EXECUTION)
- `services/scheduler-worker/src/workflows/stage-types.ts` — Typed I/O interfaces for all child workflows
- `services/scheduler-worker/src/workflows/stages/collect-sources.workflow.ts` — Child workflow: source collection loop
- `services/scheduler-worker/src/workflows/stages/enrich-and-allocate.workflow.ts` — Child workflow: selection → enrichment → allocation

**Modify:**

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Use child workflows via `executeChild()` + `patched()`, import shared proxy configs
- `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` — Import shared proxy configs (replace inline config)
- `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` — Import shared proxy configs (replace inline config)
- `services/scheduler-worker/src/workflows/ledger-workflows.ts` — Export new child workflows

**Spec:**

- `docs/spec/temporal-patterns.md` — Add "Pipeline Stage Composition" section documenting child workflow convention

**Test:**

- Existing stack test (`tests/stack/attribution/collect-epoch-pipeline.stack.test.ts`) must still pass — same behavior, different structure
- Unit test for shared proxy config imports (optional — TypeScript catches misuse at compile time)

## Plan

### Checkpoint 1 — Shared Proxy Configs

1. Create `activity-profiles.ts` with named timeout/retry profiles
2. Update all 3 existing workflows to import from it
3. Verify: `pnpm check` passes, no behavior change

### Checkpoint 2 — Stage I/O Types + Child Workflows

1. Create `stage-types.ts` with `CollectSourcesInput/Output` and `EnrichAndAllocateInput/Output`
2. Create `stages/collect-sources.workflow.ts` — extract collection loop from `CollectEpochWorkflow` steps 5
3. Create `stages/enrich-and-allocate.workflow.ts` — extract steps 6-8
4. Update `ledger-workflows.ts` barrel to export new workflows

### Checkpoint 3 — Wire Parent Orchestrator + Migration

1. Update `CollectEpochWorkflow` to use `patched("v2-child-workflows")` + `executeChild()`
2. Keep old inline path in `else` branch for replay safety
3. Update temporal-patterns spec with composition pattern
4. Verify: `pnpm check` passes, stack test passes

## Validation

- [ ] `pnpm check` passes (lint + type + format)
- [ ] `pnpm test` passes (unit tests)
- [ ] Stack test: `pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/attribution/collect-epoch-pipeline.stack.test.ts` passes
- [ ] `CollectSourcesWorkflow` and `EnrichAndAllocateWorkflow` appear as child workflows in Temporal UI when triggered
- [ ] No inline `proxyActivities` timeout/retry configs remain in any workflow file
- [ ] Old `patched()` branch preserves exact existing behavior for in-flight replay

## Review Checklist

- [ ] Work Item: task.0144
- [ ] Spec refs: temporal-patterns-spec, plugin-attribution-pipeline-spec
- [ ] All child workflows contain zero I/O
- [ ] `patched()` used correctly for migration
- [ ] Child workflow IDs are stable and deterministic
- [ ] Stage I/O types are plain serializable objects (no Date, no bigint, no functions)
