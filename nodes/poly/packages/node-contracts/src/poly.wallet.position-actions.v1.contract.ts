// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.position-actions.v1.contract`
 * Purpose: Zod input/output for dashboard POST routes that close open positions via the CLOB (SELL) or redeem resolved outcome tokens via the Conditional Tokens contract.
 * Scope: Schema-only for `POST /api/v1/poly/wallet/positions/close` and `POST /api/v1/poly/wallet/positions/redeem`. Does not implement handlers, sign transactions, or read session state.
 * Invariants:
 *   - TENANT_SIGNING_OFF_BOUNDARY — close/redeem execution stays in the poly app route + executor; this file only names JSON fields.
 *   - SESSION_AUTH_OUT_OF_BAND — callers authenticate via session cookie; not modeled in these Zod objects.
 * Side-effects: none (schema only)
 * Links: nodes/poly/app/src/app/api/v1/poly/wallet/positions/close/route.ts,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts
 * @public
 */

import { z } from "zod";

export const polyWalletClosePositionOperation = {
  id: "poly.wallet.position_close.v1",
  summary:
    "Market SELL to fully exit an open position via CLOB, or classify stale/dust ledger exposure when no sell is possible",
  input: z.object({
    token_id: z.string().min(1),
  }),
  output: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("order"),
      order_id: z.string(),
      status: z.string(),
      client_order_id: z.string(),
      filled_size_usdc: z.number(),
    }),
    z.object({
      kind: z.literal("classified"),
      status: z.enum(["closed", "dust"]),
      classification: z.enum(["stale_zero_balance", "below_market_min"]),
      ledger_rows_updated: z.number().int().nonnegative(),
    }),
  ]),
} as const;

export type PolyWalletClosePositionInput = z.infer<
  typeof polyWalletClosePositionOperation.input
>;
export type PolyWalletClosePositionOutput = z.infer<
  typeof polyWalletClosePositionOperation.output
>;

export const polyWalletRedeemPositionOperation = {
  id: "poly.wallet.position_redeem.v1",
  summary:
    "Redeem resolved outcome tokens via Conditional Tokens redeemPositions",
  input: z.object({
    condition_id: z.string().min(1),
  }),
  output: z.object({
    tx_hash: z.string(),
  }),
} as const;

export type PolyWalletRedeemPositionInput = z.infer<
  typeof polyWalletRedeemPositionOperation.input
>;
export type PolyWalletRedeemPositionOutput = z.infer<
  typeof polyWalletRedeemPositionOperation.output
>;
