// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table`
 * Purpose: Barrel — the single public surface for the app-wide wallets table.
 * Invariants: every surface that renders a list of wallets (dashboard, research,
 *             future admin) MUST import `WalletsTable` from here. No parallel
 *             implementations. See WalletsTable header for the invariant contract.
 * @public
 */

export {
  buildCopyTradedWalletRows,
  buildWalletRows,
} from "./buildWalletRows";
export type { WalletRow, WalletStatsSource } from "./columns";
export {
  WalletsTable,
  type WalletsTableFullState,
  type WalletsTableProps,
  type WalletsTableVariant,
} from "./WalletsTable";
