// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.withdraw.v1.contract`
 * Purpose: Contract for withdrawing funds from the calling user's
 *   tenant-scoped Polymarket trading wallet.
 * Scope: POST /api/v1/poly/wallet/withdraw. Schema-only. TENANT_SCOPED
 *   (session auth). The server derives the source wallet from the session's
 *   billing account; the body can only choose a pinned asset, destination, and
 *   amount.
 * Invariants: NO_GENERIC_SIGNING; IRREVERSIBLE_CONFIRMATION_REQUIRED; typed
 *   assets only (`usdc_e`, `pusd`, `pol`). pUSD withdrawal unwraps pUSD through
 *   Polymarket CollateralOfframp and delivers USDC.e.
 * Side-effects: none
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/withdraw/route.ts,
 *        https://docs.polymarket.com/concepts/pusd,
 *        https://docs.polymarket.com/resources/contracts
 * @public
 */

import { z } from "zod";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const positiveAtomicString = z.string().regex(/^[1-9][0-9]{0,38}$/, {
  message:
    "must be a positive integer string in the selected asset's atomic units",
});

export const polyWalletWithdrawalAssetSchema = z.enum([
  "usdc_e",
  "pusd",
  "pol",
]);

export const polyWalletWithdrawOperation = {
  id: "poly.wallet.withdraw.v1",
  summary:
    "Withdraw funds from the calling user's Polymarket trading wallet",
  description:
    "Moves a typed asset from the caller's tenant trading wallet to a pasted destination address. USDC.e performs an ERC-20 transfer, pUSD unwraps to USDC.e through the pinned Polymarket CollateralOfframp, and POL performs a native Polygon transfer.",
  input: z.object({
    asset: polyWalletWithdrawalAssetSchema,
    destination: walletAddressSchema,
    /** Atomic units. USDC.e/pUSD use 6 decimals; POL uses 18 decimals. */
    amount_atomic: positiveAtomicString,
    confirmation: z.object({
      asset: polyWalletWithdrawalAssetSchema,
      destination: walletAddressSchema,
      amount_atomic: positiveAtomicString,
      irreversible: z.literal(true),
    }),
  }),
  output: z.object({
    asset: polyWalletWithdrawalAssetSchema,
    delivered_asset: z.enum(["usdc_e", "pol"]),
    source_address: walletAddressSchema,
    destination: walletAddressSchema,
    amount_atomic: positiveAtomicString,
    primary_tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    tx_hashes: z.array(z.string().regex(/^0x[a-fA-F0-9]{64}$/)).min(1),
  }),
} as const;

export type PolyWalletWithdrawalAsset = z.infer<
  typeof polyWalletWithdrawalAssetSchema
>;
export type PolyWalletWithdrawInput = z.infer<
  typeof polyWalletWithdrawOperation.input
>;
export type PolyWalletWithdrawOutput = z.infer<
  typeof polyWalletWithdrawOperation.output
>;
