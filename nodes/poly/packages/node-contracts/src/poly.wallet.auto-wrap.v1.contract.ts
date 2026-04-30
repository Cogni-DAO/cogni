// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.auto-wrap.v1.contract`
 * Purpose: Contract for granting and revoking the calling user's consent to
 *   the auto-wrap loop (task.0429). The loop wraps idle USDC.e at the funder
 *   address into spendable pUSD on a 60s scan cycle.
 * Scope: `POST /api/v1/poly/wallet/auto-wrap/consent` (grant) and
 *   `DELETE /api/v1/poly/wallet/auto-wrap/consent` (revoke). Schema-only.
 * Invariants:
 *   - TENANT_SCOPED: both operations are session-authenticated and derive the
 *     tenant from the authenticated user; request bodies cannot override it.
 *   - CONSENT_REVOCABLE: revoke is a single SQL UPDATE; the next job tick
 *     observes it. The connection itself is unaffected (trading still works).
 *   - DUST_GUARD: floor (atomic 6-dp USDC.e) MUST be > 0. Default 1_000_000
 *     (= 1.00 USDC.e) is enforced server-side; the wire field is optional.
 * Side-effects: none
 * Links: work/items/task.0429.poly-auto-wrap-consent-loop.md,
 *        docs/spec/poly-trader-wallet-port.md
 * @public
 */

import { z } from "zod";

/** 6-dp atomic USDC.e amount serialized as a numeric string (bigint-safe). */
const atomicUsdce6dpString = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/, {
    message:
      "must be a positive integer string (atomic 6-dp USDC.e), no leading zeros, max 19 digits",
  });

export const polyWalletAutoWrapConsentGrantOperation = {
  id: "poly.wallet.auto_wrap.consent.grant.v1",
  summary:
    "Grant consent to the auto-wrap loop for the calling user's trading wallet",
  description:
    "Stamps `auto_wrap_consent_at = now()` on the active `poly_wallet_connections` row. The 60s auto-wrap job will then convert idle USDC.e at the funder address to pUSD whenever the balance crosses the floor. Idempotent: re-granting after a revoke clears `auto_wrap_revoked_at`.",
  input: z.object({
    /**
     * Optional override of the default 1.00 USDC.e floor. Atomic 6-dp string.
     * Server validates `> 0` (DB CHECK is the backstop); when omitted, the DB
     * default (1_000_000) is left in place.
     */
    floorUsdceAtomic: atomicUsdce6dpString.optional(),
  }),
  output: z.object({
    auto_wrap_consent_at: z.string().datetime(),
    floor_usdce_atomic: atomicUsdce6dpString,
  }),
} as const;

export const polyWalletAutoWrapConsentRevokeOperation = {
  id: "poly.wallet.auto_wrap.consent.revoke.v1",
  summary:
    "Revoke consent to the auto-wrap loop for the calling user's trading wallet",
  description:
    "Stamps `auto_wrap_revoked_at = now()` on the active `poly_wallet_connections` row. The next auto-wrap job tick will skip this row. Does NOT touch the connection's other lifecycle state — trading continues to work. Idempotent.",
  input: z.object({}),
  output: z.object({
    auto_wrap_revoked_at: z.string().datetime(),
  }),
} as const;

export type PolyWalletAutoWrapConsentGrantInput = z.infer<
  typeof polyWalletAutoWrapConsentGrantOperation.input
>;
export type PolyWalletAutoWrapConsentGrantOutput = z.infer<
  typeof polyWalletAutoWrapConsentGrantOperation.output
>;
export type PolyWalletAutoWrapConsentRevokeOutput = z.infer<
  typeof polyWalletAutoWrapConsentRevokeOperation.output
>;
