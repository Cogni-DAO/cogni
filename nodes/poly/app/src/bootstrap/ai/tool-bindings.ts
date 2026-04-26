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
  PolyDataCapability,
  PolyTradeCapability,
  RepoCapability,
  ScheduleCapability,
  ToolImplementation,
  VcsCapability,
  WalletCapability,
  WebSearchCapability,
  WorkItemCapability,
} from "@cogni/ai-tools";
import {
  createKnowledgeReadImplementation,
  createKnowledgeSearchImplementation,
  createKnowledgeWriteImplementation,
  createMarketListImplementation,
  createMetricsQueryImplementation,
  createPolyCancelOrderImplementation,
  createPolyDataActivityImplementation,
  createPolyDataHoldersImplementation,
  createPolyDataPositionsImplementation,
  createPolyDataResolveUsernameImplementation,
  createPolyDataTradesMarketImplementation,
  createPolyDataValueImplementation,
  createPolyListOrdersImplementation,
  createPolyPlaceTradeImplementation,
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
  createWalletTopTradersImplementation,
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
  polyDataHelpImplementation,
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
} from "@cogni/ai-tools";

/**
 * Dependencies required to create tool bindings.
 * These are resolved from the container at bootstrap time.
 */
export interface ToolBindingDeps {
  readonly knowledgeCapability: KnowledgeCapability;
  readonly marketCapability: MarketCapability;
  readonly metricsCapability: MetricsCapability;
  /**
   * Optional — when undefined the `core__poly_place_trade` tool is registered
   * with a stub that throws a clear error on invocation. Happens when
   * OPERATOR_WALLET_ADDRESS / POLY_CLOB_* / PRIVY_* env is incomplete.
   */
  readonly polyTradeCapability?: PolyTradeCapability | undefined;
  /**
   * PolyDataCapability — backs the 7 `core__poly_data_*` research tools (task.0386).
   * Always required on poly (Data API is public).
   */
  readonly polyDataCapability: PolyDataCapability;
  readonly repoCapability: RepoCapability;
  readonly scheduleCapability: ScheduleCapability;
  readonly vcsCapability: VcsCapability;
  readonly walletCapability: WalletCapability;
  readonly webSearchCapability: WebSearchCapability;
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

    [WALLET_TOP_TRADERS_NAME]: createWalletTopTradersImplementation({
      walletCapability: deps.walletCapability,
    }) as AnyToolImplementation,

    [METRICS_QUERY_NAME]: createMetricsQueryImplementation({
      metricsCapability: deps.metricsCapability,
    }) as AnyToolImplementation,

    // core__poly_place_trade: real impl when env is complete; stub otherwise
    // (stub throws a clear error message on invocation). Matches the knowledge-
    // store pattern of "install a no-op when the backing port is absent".
    [POLY_PLACE_TRADE_NAME]: (deps.polyTradeCapability
      ? createPolyPlaceTradeImplementation({
          polyTradeCapability: deps.polyTradeCapability,
        })
      : polyPlaceTradeStubImplementation) as AnyToolImplementation,

    [POLY_LIST_ORDERS_NAME]: (deps.polyTradeCapability
      ? createPolyListOrdersImplementation({
          polyTradeCapability: deps.polyTradeCapability,
        })
      : polyListOrdersStubImplementation) as AnyToolImplementation,

    [POLY_CANCEL_ORDER_NAME]: (deps.polyTradeCapability
      ? createPolyCancelOrderImplementation({
          polyTradeCapability: deps.polyTradeCapability,
        })
      : polyCancelOrderStubImplementation) as AnyToolImplementation,

    // Poly Data-API research tools (task.0386) — poly brains can call these
    // to research arbitrary proxy-wallets. Backed by public Data API (no auth).
    [POLY_DATA_POSITIONS_NAME]: createPolyDataPositionsImplementation({
      polyDataCapability: deps.polyDataCapability,
    }) as AnyToolImplementation,
    [POLY_DATA_ACTIVITY_NAME]: createPolyDataActivityImplementation({
      polyDataCapability: deps.polyDataCapability,
    }) as AnyToolImplementation,
    [POLY_DATA_VALUE_NAME]: createPolyDataValueImplementation({
      polyDataCapability: deps.polyDataCapability,
    }) as AnyToolImplementation,
    [POLY_DATA_HOLDERS_NAME]: createPolyDataHoldersImplementation({
      polyDataCapability: deps.polyDataCapability,
    }) as AnyToolImplementation,
    [POLY_DATA_TRADES_MARKET_NAME]: createPolyDataTradesMarketImplementation({
      polyDataCapability: deps.polyDataCapability,
    }) as AnyToolImplementation,
    [POLY_DATA_RESOLVE_USERNAME_NAME]:
      createPolyDataResolveUsernameImplementation({
        polyDataCapability: deps.polyDataCapability,
      }) as AnyToolImplementation,
    [POLY_DATA_HELP_NAME]: polyDataHelpImplementation as AnyToolImplementation,

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
