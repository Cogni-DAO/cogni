// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/domain/client-order-id`
 * Purpose: Pinned idempotency-key function for the copy-trade `client_order_id` field.
 * Scope: Pure function. Does not perform I/O, does not import any SDK, does not know about CLOB internals.
 * Invariants:
 *   - IDEMPOTENT_BY_CLIENT_ID: the function is deterministic from `(target_id, fill_id)`.
 *   - HASH_IS_PINNED: task.0315 CP3.3 migration header cites this exact function — the
 *     executor (CP4) AND any future WS path MUST use this helper, never a local copy.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.3)
 * @public
 */

import { keccak256, stringToHex } from "viem";

/**
 * Deterministic idempotency key = `keccak256(utf8Bytes(target_id + ':' + fill_id))`
 * as a 0x-prefixed 32-byte hex (66 chars including `0x`).
 *
 * Pinned function — never inline or fork the implementation. If the shape needs
 * to change (e.g., different separator, prefix), update this file + write a
 * migration that backfills existing rows; do NOT rev it in a caller.
 */
export function clientOrderIdFor(
  targetId: string,
  fillId: string
): `0x${string}` {
  if (!targetId) throw new Error("clientOrderIdFor: targetId required");
  if (!fillId) throw new Error("clientOrderIdFor: fillId required");
  return keccak256(stringToHex(`${targetId}:${fillId}`));
}
