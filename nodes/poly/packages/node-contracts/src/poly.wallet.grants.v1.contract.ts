// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.grants.v1.contract`
 * Purpose: Contract for the calling user's active `polyWalletGrants` row — GET reads, PUT updates `per_order_usdc_cap` + `daily_usdc_cap`. Powers the Money-page policy editor (task.0347).
 * Scope: Schema-only. TENANT_SCOPED via session auth; routes never accept billing_account_id from the wire. Does not provision grants, does not move funds, does not touch hourly_fills_cap.
 * Invariants:
 *   - DAILY_GE_PER_ORDER — Zod refinement mirrors DB CHECK; malformed PUT 422s before the DB rejects.
 *   - CAPS_POSITIVE — both caps > 0.
 *   - NO_HOURLY_FILLS_EDIT — schema field exists but is not on the wire.
 * Side-effects: none
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/packages/db-schema/src/wallet-grants.ts,
 *        work/items/task.0347.poly-wallet-preferences-sizing-config.md
 * @public
 */

import { z } from "zod";

const usdcCap = z.number().positive().finite();

export const polyWalletGrantsErrorCode = z.enum([
  "no_active_grant",
  "invalid_caps",
]);
export type PolyWalletGrantsErrorCode = z.infer<
  typeof polyWalletGrantsErrorCode
>;

export const polyWalletGrantsGetOperation = {
  id: "poly.wallet.grants.get.v1",
  summary: "Read the calling user's active wallet-grants row",
  description:
    "Returns the active grant row for the calling user's tenant (RLS-clamped). `connected=false` when the user has no active grant — the Money page falls back to the onboarding CTA in that case.",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    grant: z
      .object({
        id: z.string().uuid(),
        per_order_usdc_cap: usdcCap,
        daily_usdc_cap: usdcCap,
        hourly_fills_cap: z.number().int().positive(),
      })
      .nullable(),
  }),
} as const;

export type PolyWalletGrantsGetOutput = z.infer<
  typeof polyWalletGrantsGetOperation.output
>;

export const polyWalletGrantsPutOperation = {
  id: "poly.wallet.grants.put.v1",
  summary: "Update per-order and per-day USDC caps on the active grant",
  description:
    "Partial update: only `per_order_usdc_cap` and `daily_usdc_cap` can be edited via this surface. Hourly fills cap is provisioned-only in v1. RLS-clamped — a tenant cannot mutate another tenant's grant.",
  input: z
    .object({
      per_order_usdc_cap: usdcCap,
      daily_usdc_cap: usdcCap,
    })
    .refine((v) => v.daily_usdc_cap >= v.per_order_usdc_cap, {
      message: "daily_usdc_cap must be >= per_order_usdc_cap",
      path: ["daily_usdc_cap"],
    }),
  output: z.object({
    grant: z.object({
      id: z.string().uuid(),
      per_order_usdc_cap: usdcCap,
      daily_usdc_cap: usdcCap,
      hourly_fills_cap: z.number().int().positive(),
    }),
  }),
} as const;

export type PolyWalletGrantsPutInput = z.infer<
  typeof polyWalletGrantsPutOperation.input
>;
export type PolyWalletGrantsPutOutput = z.infer<
  typeof polyWalletGrantsPutOperation.output
>;

export const polyWalletGrantsErrorOutput = z.object({
  code: polyWalletGrantsErrorCode,
  message: z.string(),
});
export type PolyWalletGrantsErrorOutput = z.infer<
  typeof polyWalletGrantsErrorOutput
>;
