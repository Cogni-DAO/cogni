// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.balances.v1.contract`
 * Purpose: Contract for the calling user's Polymarket trading-wallet on-chain balance snapshot (USDC.e + POL on Polygon), returning the funder address and partial-failure-tolerant balance numbers.
 * Scope: GET /api/v1/poly/wallet/balances. Schema-only. TENANT_SCOPED (session auth). Does not provision wallets, does not move funds, does not modify allowance state, does not write any DB rows.
 * Invariants: PARTIAL_FAILURE_NEVER_THROWS; READ_ONLY (no signing, no Privy call); distinct from the legacy operator-only `/balance` (singular).
 * Side-effects: none
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/balances/route.ts
 * @public
 */

import { z } from "zod";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const polyWalletBalancesOperation = {
  id: "poly.wallet.balances.v1",
  summary:
    "Read the calling user's Polymarket trading wallet on-chain balances",
  description:
    "Returns the user's per-tenant trading-wallet address plus USDC.e and native POL balances on Polygon. `connected=false` when the user has not yet provisioned a wallet; individual RPC failures surface in `errors[]`.",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    address: walletAddressSchema.nullable(),
    /** USDC.e on Polygon, decimal form (not atomic). `null` on RPC failure. */
    usdc_e: z.number().nullable(),
    /** Native POL on Polygon, decimal form. `null` on RPC failure. */
    pol: z.number().nullable(),
    errors: z.array(z.string()),
  }),
} as const;

export type PolyWalletBalancesOutput = z.infer<
  typeof polyWalletBalancesOperation.output
>;
