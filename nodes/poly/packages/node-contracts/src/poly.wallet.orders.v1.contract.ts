// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.orders.v1.contract`
 * Purpose: Wire contract for the per-tenant open-orders read.
 * Scope: GET /api/v1/poly/wallet/orders. Read-only, session-authenticated,
 *   tenant-scoped. Counterpart to /wallet/overview which only carries the
 *   open-order count + locked-USDC sum; this route returns the full
 *   per-order list so the account-activity UI can render a paginated table.
 * Invariants:
 *   - TENANT_SCOPED: caller's billing account is resolved from session.
 *   - PARTIAL_FAILURE_NEVER_THROWS: upstream CLOB errors degrade to empty
 *     orders + warning entry; route stays 200.
 *   - WIRE_SHAPE_OWNED_HERE: OpenOrderSchema is the authoritative wire
 *     shape. The bootstrap capability `OpenOrderSummary` shape mirrors
 *     this and converges on a single export when the executor migrates
 *     into a shared package.
 * Side-effects: none
 * Links: bug.5000, docs/spec/poly-trader-wallet-port.md
 * @public
 */

import { z } from "zod";

export const PolyWalletOpenOrderSchema = z.object({
  orderId: z.string(),
  marketId: z.string().nullable(),
  tokenId: z.string().nullable(),
  outcome: z.string().nullable(),
  side: z.enum(["BUY", "SELL"]).nullable(),
  price: z.number().nullable(),
  originalShares: z.number().nullable(),
  matchedShares: z.number().nullable(),
  remainingUsdc: z.number().nullable(),
  submittedAt: z.string(),
  status: z.string(),
});
export type PolyWalletOpenOrder = z.infer<typeof PolyWalletOpenOrderSchema>;

export const PolyWalletOrdersWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type PolyWalletOrdersWarning = z.infer<
  typeof PolyWalletOrdersWarningSchema
>;

export const PolyWalletOrdersOutputSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  address: z.string().nullable(),
  capturedAt: z.string(),
  orders: z.array(PolyWalletOpenOrderSchema),
  warnings: z.array(PolyWalletOrdersWarningSchema),
});
export type PolyWalletOrdersOutput = z.infer<
  typeof PolyWalletOrdersOutputSchema
>;

export const polyWalletOrdersOperation = {
  id: "poly.wallet.orders.v1",
  summary: "Per-tenant live CLOB open orders",
  description:
    "Returns the full list of resting CLOB orders for the caller's Polymarket trading wallet. Complements /wallet/overview (count + locked-USDC) and /wallet/execution (positions + cadence) — neither of those carries the per-order detail.",
  input: z.object({}),
  output: PolyWalletOrdersOutputSchema,
} as const;
