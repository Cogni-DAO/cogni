// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/ai/tool-bindings`
 * Purpose: Map tool IDs to real implementations with injected capabilities.
 * Scope: Creates bindings record for tool source factory. Does NOT execute tools.
 * Invariants:
 *   - CAPABILITY_INJECTION: Implementations receive capabilities at construction
 *   - NO_STUB_AT_RUNTIME: All tools have real implementations with I/O
 *   - IO_VIA_ADAPTERS: Capabilities wrap adapter ports from container
 * Side-effects: none
 * Links: TOOL_USE_SPEC.md, container.ts
 * @internal
 */

import type {
  MetricsCapability,
  RepoCapability,
  ScheduleCapability,
  ToolImplementation,
  WebSearchCapability,
  WorkItemCapability,
} from "@cogni/ai-tools";
import {
  createMetricsQueryImplementation,
  createRepoListImplementation,
  createRepoOpenImplementation,
  createRepoSearchImplementation,
  createScheduleListImplementation,
  createScheduleManageImplementation,
  createWebSearchImplementation,
  createWorkItemQueryImplementation,
  createWorkItemTransitionImplementation,
  GET_CURRENT_TIME_NAME,
  getCurrentTimeImplementation,
  METRICS_QUERY_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  SCHEDULE_LIST_NAME,
  SCHEDULE_MANAGE_NAME,
  WEB_SEARCH_NAME,
  WORK_ITEM_QUERY_NAME,
  WORK_ITEM_TRANSITION_NAME,
} from "@cogni/ai-tools";

/**
 * Dependencies required to create tool bindings.
 * These are resolved from the container at bootstrap time.
 */
export interface ToolBindingDeps {
  readonly metricsCapability: MetricsCapability;
  readonly webSearchCapability: WebSearchCapability;
  readonly repoCapability: RepoCapability;
  readonly scheduleCapability: ScheduleCapability;
  readonly workItemCapability: WorkItemCapability;
}

/**
 * Tool bindings map: tool ID → implementation.
 * Used by tool source factory to create BoundToolRuntime with real implementations.
 */
export type ToolBindings = Readonly<
  Record<string, ToolImplementation<unknown, unknown>>
>;

// Internal type for widening typed implementations
type AnyToolImplementation = ToolImplementation<unknown, unknown>;

/**
 * Create tool bindings with injected capabilities.
 *
 * Per CAPABILITY_INJECTION: implementations receive capabilities at construction,
 * not at exec() time. This ensures I/O dependencies are properly wired.
 *
 * @param deps - Dependencies from container
 * @returns Map of tool ID → implementation
 */
export function createToolBindings(deps: ToolBindingDeps): ToolBindings {
  // Type widening: implementations are contravariant in input type, so we
  // cast to the base type. This is safe because contractToRuntime validates
  // at runtime via Zod schemas.
  return {
    // Pure tools (no I/O dependencies)
    [GET_CURRENT_TIME_NAME]:
      getCurrentTimeImplementation as AnyToolImplementation,

    // I/O tools (require capability injection)
    [METRICS_QUERY_NAME]: createMetricsQueryImplementation({
      metricsCapability: deps.metricsCapability,
    }) as AnyToolImplementation,

    [WEB_SEARCH_NAME]: createWebSearchImplementation({
      webSearchCapability: deps.webSearchCapability,
    }) as AnyToolImplementation,

    [REPO_LIST_NAME]: createRepoListImplementation({
      repoCapability: deps.repoCapability,
    }) as AnyToolImplementation,

    [REPO_OPEN_NAME]: createRepoOpenImplementation({
      repoCapability: deps.repoCapability,
    }) as AnyToolImplementation,

    [REPO_SEARCH_NAME]: createRepoSearchImplementation({
      repoCapability: deps.repoCapability,
    }) as AnyToolImplementation,

    [SCHEDULE_LIST_NAME]: createScheduleListImplementation({
      scheduleCapability: deps.scheduleCapability,
    }) as AnyToolImplementation,

    [SCHEDULE_MANAGE_NAME]: createScheduleManageImplementation({
      scheduleCapability: deps.scheduleCapability,
    }) as AnyToolImplementation,

    [WORK_ITEM_QUERY_NAME]: createWorkItemQueryImplementation({
      workItemCapability: deps.workItemCapability,
    }) as AnyToolImplementation,

    [WORK_ITEM_TRANSITION_NAME]: createWorkItemTransitionImplementation({
      workItemCapability: deps.workItemCapability,
    }) as AnyToolImplementation,
  };
}
