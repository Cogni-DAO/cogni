// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.overview.v1.contract`
 * Purpose: Contract for the calling user's dashboard trading-wallet summary.
 * Scope: GET /api/v1/poly/wallet/overview. Schema-only. Session-authenticated, tenant-scoped, read-only; does not infer history or mutate wallet state.
 * Invariants:
 *   - TENANT_SCOPED: wallet identity derives from the authenticated session.
 *   - CURRENT_ONLY: returns the current wallet snapshot only; no historical
 *     balance curve is implied by this contract.
 *   - PARTIAL_FAILURE_NEVER_THROWS: individual upstream failures surface via
 *     nullable fields plus `warnings[]`, not a 5xx.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @public
 */

import { z } from "zod";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const PolyWalletOverviewWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type PolyWalletOverviewWarning = z.infer<
  typeof PolyWalletOverviewWarningSchema
>;

export const polyWalletOverviewOperation = {
  id: "poly.wallet.overview.v1",
  summary: "Read the calling user's trading-wallet dashboard summary",
  description:
    "Returns the signed-in user's current trading-wallet snapshot: address, POL gas, available USDC.e, locked open-order notional, position MTM, total, and warning metadata.",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    address: walletAddressSchema.nullable(),
    pol_gas: z.number().nullable(),
    usdc_available: z.number().nullable(),
    usdc_locked: z.number().nullable(),
    usdc_positions_mtm: z.number().nullable(),
    usdc_total: z.number().nullable(),
    open_orders: z.number().int().nonnegative().nullable(),
    warnings: z.array(PolyWalletOverviewWarningSchema),
  }),
} as const;

export type PolyWalletOverviewOutput = z.infer<
  typeof polyWalletOverviewOperation.output
>;
