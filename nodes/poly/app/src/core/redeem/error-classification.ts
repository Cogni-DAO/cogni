// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/error-classification`
 * Purpose: Two-way classification of a redeem-tx submission failure so the
 *   worker routes RPC-infrastructure flukes around the chain-revert
 *   circuit breaker.
 * Scope: Pure. No DB, no chain, no time. Operates on the decoded error
 *   shape produced by `decodeRevertReason`.
 * Invariants:
 *   - STRUCTURAL_FIELDS_ARE_DISPOSITIVE — viem's `reason`/`data` are
 *     populated iff the tx executed and reverted on chain. Their absence
 *     means the failure was pre-broadcast (RPC). This is the load-bearing
 *     rule; the message-string check is a fallback for the edge case
 *     where viem wraps a chain revert without surfacing structured fields.
 *   - RPC_TRANSIENT_DOES_NOT_CONSUME_RETRY_BUDGET — only `chain_revert`
 *     consumes the 3-strike retry budget.
 * Side-effects: none
 * Links: docs/research/poly/redeem-worker-resilience-handoff-2026-05-09.md,
 *   work/items/bug.5041
 * @public
 */

export type RedeemErrorClass = "rpc_transient" | "chain_revert";

/** Decoded shape of a viem submission error — kept structural so this
 *  module stays import-clean from viem. */
export interface DecodedRedeemError {
  reason: string | null;
  data: string | null;
  shortMessage: string;
}

export function classifyRedeemError(err: DecodedRedeemError): RedeemErrorClass {
  if (err.reason !== null) return "chain_revert";
  if (err.data !== null && err.data !== "") return "chain_revert";
  if (/contract function .* reverted/i.test(err.shortMessage))
    return "chain_revert";
  return "rpc_transient";
}
