// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.enable-trading.v1.contract`
 * Purpose: Contract for the idempotent "Enable Trading" Polymarket on-chain approvals ceremony — 3× USDC.e `approve` + 3× CTF `setApprovalForAll` signed by the tenant's Privy-custodied wallet.
 * Scope: `POST /api/v1/poly/wallet/enable-trading`. Schema-only. Does not submit transactions, touch the DB, talk to Privy, or accept a caller-supplied target address.
 * Invariants:
 *   - APPROVALS_BEFORE_PLACE — `ready: true` in this response is the only
 *     event that flips `poly_wallet_connections.trading_approvals_ready_at`
 *     from null → now(), which is what `authorizeIntent` reads before
 *     letting any order reach the CLOB.
 *   - APPROVAL_TARGETS_PINNED — the 3 USDC.e spenders + 3 CTF operators are
 *     Polymarket mainnet addresses hardcoded in the adapter. No contract
 *     field accepts a caller-supplied target address.
 *   - PARTIAL_FAILURE_NEVER_THROWS — if a step reverts mid-sequence, the
 *     response is 200 with `ready: false` + per-step error, not a 5xx. The
 *     UI re-renders the pills; the user retries. 4xx is reserved for
 *     preflight errors (no connection, RPC unconfigured).
 * Side-effects: none (schema only)
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/enable-trading/route.ts,
 *        work/items/task.0355.poly-trading-wallet-enable-trading.md
 * @public
 */

import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/)
  .nullable();

const approvalStepSchema = z.object({
  kind: z.enum([
    "erc20_approve",
    "ctf_set_approval_for_all",
    "collateral_wrap",
  ]),
  label: z.string(),
  token_contract: addressSchema,
  operator: addressSchema,
  state: z.enum(["satisfied", "set", "failed", "skipped"]),
  tx_hash: txHashSchema,
  error: z.string().max(256).nullable(),
});

export const polyWalletEnableTradingOperation = {
  id: "poly.wallet.enable-trading.v1",
  summary:
    "Run the Polymarket on-chain approvals ceremony for the calling user's trading wallet",
  description:
    "Idempotent: already-satisfied approvals are no-ops. Stamps `poly_wallet_connections.trading_approvals_ready_at` on success so subsequent `authorizeIntent` calls see `trading_ready: true`. Target contracts are pinned to Polymarket's mainnet Exchange / Neg-Risk Exchange / Neg-Risk Adapter addresses.",
  input: z.object({}),
  output: z.object({
    ready: z.boolean(),
    address: addressSchema,
    /** Decimal POL balance used for gas. `null` when Polygon RPC is not configured on this deployment. */
    pol_balance: z.number().nullable(),
    steps: z.array(approvalStepSchema).min(8).max(8),
    /** ISO timestamp when the readiness stamp was written; `null` when `ready: false`. */
    ready_at: z.string().datetime().nullable(),
  }),
} as const;

export type PolyWalletEnableTradingOutput = z.infer<
  typeof polyWalletEnableTradingOperation.output
>;
export type PolyWalletEnableTradingStep = z.infer<typeof approvalStepSchema>;
