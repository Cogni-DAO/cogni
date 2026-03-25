---
id: task.0144
type: task
status: done
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
branch: task/0144-temporal-pipeline-composition
pr: https://github.com/Cogni-DAO/node-template/pull/524
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-24
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

Share only the configs that are actually duplicated (2-min standard and 5-min external API appear 3+ times). Workflow-specific configs stay inline with a comment explaining why they differ. `scheduled-run.workflow.ts` keeps its 1-minute timeout inline (grant validation is intentionally fast-fail). `finalize-epoch.workflow.ts` keeps `maximumAttempts: 3` inline (intentionally lower than standard's 5). The goal is DRY, not forced uniformity.

#### Rock 2 — Child Workflow Decomposition

Split `CollectEpochWorkflow` into composable child workflows:

**`CollectSourcesWorkflow`** — the triple-nested collection loop (sources × sourceRefs × streams). Receives epoch context, returns `Promise<void>` (fire-and-forget — add a return type when something consumes it). This is the longest-running stage and benefits most from independent retry/visibility.

**`EnrichAndAllocateWorkflow`** — materializeSelection → evaluateEpochDraft → computeAllocations. Three sequential activities that always run together. Returns `Promise<void>`. Reusable by future "re-enrich" or "manual recalculate" workflows.

**Pool/close stays inline** in the parent — it's conditional and terminal, not worth a child workflow.

The parent `CollectEpochWorkflow` becomes:

```typescript
export async function CollectEpochWorkflow(raw: ScheduleActionPayload) {
  // Steps 1-4: setup (unchanged — window, weights, epoch)
  // ...
  if (epoch.status !== "open") return;

  // Step 5: collect from all sources
  await executeChild(CollectSourcesWorkflow, {
    args: [
      { epochId, sources: config.activitySources, periodStart, periodEnd },
    ],
    workflowId: `collect-sources-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  });

  // Steps 6-8: enrich and allocate
  await executeChild(EnrichAndAllocateWorkflow, {
    args: [{ epochId, attributionPipeline, weightConfig: epoch.weightConfig }],
    workflowId: `enrich-allocate-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  });

  // Steps 9-10: pool + auto-close (inline, conditional)
  // (unchanged)
}
```

**Child workflow options:**

- `parentClosePolicy: TERMINATE` — if parent is cancelled (e.g., schedule overlap skip), terminate the child. Children should not outlive the parent orchestrator.
- No child-level retry — child failures propagate immediately to parent. The parent workflow's own retry policy (from the schedule) handles end-to-end retries.
- `workflowId` is stable per epoch for idempotency.

**No `patched()` needed:** These workflows run daily and complete in under 5 minutes. The worker does graceful shutdown on deploy (`main.ts` handles SIGTERM — stops accepting work, waits for in-flight workflows to complete). No in-flight workflow will replay with new code. Skip the `patched()` branch to avoid temporarily doubling the workflow code. If a future deploy needs it, add then.

#### Rock 3 — Typed Stage I/O Interfaces

Define explicit input types in each child workflow file (colocated, not a separate types file). `executeChild()` already infers return types from the workflow function signature — no separate output types needed until something consumes them.

```typescript
// stages/collect-sources.workflow.ts
export interface CollectSourcesInput {
  readonly epochId: string;
  readonly sources: Record<
    string,
    { attributionPipeline: string; sourceRefs: string[] }
  >;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export async function CollectSourcesWorkflow(
  input: CollectSourcesInput
): Promise<void> { ... }
```

```typescript
// stages/enrich-and-allocate.workflow.ts
export interface EnrichAndAllocateInput {
  readonly epochId: string;
  readonly attributionPipeline: string;
  readonly weightConfig: Record<string, number>;
}

export async function EnrichAndAllocateWorkflow(
  input: EnrichAndAllocateInput
): Promise<void> { ... }
```

**No `stage-types.ts` barrel file.** Types live next to their workflow. If a third consumer appears, extract then. **No runtime framework** — `executeChild()` already provides type inference. Both child workflows return `void` until a consumer needs return data.

**Reuses**: Temporal SDK `executeChild()`, `patched()`, `proxyActivities()`. Existing activity functions unchanged. Existing `PipelineProfile` and registry dispatch unchanged.

**Rejected**:

- _Custom `PipelineStep<In, Out>` runtime abstraction_: Wraps `executeChild()` which already provides type safety. Adds indirection for debugging without functional benefit. Just calling functions in sequence doesn't need a framework.
- _Profile-driven stage dispatch (resolve stages from profile)_: Over-engineered. Profiles already dispatch enrichers/allocators. The workflow-level orchestration order is stable — it's the stage internals that vary via plugins.
- _New workflow function names (V2)_: Would require schedule reconfiguration. Graceful shutdown handles the migration.
- _Separate `stage-types.ts` barrel file_: Types have exactly one producer and one consumer each. Colocate with the workflow file until a third consumer appears.
- _`patched()` migration gate_: These daily workflows complete in minutes. Graceful shutdown drains in-flight work before deploying new code. Doubling the workflow code for a sub-second migration window is not worth the complexity.
- _Forced proxy config uniformity_: `scheduled-run` (1min) and `finalize-epoch` (3 retries) have intentionally different configs. Sharing only the truly duplicated ones (2min standard, 5min external API).

### Invariants

- [ ] TEMPORAL_DETERMINISM: Child workflows contain zero I/O — only `proxyActivities` calls and deterministic logic (spec: temporal-patterns-spec)
- [ ] CHILD_WORKFLOW_ID_STABILITY: Child workflow IDs derived from business key (`epochId`) for idempotency (spec: temporal-patterns-spec)
- [ ] CHILD_PARENT_CLOSE_TERMINATE: Child workflows use `parentClosePolicy: TERMINATE` — children must not outlive parent
- [ ] CHILD_NO_RETRY: No child-level retry policy — failures propagate to parent immediately
- [ ] ACTIVITY_IDEMPOTENT: No activity changes — existing idempotency guarantees preserved (spec: temporal-patterns-spec)
- [ ] PROXY_CONFIGS_DRY: Duplicated configs (2-min standard, 5-min external API) extracted to shared profiles. Workflow-specific configs stay inline with rationale comments.
- [ ] STAGE_IO_COLOCATED: Input types defined in each child workflow file, not a separate barrel
- [ ] BEHAVIOR_IDENTICAL: Refactor only — same activities called in same order with same inputs. No behavior change.

### Files

**Create:**

- `services/scheduler-worker/src/workflows/activity-profiles.ts` — Shared `proxyActivities` config profiles (STANDARD, EXTERNAL_API)
- `services/scheduler-worker/src/workflows/stages/collect-sources.workflow.ts` — Child workflow + `CollectSourcesInput` type: source collection loop
- `services/scheduler-worker/src/workflows/stages/enrich-and-allocate.workflow.ts` — Child workflow + `EnrichAndAllocateInput` type: selection → enrichment → allocation

**Modify:**

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Use child workflows via `executeChild()`, import shared proxy configs
- `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` — Import STANDARD from shared proxy configs (keep `maximumAttempts: 3` inline override)
- `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` — Import GRAPH_EXECUTION from shared proxy configs (keep 1-min config inline — intentionally different)
- `services/scheduler-worker/src/workflows/ledger-workflows.ts` — Export new child workflows (required for `bundleWorkflowCode` in worker + tests)

**Spec:**

- `docs/spec/temporal-patterns.md` — Already updated with "Pipeline Stage Composition" section (committed)

**Test:**

- Existing stack test (`tests/stack/attribution/collect-epoch-pipeline.stack.test.ts`) must still pass — verify `bundleWorkflowCode` picks up child workflows via updated barrel exports in `ledger-workflows.ts`

## Plan

### Checkpoint 1 — Shared Proxy Configs

1. Create `activity-profiles.ts` with STANDARD_ACTIVITY_OPTIONS and EXTERNAL_API_ACTIVITY_OPTIONS
2. Update `collect-epoch.workflow.ts` to import shared profiles (this is where the duplication lives)
3. Update `finalize-epoch.workflow.ts` and `scheduled-run.workflow.ts` to import shared profiles where they match, keep workflow-specific configs inline with rationale comments
4. Verify: `pnpm check` passes, no behavior change

### Checkpoint 2 — Child Workflows

1. Create `stages/collect-sources.workflow.ts` with `CollectSourcesInput` type — extract collection loop from `CollectEpochWorkflow` step 5
2. Create `stages/enrich-and-allocate.workflow.ts` with `EnrichAndAllocateInput` type — extract steps 6-8
3. Update `ledger-workflows.ts` barrel to export new child workflows
4. Verify: `pnpm check` passes

### Checkpoint 3 — Wire Parent Orchestrator

1. Update `CollectEpochWorkflow` to use `executeChild()` with `parentClosePolicy: TERMINATE`
2. Remove inlined steps 5-8 (replaced by child workflow calls). No `patched()` — graceful shutdown handles deploy safety.
3. Verify: `pnpm check` passes, stack test passes (confirm `bundleWorkflowCode` picks up child workflows via barrel)

## Validation

- [ ] `pnpm check` passes (lint + type + format)
- [ ] `pnpm test` passes (unit tests)
- [ ] Stack test: `pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/attribution/collect-epoch-pipeline.stack.test.ts` passes
- [ ] `CollectSourcesWorkflow` and `EnrichAndAllocateWorkflow` appear as child workflows in Temporal UI when triggered
- [ ] Duplicated proxy configs (2-min, 5-min) use shared profiles; workflow-specific configs have rationale comments
- [ ] Child workflows use `parentClosePolicy: TERMINATE` and no child-level retry

## Review Checklist

- [ ] Work Item: task.0144
- [ ] Spec refs: temporal-patterns-spec, plugin-attribution-pipeline-spec
- [ ] All child workflows contain zero I/O
- [ ] Child workflow IDs are stable and deterministic
- [ ] Stage input types are plain serializable objects (no Date, no bigint, no functions)
- [ ] `parentClosePolicy: TERMINATE` on all `executeChild()` calls
- [ ] No `patched()` — graceful shutdown handles deploy safety
