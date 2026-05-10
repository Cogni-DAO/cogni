// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/error-classification`
 * Purpose: Classify a redeem-tx submission failure into RPC-infrastructure vs
 *   chain-side-revert classes (bug.5041). The 3-strike circuit breaker in
 *   `transitions` was originally written assuming every failure was a chain
 *   revert; in practice a 30-minute Polygon RPC instability window (Alchemy
 *   "Missing or invalid parameters" pre-broadcast) is enough to mass-abandon
 *   every redeem job that lands during it. This classifier lets the worker
 *   route RPC errors through a no-attempt-bump retry path while preserving the
 *   3-strike behavior for actual chain reverts.
 * Scope: Pure. No DB, no chain, no time. Operates on the already-decoded
 *   error shape produced by the worker's `decodeRevertReason` helper.
 * Invariants:
 *   - RPC_TRANSIENT_DOES_NOT_CONSUME_RETRY_BUDGET — `rpc_transient` is the
 *     only class the caller is allowed to retry without bumping
 *     `attempt_count`. `chain_revert` and `unknown` keep the existing
 *     3-strike semantics; `unknown` errs conservative.
 *   - DETERMINISTIC_FROM_DECODED_FIELDS — classification reads only the
 *     three decoded fields (reason / data / shortMessage). It does not
 *     re-walk viem's BaseError tree, so two callers with the same decoded
 *     input get the same answer.
 * Side-effects: none
 * Links: docs/research/poly/redeem-worker-resilience-handoff-2026-05-09.md
 *   § The proper fix, work/items/bug.5041, work/items/bug.5040
 * @public
 */

/** Three-way classification of a redeem-tx submission failure. */
export type RedeemErrorClass = "rpc_transient" | "chain_revert" | "unknown";

/**
 * Decoded error shape — matches the output of the worker's
 * `decodeRevertReason(err)` helper. Kept structural so this module stays
 * import-clean from viem.
 */
export interface DecodedRedeemError {
  /** Revert reason string from viem (e.g. "execution reverted"), or null
   * if no chain-side reason was decoded. */
  reason: string | null;
  /** Hex revert data (e.g. "0x" for an empty require, or "0x08c379a0…" for
   * an Error(string)). null when not present. */
  data: string | null;
  /** viem's `shortMessage` (or a truncated err.message fallback). */
  shortMessage: string;
}

/**
 * Classify a decoded redeem-tx error.
 *
 * Order is load-bearing: chain-revert detection runs first so an Alchemy
 * response that wraps a real on-chain revert into "Missing or invalid
 * parameters" is still classified as a chain revert (driven by the
 * decoded `reason`/`data` fields, not the message).
 */
export function classifyRedeemError(err: DecodedRedeemError): RedeemErrorClass {
  // 1. Chain-revert evidence — viem produced a structured revert reason or
  //    raw revert data. The contract executed and reverted; retrying without
  //    on-chain state changing will revert again.
  if (err.reason !== null) return "chain_revert";
  if (err.data !== null && err.data !== "") return "chain_revert";

  const msg = err.shortMessage ?? "";

  // 2. Explicit chain-revert phrasing from viem — `ContractFunctionRevertedError`
  //    formats as 'The contract function "<name>" reverted.'
  if (/contract function .* reverted/i.test(msg)) return "chain_revert";

  // 3. Known RPC-infrastructure failure patterns. The Alchemy "Missing or
  //    invalid parameters" pre-broadcast rejection is the smoking gun from
  //    bug.5041: 198/214 (92%) of the 2026-05-09 / 2026-05-10 abandonment
  //    events looked exactly like this. Other patterns are conservative
  //    catch-alls for transport-level flakiness that should never burn the
  //    3-strike budget.
  if (/missing or invalid parameters/i.test(msg)) return "rpc_transient";
  if (/http request failed|json[- ]rpc|jsonrpc/i.test(msg))
    return "rpc_transient";
  if (/timeout|timed out|econn|network request/i.test(msg))
    return "rpc_transient";
  if (/rate ?limit|429/i.test(msg)) return "rpc_transient";

  // 4. Default to unknown — preserves the existing 3-strike behavior so a
  //    novel error class can't loop forever undetected.
  return "unknown";
}
