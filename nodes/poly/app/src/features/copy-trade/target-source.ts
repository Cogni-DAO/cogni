// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/target-source`
 * Purpose: Strongly-typed seam for "which wallets is the operator monitoring right now?".
 *          v0 returns a list resolved from env; future DB-backed impl reads rows from
 *          `poly_copy_trade_targets` and is a drop-in replacement.
 * Scope: One tiny port + one env-backed impl. No caps, no per-target enable flag, no
 *        mode switches — those stay hardcoded in the job shim per SCAFFOLDING.
 * Invariants:
 *   - TARGET_LIST_IMMUTABLE_PER_BOOT — the env impl captures the list at container
 *     init and never re-reads. Restart the pod to pick up new wallets. The DB impl
 *     will replace this semantics.
 *   - NO_PER_TARGET_ENABLED — the global `poly_copy_trade_config.enabled` singleton
 *     is the only kill-switch. Do not add a per-row enable flag.
 * Side-effects: none
 * Links: work/items/task.0315 (P2 replaces env impl with DB-backed)
 *
 * @scaffolding
 * @public
 */

export type WalletAddress = `0x${string}`;

export interface CopyTradeTargetSource {
  /**
   * Wallets the operator is monitoring right now. Caller-visible order is preserved
   * (used by the dashboard to render tracked rows in the same order as the env list).
   */
  listTargets(): Promise<readonly WalletAddress[]>;
}

/**
 * Env-backed target source. Captures the list at construction time; callers restart
 * the pod to pick up changes. Replaced by a DB-backed source once
 * `poly_copy_trade_targets` is wired.
 *
 * @public
 */
export function envTargetSource(
  wallets: readonly WalletAddress[]
): CopyTradeTargetSource {
  const frozen = Object.freeze([...wallets]);
  return {
    listTargets: async () => frozen,
  };
}
