// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/analysis`
 * Purpose: Public surface of the analysis submodule — pure compute helpers consumed by server routes and experiment scripts.
 * Scope: Re-exports only. Does not implement logic or hold state.
 * Invariants: Stable barrel — renames or removals must update consumers in the same commit.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md
 * @public
 */

export {
  buildPolymarketEventUrl,
  type ExecutionEvent,
  type ExecutionEventKind,
  type ExecutionPosition,
  type ExecutionPositionStatus,
  type ExecutionTimelinePoint,
  type MapExecutionPositionsInput,
  mapExecutionPositions,
} from "./position-timelines.js";
export {
  type ComputeWalletMetricsOptions,
  computeWalletMetrics,
  type MarketResolutionInput,
  type WalletMetrics,
  type WalletTradeInput,
} from "./wallet-metrics.js";
