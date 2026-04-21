// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/buildWalletRows`
 * Purpose: Pure row-merge helpers used by both surfaces that render the shared `WalletsTable`.
 *          - `buildWalletRows`: research/full variant → leaderboard rows + `tracked` flag + client category.
 *          - `buildCopyTradedWalletRows`: dashboard/copy-traded variant → the user's copy-trade targets
 *            (ground truth from `poly_copy_trade_targets`) optionally enriched with current-window leaderboard
 *            metrics when the wallet happens to be in the top-N.
 * Scope: Pure. No I/O. No React.
 * Invariants: Rows emitted here always satisfy the `WalletRow` shape so the shared columns render uniformly.
 * Side-effects: none
 * @internal
 */

import type { WalletTopTraderItem } from "@cogni/ai-tools";
import type { PolyCopyTradeTarget } from "@cogni/node-contracts";

import { inferWalletCategory } from "./category";
import type { WalletRow } from "./columns";

/** Research/full variant — merge live leaderboard with the user's tracked set. */
export function buildWalletRows(
  traders: ReadonlyArray<WalletTopTraderItem>,
  trackedWalletsLower: ReadonlySet<string>
): WalletRow[] {
  return traders.map((t) => ({
    ...t,
    tracked: trackedWalletsLower.has(t.proxyWallet.toLowerCase()),
    category: inferWalletCategory({
      userName: t.userName,
      proxyWallet: t.proxyWallet,
    }),
    targetId: undefined,
  }));
}

/** Dashboard/copy-traded variant — ONLY rows from `poly_copy_trade_targets`, enriched with leaderboard data when available. */
export function buildCopyTradedWalletRows(
  targets: ReadonlyArray<PolyCopyTradeTarget>,
  tradersByWallet: ReadonlyMap<string, WalletTopTraderItem>
): WalletRow[] {
  return targets.map((target, index) => {
    const wallet = target.target_wallet.toLowerCase();
    const trader = tradersByWallet.get(wallet);
    if (trader) {
      return {
        ...trader,
        tracked: true,
        category: inferWalletCategory({
          userName: trader.userName,
          proxyWallet: trader.proxyWallet,
        }),
        targetId: target.target_id,
      };
    }
    // Outside top-N for this window — synthesize a minimal row so the operator
    // can still see every wallet they are copy-trading.
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
      category: inferWalletCategory({ proxyWallet: target.target_wallet }),
      targetId: target.target_id,
      outsideWindow: true,
    };
  });
}
