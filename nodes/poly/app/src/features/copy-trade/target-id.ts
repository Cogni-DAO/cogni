// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/target-id`
 * Purpose: Deterministic UUIDv5 derivation from a target wallet address. The
 *          poly_copy_trade_fills `target_id` column uses this helper so
 *          `client_order_id = clientOrderIdFor(target_id, fill_id)` stays
 *          stable across pod restarts and across multiple tenants tracking
 *          the same wallet.
 * Scope: Pure helper. No I/O, no env reads.
 * Invariants: TARGET_ID_DETERMINISTIC — same wallet, same uuid (case-insensitive
 *             on the input). Namespace UUID is fixed; never change it.
 * Side-effects: none
 * Links: docs/spec/poly-copy-trade-execution.md (IDEMPOTENT_BY_CLIENT_ID), docs/spec/poly-tenant-and-collateral.md
 * @public
 */

import { v5 as uuidv5 } from "uuid";

/**
 * UUIDv5 namespace for poly target wallets. Arbitrary but fixed — any future
 * caller that needs a stable `target_id` from a wallet address uses this
 * namespace so ids collide with ours.
 */
const POLY_TARGET_WALLET_NAMESPACE =
  "e2a38b91-7b7d-5f8e-9c0d-4a1e6f8b2c3d" as const;

/**
 * Derive a stable synthetic `target_id` from the target wallet. Used by:
 *   - the fills ledger as the `target_id` column value (so the same wallet
 *     observed by N tenants still has one stable id for client_order_id),
 *   - the env-backed `CopyTradeTargetSource` to give each wallet a stable
 *     synthetic row id (the DB-backed source uses real PK uuids).
 *
 * @public
 */
export function targetIdFromWallet(wallet: `0x${string}`): string {
  return uuidv5(wallet.toLowerCase(), POLY_TARGET_WALLET_NAMESPACE);
}
