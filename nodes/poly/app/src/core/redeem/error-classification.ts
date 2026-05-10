// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/error-classification`
 * Purpose: Three-way classification of a redeem-tx submission failure so the
 *   worker can route RPC-infrastructure flukes around the chain-revert
 *   circuit breaker.
 * Scope: Pure. No DB, no chain, no time. Operates on the decoded error
 *   shape produced by `decodeRevertReason`.
 * Invariants:
 *   - RPC_TRANSIENT_DOES_NOT_CONSUME_RETRY_BUDGET — only `chain_revert` and
 *     `unknown` consume the 3-strike retry budget.
 *   - CHAIN_REVERT_WINS — decoded `reason`/`data` outrank message-pattern
 *     matches; an RPC envelope wrapping a real revert is still a revert.
 * Side-effects: none
 * Links: docs/research/poly/redeem-worker-resilience-handoff-2026-05-09.md,
 *   work/items/bug.5041
 * @public
 */

export type RedeemErrorClass = "rpc_transient" | "chain_revert" | "unknown";

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

  const msg = err.shortMessage ?? "";
  if (/contract function .* reverted/i.test(msg)) return "chain_revert";

  if (/missing or invalid parameters/i.test(msg)) return "rpc_transient";
  if (/http request failed|json[- ]rpc|jsonrpc/i.test(msg))
    return "rpc_transient";
  if (/timeout|timed out|econn|network request/i.test(msg))
    return "rpc_transient";
  if (/rate ?limit|429/i.test(msg)) return "rpc_transient";

  return "unknown";
}
