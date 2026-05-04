// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch/polymarket-source`
 * Purpose: Wallet-watch compatibility exports for the package-owned Polymarket activity source.
 * Scope: Re-export only. Generic Data-API activity normalization lives in `@cogni/poly-market-provider`.
 * Invariants: FEATURE_SLICE_NO_CROSS_IMPORTS.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

export {
  createPolymarketActivitySource,
  type NextFillsResult,
  POLYMARKET_ACTIVITY_SOURCE_METRICS as WALLET_WATCH_METRICS,
  type PolymarketActivitySourceDeps,
  type WalletActivitySource,
} from "@cogni/poly-market-provider/adapters/polymarket";
