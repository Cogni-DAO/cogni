// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/buildWalletRows`
 * Purpose: Pure row-merge helpers used by both surfaces that render the shared `WalletsTable`.
 *          - `buildWalletRows`: research/full variant → leaderboard rows + `tracked` flag.
 *          - `buildCopyTradedWalletRows`: dashboard/copy-traded variant → the user's
 *            copy-trade targets (ground truth from `poly_copy_trade_targets`) enriched
 *            in this precedence order:
 *              1. windowed leaderboard (tradersByWallet) — trustworthy for the period
 *              2. all-time leaderboard (fallbackByWallet) — labeled "all-time est." in the UI
 *              3. none — em-dashes
 *            The real windowed-stats unification lives in a follow-up Data-API-first
 *            task, not here.
 * Scope: Pure. No I/O. No React.
 * Invariants: Rows emitted here always satisfy the `WalletRow` shape so the shared columns render uniformly.
 * Side-effects: none
 * @internal
 */

import type { WalletTopTraderItem } from "@cogni/poly-ai-tools";
import type { PolyCopyTradeTarget } from "@cogni/poly-node-contracts";

import type { WalletRow } from "./columns";

/** Research/full variant — merge live leaderboard with the user's tracked set. */
export function buildWalletRows(
  traders: ReadonlyArray<WalletTopTraderItem>,
  trackedWalletsLower: ReadonlySet<string>
): WalletRow[] {
  return traders.map((t) => ({
    ...t,
    tracked: trackedWalletsLower.has(t.proxyWallet.toLowerCase()),
    targetId: undefined,
    statsSource: "leaderboard",
  }));
}

/**
 * Dashboard/copy-traded variant — one row per `poly_copy_trade_targets` entry.
 * Enriches each row with the first source that has data:
 *   1. windowed leaderboard (`tradersByWallet`, trustworthy for the period)
 *   2. all-time leaderboard (`fallbackByWallet`, labeled "all-time est.")
 *   3. none (em-dashes)
 */
export function buildCopyTradedWalletRows(
  targets: ReadonlyArray<PolyCopyTradeTarget>,
  tradersByWallet: ReadonlyMap<string, WalletTopTraderItem>,
  fallbackByWallet: ReadonlyMap<string, WalletTopTraderItem>
): WalletRow[] {
  return targets.map((target, index) => {
    const wallet = target.target_wallet.toLowerCase();

    const trader = tradersByWallet.get(wallet);
    if (trader) {
      return {
        ...trader,
        tracked: true,
        targetId: target.target_id,
        statsSource: "leaderboard",
      };
    }

    const fallback = fallbackByWallet.get(wallet);
    if (fallback) {
      return {
        ...fallback,
        tracked: true,
        targetId: target.target_id,
        statsSource: "fallback",
      };
    }

    return {
      rank: index + 1,
      proxyWallet: target.target_wallet,
      userName: "",
      volumeUsdc: 0,
      pnlUsdc: 0,
      roiPct: null,
      numTrades: 0,
      numTradesCapped: false,
      verified: false,
      tracked: true,
      targetId: target.target_id,
      statsSource: "none",
    };
  });
}
