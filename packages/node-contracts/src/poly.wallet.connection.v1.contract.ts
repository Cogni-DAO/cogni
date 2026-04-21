// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.connection.v1.contract`
 * Purpose: Contract for provisioning and reading the calling user's Polymarket trading wallet connection.
 * Scope: `POST /api/v1/poly/wallet/connect` and `GET /api/v1/poly/wallet/status`. Schema-only. Does not place trades, set allowances, or move funds.
 * Invariants:
 *   - TENANT_SCOPED: both operations are session-authenticated and derive the
 *     tenant from the authenticated user; request bodies cannot override it.
 *   - CUSTODIAL_CONSENT: connect requires explicit acknowledgement.
 *   - STATUS_REFLECTS_RUNTIME_RESOLVE: `connected=true` means the runtime can
 *     resolve the full signing context, not just that a row exists in the DB.
 * Side-effects: none
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318
 * @public
 */

import { z } from "zod";

const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const polyWalletConnectOperation = {
  id: "poly.wallet.connect.v1",
  summary: "Provision the calling user's Polymarket trading wallet",
  description:
    "Creates or reuses the calling user's dedicated Polymarket trading wallet. Session-authenticated, tenant-scoped, and idempotent.",
  input: z.object({
    custodialConsentAcknowledged: z.literal(true, {
      message:
        "Custodial consent must be explicitly acknowledged — set custodialConsentAcknowledged: true.",
    }),
    custodialConsentActorKind: z.enum(["user", "agent"]),
    custodialConsentActorId: z.string().min(1),
  }),
  output: z.object({
    connection_id: z.string().uuid(),
    funder_address: walletAddressSchema,
    requires_funding: z.boolean(),
    suggested_usdc: z.number().positive(),
    suggested_matic: z.number().positive(),
  }),
} as const;

export const polyWalletStatusOperation = {
  id: "poly.wallet.status.v1",
  summary: "Read the calling user's Polymarket trading wallet status",
  description:
    "Returns whether per-tenant trading wallets are configured on this deployment and whether the calling user already has a resolvable trading wallet connection.",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    connection_id: z.string().uuid().nullable(),
    funder_address: walletAddressSchema.nullable(),
  }),
} as const;

export type PolyWalletConnectInput = z.infer<
  typeof polyWalletConnectOperation.input
>;
export type PolyWalletConnectOutput = z.infer<
  typeof polyWalletConnectOperation.output
>;
export type PolyWalletStatusOutput = z.infer<
  typeof polyWalletStatusOperation.output
>;
