// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch`
 * Purpose: Barrel for the generic Polymarket wallet observation layer.
 * Scope: Re-exports only. Does not add logic.
 * Invariants: WALLET_WATCH_IS_GENERIC — see AGENTS.md.
 * Side-effects: none
 * Links: ./AGENTS.md
 * @public
 */

export {
  type NextFillsResult,
  WALLET_WATCH_METRICS,
  type WalletActivitySource,
} from "./types";
export {
  createPolymarketWsActivitySource,
  type PolymarketWsActivitySource,
  type PolymarketWsActivitySourceDeps,
  WALLET_WATCH_WS_METRICS,
} from "./polymarket-ws-source";
