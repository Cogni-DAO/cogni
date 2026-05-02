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

export const PolyWalletOverviewIntervalSchema = z.enum([
  "1D",
  "1W",
  "1M",
  "1Y",
  "YTD",
  "ALL",
]);
export type PolyWalletOverviewInterval = z.infer<
  typeof PolyWalletOverviewIntervalSchema
>;
export const PolyWalletDataFreshnessSchema = z.enum(["read_model", "live"]);
export type PolyWalletDataFreshness = z.infer<
  typeof PolyWalletDataFreshnessSchema
>;

export const PolyWalletOverviewWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type PolyWalletOverviewWarning = z.infer<
  typeof PolyWalletOverviewWarningSchema
>;

export const PolyWalletOverviewPnlPointSchema = z.object({
  ts: z.string(),
  pnl: z.number(),
});
export type PolyWalletOverviewPnlPoint = z.infer<
  typeof PolyWalletOverviewPnlPointSchema
>;

export const polyWalletOverviewOperation = {
  id: "poly.wallet.overview.v1",
  summary:
    "Read the calling user's trading-wallet dashboard summary and Polymarket P/L history",
  description:
    "Returns the signed-in user's current trading-wallet snapshot plus a Polymarket-native P/L chart history for the requested interval.",
  input: z.object({
    interval: PolyWalletOverviewIntervalSchema.optional(),
    freshness: PolyWalletDataFreshnessSchema.optional().default("live"),
  }),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    freshness: PolyWalletDataFreshnessSchema,
    address: walletAddressSchema.nullable(),
    interval: PolyWalletOverviewIntervalSchema,
    capturedAt: z.string(),
    pol_gas: z.number().nullable(),
    usdc_available: z.number().nullable(),
    usdc_locked: z.number().nullable(),
    usdc_positions_mtm: z.number().nullable(),
    usdc_total: z.number().nullable(),
    open_orders: z.number().int().nonnegative().nullable(),
    positions_synced_at: z.string().nullable(),
    positions_sync_age_ms: z.number().int().nonnegative().nullable(),
    positions_stale: z.boolean(),
    pnlHistory: z.array(PolyWalletOverviewPnlPointSchema),
    warnings: z.array(PolyWalletOverviewWarningSchema),
  }),
} as const;

export type PolyWalletOverviewOutput = z.infer<
  typeof polyWalletOverviewOperation.output
>;
