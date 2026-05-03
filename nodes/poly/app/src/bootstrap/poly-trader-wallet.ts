// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/poly-trader-wallet`
 * Purpose: Constructs and memoizes the PrivyPolyTraderWalletAdapter from env so
 *   route handlers can consume it without importing `@/adapters/**` directly
 *   (architectural constraint enforced by eslint no-restricted-imports).
 * Scope: Bootstrap wiring only. Does not implement the port or read DB rows.
 * Invariants:
 *   - SEPARATE_PRIVY_APP: this module reads PRIVY_USER_WALLETS_* never PRIVY_APP_* (the operator-wallet triple).
 * Side-effects: IO (PrivyClient construction) on first call.
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @internal
 */

import { polyWalletConnections } from "@cogni/poly-db-schema";
import { PrivyClient } from "@privy-io/node";
import { desc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { LocalAccount } from "viem";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { PrivyPolyTraderWalletAdapter } from "@/adapters/server/wallet";
import {
  classifyClobCredentialRotationError,
  createOrDerivePolymarketApiKeyForSigner,
  normalizePolymarketApiKeyCreds,
  rotatePolymarketApiKeyForSigner,
} from "@/bootstrap/capabilities/poly-clob-creds";
import { serverEnv } from "@/shared/env/server-env";

export class WalletAdapterUnconfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `PolyTraderWalletAdapter not configured: missing env vars: ${missing.join(", ")}`
    );
    this.name = "WalletAdapterUnconfiguredError";
  }
}

let cached: PrivyPolyTraderWalletAdapter | null = null;

export function createRealClobCredsFactory({
  logger,
  polygonRpcUrl,
  geoBlockToken,
  deriveCreds = createOrDerivePolymarketApiKeyForSigner,
  rotateCreds = rotatePolymarketApiKeyForSigner,
}: {
  logger: Logger;
  polygonRpcUrl?: string | undefined;
  geoBlockToken?: string | undefined;
  deriveCreds?: (input: {
    signer: LocalAccount;
    polygonRpcUrl?: string | undefined;
    geoBlockToken?: string | undefined;
  }) => Promise<{
    key: string;
    secret: string;
    passphrase: string;
  }>;
  rotateCreds?: (input: {
    signer: LocalAccount;
    currentCreds: { key: string; secret: string; passphrase: string };
    polygonRpcUrl?: string | undefined;
  }) => Promise<{
    key: string;
    secret: string;
    passphrase: string;
  }>;
}) {
  return {
    derive: async (signer: LocalAccount) => {
      try {
        return normalizePolymarketApiKeyCreds(
          await deriveCreds({ signer, polygonRpcUrl, geoBlockToken })
        );
      } catch (err) {
        const failure = classifyClobCredentialRotationError(err);
        logger.error(
          {
            component: "poly-trader-wallet-bootstrap",
            funder_address: signer.address,
            reason_code: failure.reasonCode,
            http_status: failure.httpStatus,
            error_class: failure.errorClass,
            cloudflare_ray_id: failure.cloudflareRayId,
          },
          "poly.wallet.provision failed to derive live CLOB creds"
        );
        throw Object.assign(
          new Error(
            "Failed to derive Polymarket CLOB API credentials for the tenant wallet"
          ),
          { code: failure.reasonCode }
        );
      }
    },
    rotate: async (
      signer: LocalAccount,
      currentCreds: { key: string; secret: string; passphrase: string }
    ) => {
      try {
        return normalizePolymarketApiKeyCreds(
          await rotateCreds({ signer, currentCreds, polygonRpcUrl })
        );
      } catch (err) {
        const failure = classifyClobCredentialRotationError(err);
        logger.error(
          {
            component: "poly-trader-wallet-bootstrap",
            funder_address: signer.address,
            reason_code: failure.reasonCode,
            http_status: failure.httpStatus,
            error_class: failure.errorClass,
            cloudflare_ray_id: failure.cloudflareRayId,
          },
          "poly.wallet.rotate failed to rotate live CLOB creds"
        );
        throw Object.assign(
          new Error(
            "Failed to rotate Polymarket CLOB API credentials for the tenant wallet"
          ),
          { code: failure.reasonCode }
        );
      }
    },
  };
}

/**
 * Lazy-construct + memoize the adapter. Follow-up will move this into the
 * main container; standalone factory keeps the first flight-able commit small.
 *
 * @throws {WalletAdapterUnconfiguredError} when env is missing.
 */
