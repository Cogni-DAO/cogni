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
  KnowledgeCapability,
  MarketCapability,
  MetricsCapability,
  RepoCapability,
  ScheduleCapability,
  ToolImplementation,
  VcsCapability,
  WebSearchCapability,
  WorkItemCapability,
} from "@cogni/ai-tools";
import {
  createKnowledgeReadImplementation,
  createKnowledgeSearchImplementation,
  createKnowledgeWriteImplementation,
  createMarketListImplementation,
  createMetricsQueryImplementation,
  createRepoListImplementation,
  createRepoOpenImplementation,
  createRepoSearchImplementation,
  createScheduleListImplementation,
  createScheduleManageImplementation,
  createVcsCreateBranchImplementation,
  createVcsFlightCandidateImplementation,
  createVcsGetCiStatusImplementation,
  createVcsListPrsImplementation,
  createVcsMergePrImplementation,
  createWebSearchImplementation,
  createWorkItemQueryImplementation,
  createWorkItemTransitionImplementation,
  GET_CURRENT_TIME_NAME,
  getCurrentTimeImplementation,
  KNOWLEDGE_READ_NAME,
  KNOWLEDGE_SEARCH_NAME,
  KNOWLEDGE_WRITE_NAME,
  MARKET_LIST_NAME,
  METRICS_QUERY_NAME,
  POLY_CANCEL_ORDER_NAME,
  POLY_DATA_ACTIVITY_NAME,
  POLY_DATA_HELP_NAME,
  POLY_DATA_HOLDERS_NAME,
  POLY_DATA_POSITIONS_NAME,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  POLY_DATA_TRADES_MARKET_NAME,
  POLY_DATA_VALUE_NAME,
  POLY_LIST_ORDERS_NAME,
  POLY_PLACE_TRADE_NAME,
  polyCancelOrderStubImplementation,
  polyDataActivityStubImplementation,
  polyDataHelpImplementation,
  polyDataHoldersStubImplementation,
  polyDataPositionsStubImplementation,
  polyDataResolveUsernameStubImplementation,
  polyDataTradesMarketStubImplementation,
  polyDataValueStubImplementation,
  polyListOrdersStubImplementation,
  polyPlaceTradeStubImplementation,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  SCHEDULE_LIST_NAME,
  SCHEDULE_MANAGE_NAME,
  VCS_CREATE_BRANCH_NAME,
  VCS_FLIGHT_CANDIDATE_NAME,
  VCS_GET_CI_STATUS_NAME,
  VCS_LIST_PRS_NAME,
  VCS_MERGE_PR_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
  WORK_ITEM_QUERY_NAME,
  WORK_ITEM_TRANSITION_NAME,
  walletTopTradersStubImplementation,
} from "@cogni/ai-tools";

/**
 * Dependencies required to create tool bindings.
 * These are resolved from the container at bootstrap time.
 */
export interface ToolBindingDeps {
  readonly knowledgeCapability: KnowledgeCapability;
  readonly marketCapability: MarketCapability;
  readonly metricsCapability: MetricsCapability;
  readonly webSearchCapability: WebSearchCapability;
  readonly repoCapability: RepoCapability;
  readonly scheduleCapability: ScheduleCapability;
  readonly vcsCapability: VcsCapability;
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

    // Knowledge tools (Doltgres-backed knowledge store)
    [KNOWLEDGE_SEARCH_NAME]: createKnowledgeSearchImplementation({
      knowledgeCapability: deps.knowledgeCapability,
    }) as AnyToolImplementation,
    [KNOWLEDGE_READ_NAME]: createKnowledgeReadImplementation({
      knowledgeCapability: deps.knowledgeCapability,
    }) as AnyToolImplementation,
    [KNOWLEDGE_WRITE_NAME]: createKnowledgeWriteImplementation({
      knowledgeCapability: deps.knowledgeCapability,
    }) as AnyToolImplementation,

    // I/O tools (require capability injection)
    [MARKET_LIST_NAME]: createMarketListImplementation({
      marketCapability: deps.marketCapability,
    }) as AnyToolImplementation,

    // Wallet top-traders: poly-only tool. Bound as stub here so the shared
    // TOOL_CATALOG iteration in createBoundToolSource does not throw; the
    // resy brain does not expose this tool to its graph.
    [WALLET_TOP_TRADERS_NAME]:
      walletTopTradersStubImplementation as AnyToolImplementation,

    // Poly place-trade: poly-only tool. Stub on non-poly nodes for the same
    // reason as wallet_top_traders.
    [POLY_PLACE_TRADE_NAME]:
      polyPlaceTradeStubImplementation as AnyToolImplementation,

    // Poly list-orders: poly-only tool. Stub here for the same reason.
    [POLY_LIST_ORDERS_NAME]:
      polyListOrdersStubImplementation as AnyToolImplementation,

    // Poly cancel-order: poly-only tool. Stub here for the same reason.
    [POLY_CANCEL_ORDER_NAME]:
      polyCancelOrderStubImplementation as AnyToolImplementation,

    // Poly Data-API research tools (task.0386): poly-only. Stubs here so
    // the shared TOOL_CATALOG iteration in createBoundToolSource does not
    // throw. The help tool is static (no IO) and can use the real impl.
    [POLY_DATA_POSITIONS_NAME]:
      polyDataPositionsStubImplementation as AnyToolImplementation,
    [POLY_DATA_ACTIVITY_NAME]:
      polyDataActivityStubImplementation as AnyToolImplementation,
    [POLY_DATA_VALUE_NAME]:
      polyDataValueStubImplementation as AnyToolImplementation,
    [POLY_DATA_HOLDERS_NAME]:
      polyDataHoldersStubImplementation as AnyToolImplementation,
    [POLY_DATA_TRADES_MARKET_NAME]:
      polyDataTradesMarketStubImplementation as AnyToolImplementation,
    [POLY_DATA_RESOLVE_USERNAME_NAME]:
      polyDataResolveUsernameStubImplementation as AnyToolImplementation,
    [POLY_DATA_HELP_NAME]: polyDataHelpImplementation as AnyToolImplementation,

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

    [VCS_CREATE_BRANCH_NAME]: createVcsCreateBranchImplementation({
      vcsCapability: deps.vcsCapability,
    }) as AnyToolImplementation,

    [VCS_FLIGHT_CANDIDATE_NAME]: createVcsFlightCandidateImplementation({
      vcsCapability: deps.vcsCapability,
    }) as AnyToolImplementation,

    [VCS_GET_CI_STATUS_NAME]: createVcsGetCiStatusImplementation({
      vcsCapability: deps.vcsCapability,
    }) as AnyToolImplementation,

    [VCS_LIST_PRS_NAME]: createVcsListPrsImplementation({
      vcsCapability: deps.vcsCapability,
    }) as AnyToolImplementation,

    [VCS_MERGE_PR_NAME]: createVcsMergePrImplementation({
      vcsCapability: deps.vcsCapability,
    }) as AnyToolImplementation,

    [WORK_ITEM_QUERY_NAME]: createWorkItemQueryImplementation({
      workItemCapability: deps.workItemCapability,
    }) as AnyToolImplementation,

    [WORK_ITEM_TRANSITION_NAME]: createWorkItemTransitionImplementation({
      workItemCapability: deps.workItemCapability,
    }) as AnyToolImplementation,
  };
}
