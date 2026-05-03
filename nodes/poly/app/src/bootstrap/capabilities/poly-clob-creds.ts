// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/poly-clob-creds`
 * Purpose: Live Polymarket CLOB API-key derivation and rotation for
 *   Privy-backed tenant trading wallets.
 * Invariants:
 *   - PROVISIONING_USES_MANUAL_GREEN_CHAIN — L1 API-key provisioning uses
 *     `@polymarket/clob-client` v5.x with the positional constructor. Manual
 *     candidate-a validation proves this path returns `{key, secret,
 *     passphrase}` for Privy server wallets while `@polymarket/clob-client-v2`
 *     fails upstream before usable creds are produced.
 *   - NO_POISONED_CREDS — empty or error-shaped CLOB responses are rejected
 *     before encryption/storage.
 * Links: docs/guides/poly-wallet-provisioning.md
 * @internal
 */

import type { LocalAccount } from "viem";

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

type ClobHttpErrorLike = {
  readonly status?: unknown;
  readonly response?: {
    readonly status?: unknown;
  };
  readonly message?: unknown;
};

function readClobHttpStatus(err: unknown): number | undefined {
  const maybe = err as ClobHttpErrorLike | null;
  if (typeof maybe?.response?.status === "number") {
    return maybe.response.status;
  }
  if (typeof maybe?.status === "number") {
    return maybe.status;
  }
  return undefined;
}

export function classifyClobCredentialRotationError(err: unknown): {
  readonly reasonCode: string;
  readonly httpStatus?: number | undefined;
  readonly errorClass?: string | undefined;
  readonly cloudflareRayId?: string | undefined;
} {
  const httpStatus = readClobHttpStatus(err);
  const errorClass =
    err && typeof err === "object" && err.constructor?.name
      ? err.constructor.name
      : undefined;
  const message =
    typeof (err as ClobHttpErrorLike | null)?.message === "string"
      ? String((err as ClobHttpErrorLike).message)
      : "";
  const cloudflareRayId =
    /Cloudflare Ray ID:\s*<strong[^>]*>([^<]+)<\/strong>/i.exec(message)?.[1] ??
    /Cloudflare Ray ID:\s*([a-z0-9]+)/i.exec(message)?.[1] ??
    undefined;
  if (
    httpStatus === 403 &&
    (message.includes("Cloudflare") ||
      message.includes("Sorry, you have been blocked"))
  ) {
    return {
      reasonCode: "clob_cloudflare_blocked",
      httpStatus,
      errorClass,
      cloudflareRayId,
    };
  }
  if (httpStatus === 401) {
    return { reasonCode: "clob_upstream_unauthorized", httpStatus, errorClass };
  }
  if (httpStatus === 403) {
    return { reasonCode: "clob_upstream_forbidden", httpStatus, errorClass };
  }
  if (httpStatus === 429) {
    return { reasonCode: "clob_upstream_rate_limited", httpStatus, errorClass };
  }
  if (httpStatus !== undefined) {
    return { reasonCode: "clob_upstream_http_error", httpStatus, errorClass };
  }
  return { reasonCode: "clob_upstream_error", errorClass };
}

function isKnownAlreadyInvalidApiKeyError(err: unknown): boolean {
  const status = readClobHttpStatus(err);
  if (status === 401) return true;
  const message =
    typeof (err as ClobHttpErrorLike | null)?.message === "string"
      ? String((err as ClobHttpErrorLike).message).toLowerCase()
      : "";
  return (
    message.includes("invalid api key") ||
    message.includes("unauthorized api key")
  );
}

type PolymarketApiKeyCreds = {
  key: string;
  secret: string;
  passphrase: string;
};

function readNonEmptyString(
  raw: Record<string, unknown>,
  key: string
): string | null {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizePolymarketApiKeyCreds(
  raw: unknown
): PolymarketApiKeyCreds {
  if (!raw || typeof raw !== "object") {
    throw new Error("Polymarket CLOB API credentials response was empty");
  }

  const obj = raw as Record<string, unknown>;
  const key =
    readNonEmptyString(obj, "key") ?? readNonEmptyString(obj, "apiKey");
  const secret = readNonEmptyString(obj, "secret");
  const passphrase = readNonEmptyString(obj, "passphrase");

  if (!key || !secret || !passphrase) {
    throw new Error(
      "Polymarket CLOB API credentials response missing key, secret, or passphrase"
    );
  }

  return { key, secret, passphrase };
}

export async function createOrDerivePolymarketApiKeyForSigner({
  signer,
  polygonRpcUrl,
  geoBlockToken,
  host = DEFAULT_CLOB_HOST,
}: {
  signer: LocalAccount;
  polygonRpcUrl?: string | undefined;
  geoBlockToken?: string | undefined;
  host?: string | undefined;
}): Promise<PolymarketApiKeyCreds> {
  const { ClobClient } = await import("@polymarket/clob-client");
  const { withSanitizedClobSdkConsoleErrors } = await import(
    "@cogni/poly-market-provider/adapters/polymarket"
  );
  const { createWalletClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");

  // viem version drift between @privy-io/node/viem peerDep and this app's viem
  // forces a cast; runtime shape matches WalletClient.account exactly.
  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const signerAny: any = signer;
  const walletClient = createWalletClient({
    account: signerAny,
    chain: polygon,
    transport: http(polygonRpcUrl),
  });

  // Same cast rationale as above — dual-peerDep viem typing.
  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const clobSignerAny: any = walletClient;
  const clob = new ClobClient(
    host,
    POLYGON_CHAIN_ID,
    clobSignerAny,
    undefined,
    undefined,
    undefined,
    geoBlockToken,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  const creds = await withSanitizedClobSdkConsoleErrors(() =>
    clob.createOrDeriveApiKey()
  );
  return normalizePolymarketApiKeyCreds(creds);
}

export async function rotatePolymarketApiKeyForSigner({
  signer,
  currentCreds,
  polygonRpcUrl,
  host = DEFAULT_CLOB_HOST,
}: {
  signer: LocalAccount;
  currentCreds: { key: string; secret: string; passphrase: string };
  polygonRpcUrl?: string | undefined;
  host?: string | undefined;
}): Promise<PolymarketApiKeyCreds> {
  const { ClobClient } = await import("@polymarket/clob-client-v2");
  const { withSanitizedClobSdkConsoleErrors } = await import(
    "@cogni/poly-market-provider/adapters/polymarket"
  );
  const { createWalletClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");

  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const signerAny: any = signer;
  const walletClient = createWalletClient({
    account: signerAny,
    chain: polygon,
    transport: http(polygonRpcUrl),
  });

  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const clobSignerAny: any = walletClient;
  const createClient = new ClobClient({
    host,
    chain: POLYGON_CHAIN_ID,
    signer: clobSignerAny,
    throwOnError: true,
  });
  const oldCredsClient = new ClobClient({
    host,
    chain: POLYGON_CHAIN_ID,
    signer: clobSignerAny,
    creds: currentCreds,
    throwOnError: true,
  });

  return withSanitizedClobSdkConsoleErrors(async () => {
    const nextCreds = await createClient.createApiKey();
    try {
      await oldCredsClient.deleteApiKey();
    } catch (err) {
      if (!isKnownAlreadyInvalidApiKeyError(err)) throw err;
    }
    return normalizePolymarketApiKeyCreds(nextCreds);
  });
}
