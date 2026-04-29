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
 *   - STATUS_REFLECTS_ACTIVE_CONNECTION: `connected=true` means there is an
 *     un-revoked `poly_wallet_connections` row for the tenant (DB-only read via
 *     `PolyTraderWalletPort.getConnectionSummary`). It does **not** assert Privy
 *     or Polygon RPC reachability on that GET — signing paths (`resolve`,
 *     `authorizeIntent`, `ensureTradingApprovals`) validate custody + RPC when
 *     they run. `trading_ready` is true iff `trading_approvals_ready_at` is set
 *     on that row (task.0355, APPROVALS_BEFORE_PLACE).
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
    // v0: session-authed user path only. Agent-API-key auth lands in B3 and
    // will widen this to `z.enum(["user", "agent"])` once actor-id binding
    // from the API-key is enforced. The DB CHECK constraint on
    // `poly_wallet_connections.custodial_consent_actor_kind` already allows
    // both values so no schema change is needed when we widen.
    custodialConsentActorKind: z.literal("user"),
    custodialConsentActorId: z.string().min(1),
    /**
     * Caps baked into the default `poly_wallet_grants` row the server issues
     * atomically with the wallet provision. UI gathers these via two
     * horizontal sliders on the consent step. Bounds mirror the slider
     * ranges in the profile view; the DB CHECK on
     * `poly_wallet_grants.daily_usdc_cap >= per_order_usdc_cap` is a
     * backstop — validated here too so the 400 response explains the issue
     * before it reaches the adapter.
     *
     * `hourlyFillsCap` is NOT on the wire: baked in server-side from
     * `MIRROR_MAX_FILLS_PER_HOUR` to keep the consent UI minimal. A future
     * per-tenant preferences table (task.0347) will swap the server-side
     * default for a user-adjustable value without widening this contract.
     */
    defaultGrant: z
      .object({
        perOrderUsdcCap: z.number().positive().min(0.5).max(20),
        dailyUsdcCap: z.number().positive().min(2).max(200),
      })
      .refine((grant) => grant.dailyUsdcCap >= grant.perOrderUsdcCap, {
        message: "dailyUsdcCap must be >= perOrderUsdcCap",
        path: ["dailyUsdcCap"],
      }),
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
    "Returns whether per-tenant trading wallets are configured on this deployment, whether the calling user has an active (non-revoked) trading-wallet connection row (`connected`), and whether Polymarket on-chain approvals are stamped (`trading_ready`, APPROVALS_BEFORE_PLACE). The GET handler uses a DB-only summary for fast page loads; it does not call Privy or decrypt CLOB credentials — those are exercised on signing paths (`resolve` / `authorizeIntent`).",
  input: z.object({}),
  output: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    connection_id: z.string().uuid().nullable(),
    funder_address: walletAddressSchema.nullable(),
    /**
     * True iff `poly_wallet_connections.trading_approvals_ready_at IS NOT
     * NULL` on the active connection. When false and `connected` is true,
     * the user needs to run Enable Trading on the Money page; `authorizeIntent`
     * will fail-closed with `trading_not_ready` until this flips.
     */
    trading_ready: z.boolean(),
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
