// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.balance.v1.contract`
 * Purpose: Contract for operator-wallet balance read — USDC available, USDC locked in Polymarket open orders, POL gas, and the operator EOA.
 * Scope: GET /api/v1/poly/wallet/balance. Returns the single-operator state for the poly prototype. Does not execute trades, does not modify state, does not emit side effects.
 * Invariants: Amounts in USD (not atomic units). `locked` = sum of open-order USD notional from Polymarket; `available` = on-chain USDC.e balance.
 * Side-effects: none
 * Notes: HARDCODED_USER — single operator wallet per pod in v0. `change_over_time` is out-of-scope (vNext).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { z } from "zod";

export const polyWalletBalanceOperation = {
  id: "poly.wallet.balance.v1",
  summary: "Operator EOA balance on Polygon + Polymarket locked notional",
  description:
    "Returns operator wallet address, USDC.e available on Polygon, USDC notional locked in Polymarket open orders, total (sum), POL gas balance. Single-operator prototype; response is not user-scoped.",
  input: z.object({}),
  output: z.object({
    operator_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    /** USDC.e on-chain balance on Polygon (USD, not atomic). */
    usdc_available: z.number().nonnegative(),
    /** Sum of `price * original_size_shares` across Polymarket open orders (USD). */
    usdc_locked: z.number().nonnegative(),
    /** `usdc_available + usdc_locked`. */
    usdc_total: z.number().nonnegative(),
    /** Polygon native gas token balance. */
    pol_gas: z.number().nonnegative(),
    /** Polymarket profile URL for this EOA (for UI linking). */
    profile_url: z.string().url(),
    /** True when the backend could not read live balances (partial data returned as zeros + `error_reason`). */
    stale: z.boolean(),
    /** Free-text reason when `stale=true`. */
    error_reason: z.string().nullable(),
  }),
} as const;

export type PolyWalletBalanceOutput = z.infer<
  typeof polyWalletBalanceOperation.output
>;
