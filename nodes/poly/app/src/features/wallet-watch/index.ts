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
  createPolymarketActivitySource,
  type NextFillsResult,
  type PolymarketActivitySourceDeps,
  WALLET_WATCH_METRICS,
  type WalletActivitySource,
} from "./polymarket-source";