export function getPolyTraderWalletAdapter(
  logger: Logger
): PrivyPolyTraderWalletAdapter {
  if (cached) return cached;

  const env = serverEnv();
  const missing: string[] = [];
  const appId = env.PRIVY_USER_WALLETS_APP_ID;
  const appSecret = env.PRIVY_USER_WALLETS_APP_SECRET;
  const signingKey = env.PRIVY_USER_WALLETS_SIGNING_KEY;
  const aeadKeyHex = env.POLY_WALLET_AEAD_KEY_HEX;
  const aeadKeyId = env.POLY_WALLET_AEAD_KEY_ID;
  if (!appId) missing.push("PRIVY_USER_WALLETS_APP_ID");
  if (!appSecret) missing.push("PRIVY_USER_WALLETS_APP_SECRET");
  if (!signingKey) missing.push("PRIVY_USER_WALLETS_SIGNING_KEY");
  if (!aeadKeyHex) missing.push("POLY_WALLET_AEAD_KEY_HEX");
  if (!aeadKeyId) missing.push("POLY_WALLET_AEAD_KEY_ID");
  if (
    missing.length ||
    !appId ||
    !appSecret ||
    !signingKey ||
    !aeadKeyHex ||
    !aeadKeyId
  ) {
    throw new WalletAdapterUnconfiguredError(missing);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(aeadKeyHex)) {
    throw new Error(
      "POLY_WALLET_AEAD_KEY_HEX must be exactly 64 hex characters (AES-256-GCM)"
    );
  }
  const encryptionKey = Buffer.from(aeadKeyHex, "hex");

  const privyClient = new PrivyClient({
    appId,
    appSecret,
  });

  const clobCreds = createRealClobCredsFactory({
    logger,
    polygonRpcUrl: env.POLYGON_RPC_URL,
    geoBlockToken: env.POLY_CLOB_GEO_BLOCK_TOKEN,
  });

  cached = new PrivyPolyTraderWalletAdapter({
    privyClient,
    privySigningKey: signingKey,
    serviceDb: getServiceDb(),
    encryptionKey,
    encryptionKeyId: aeadKeyId,
    clobCredsFactory: clobCreds.derive,
    clobCredsRotator: clobCreds.rotate,
    polygonRpcUrl: env.POLYGON_RPC_URL,
    logger,
  });
  return cached;
}

/** For tests only — clears the memoized instance. */
export function __resetPolyTraderWalletAdapterForTests(): void {
  cached = null;
}

/**
 * Minimum window between consecutive `/connect` attempts for a single tenant
 * whose latest wallet is *revoked*. Bounds the connect→revoke→connect churn
 * path; idempotent re-hits with an active row do NOT hit this limit.
 */
export const POLY_WALLET_CONNECT_RATE_LIMIT_MS = 5 * 60 * 1000;

export interface ConnectRateLimitResult {
  /** True when the caller should return 429 instead of invoking `provision`. */
  limited: boolean;
  /** Seconds until the cooldown expires; only meaningful when `limited`. */
  retryAfterSeconds: number;
}

/**
 * Check whether a new `/connect` attempt for the given tenant should be
 * rate-limited. Returns `{ limited: false }` when:
 *   - the tenant has no rows yet (first-ever provision), OR
 *   - the tenant's most-recent row is still active (idempotent re-hit), OR
 *   - the tenant's most-recent row was revoked more than the cooldown ago.
 * Returns `{ limited: true, retryAfterSeconds }` when the most-recent row is
 * revoked AND still inside the cooldown window.
 *
 * Kept in bootstrap (not in the route / not in the adapter) so route handlers
 * can consume it without crossing the `@/adapters/**` boundary.
 */
export async function checkConnectRateLimit(
  billingAccountId: string,
  nowMs: number = Date.now()
): Promise<ConnectRateLimitResult> {
  const db = getServiceDb();
  const [latest] = await db
    .select({
      revokedAt: polyWalletConnections.revokedAt,
    })
    .from(polyWalletConnections)
    .where(eq(polyWalletConnections.billingAccountId, billingAccountId))
    .orderBy(desc(polyWalletConnections.createdAt))
    .limit(1);

  if (!latest?.revokedAt) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  const revokedMsAgo = nowMs - latest.revokedAt.getTime();
  if (revokedMsAgo >= POLY_WALLET_CONNECT_RATE_LIMIT_MS) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  return {
    limited: true,
    retryAfterSeconds: Math.ceil(
      (POLY_WALLET_CONNECT_RATE_LIMIT_MS - revokedMsAgo) / 1000
    ),
  };
}
