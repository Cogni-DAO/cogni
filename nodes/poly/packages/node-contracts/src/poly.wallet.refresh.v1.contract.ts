// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.refresh.v1.contract`
 * Purpose: Defines the manual Polymarket wallet refresh mutation contract.
 * Scope: POST /api/v1/poly/wallet/refresh. Session-authenticated. Bounded
 *   server-side refresh trigger used by the dashboard refresh icon.
 * Side-effects: none
 * Links: bug.5001
 * @public
 */

import { z } from "zod";
import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

export const PolyWalletRefreshOutputSchema = z.object({
  address: PolyAddressSchema,
  refreshedAt: z.string(),
  executionCapturedAt: z.string().nullable(),
  warnings: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
    })
  ),
});
export type PolyWalletRefreshOutput = z.infer<
  typeof PolyWalletRefreshOutputSchema
>;

export const polyWalletRefreshOperation = {
  id: "poly.wallet.refresh.v1",
  summary: "Force-refresh the signed-in user's Polymarket wallet read data",
  description:
    "Invalidates process-local wallet caches and runs a bounded non-CLOB execution refresh for the signed-in user's trading wallet.",
  input: z.object({}),
  output: PolyWalletRefreshOutputSchema,
} as const;
