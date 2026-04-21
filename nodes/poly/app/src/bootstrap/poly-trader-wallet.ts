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

import { PrivyClient } from "@privy-io/node";
import type { Logger } from "pino";
import type { LocalAccount } from "viem";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { PrivyPolyTraderWalletAdapter } from "@/adapters/server/wallet";
import { createOrDerivePolymarketApiKeyForSigner } from "@/bootstrap/capabilities/poly-trade";
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
  deriveCreds = createOrDerivePolymarketApiKeyForSigner,
}: {
  logger: Logger;
  polygonRpcUrl?: string | undefined;
  deriveCreds?: (input: {
    signer: LocalAccount;
    polygonRpcUrl?: string | undefined;
  }) => Promise<{
    key: string;
    secret: string;
    passphrase: string;
  }>;
}) {
  return async (signer: LocalAccount) => {
    try {
      return await deriveCreds({ signer, polygonRpcUrl });
    } catch (err) {
      logger.error(
        {
          component: "poly-trader-wallet-bootstrap",
          funder_address: signer.address,
          err: err instanceof Error ? err.message : String(err),
        },
        "poly.wallet.provision failed to derive live CLOB creds"
      );
      throw new Error(
        "Failed to derive Polymarket CLOB API credentials for the tenant wallet",
        { cause: err }
      );
    }
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

  cached = new PrivyPolyTraderWalletAdapter({
    privyClient,
    privySigningKey: signingKey,
    serviceDb: getServiceDb(),
    encryptionKey,
    encryptionKeyId: aeadKeyId,
    clobCredsFactory: createRealClobCredsFactory({
      logger,
      polygonRpcUrl: env.POLYGON_RPC_URL,
    }),
    logger,
  });
  return cached;
}

/** For tests only — clears the memoized instance. */
export function __resetPolyTraderWalletAdapterForTests(): void {
  cached = null;
}
