// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/poly-trade-executor`
 * Purpose: Per-tenant Polymarket trade executor. Given a `billingAccountId`,
 *   returns a `PolyTradeExecutor` with `placeIntent` / `closePosition` /
 *   `listPositions` methods that route every order through
 *   `PolyTraderWalletPort.authorizeIntent` before signing — so scope + cap +
 *   grant-revoke checks run on the hot path. Caches the per-tenant
 *   `PolymarketClobAdapter` + viem `WalletClient` so the Privy resolve /
 *   clob-client construction costs are paid once per tenant per process.
 *   Also the lone legal importer of `@polymarket/clob-client` alongside
 *   `poly-trade.ts`; this is where `createOrDerivePolymarketApiKeyForSigner`
 *   lives so the connect path (`bootstrap/poly-trader-wallet.ts`) does not
 *   cross into Poly-trade capability boundaries.
 * Scope: Runtime composition. Does not read env directly (`serverEnv` supplies
 *   strings at the caller); does not persist anything. All HTTPS + signing
 *   happens inside the cached adapter.
 * Invariants:
 *   - AUTHORIZED_PLACE_ONLY — `placeIntent` calls `authorizeIntent` first and
 *     refuses to signal `placeOrder` when the result is `{ok: false}`. The
 *     branded `AuthorizedSigningContext` is the only way the adapter reaches
 *     the CLOB; bypassing the executor bypasses the brand.
 *   - TENANT_CACHE_KEYS_BILLING_ACCOUNT — cached entries are keyed on
 *     `billingAccountId`. No wallet-id / address keys; those can rotate while
 *     the billing account id stays stable.
 *   - CACHE_INVALIDATED_BY_AUTHORIZE — cached signing state is NOT consulted
 *     for auth decisions. Every `placeIntent` call re-runs `authorizeIntent`,
 *     which reads connection + grant rows fresh, so a revoke that lands after
 *     the executor was constructed cannot bypass it.
 *   - NO_STATIC_CLOB_IMPORT — `@polymarket/clob-client` is pulled in via
 *     `await import(...)` so pods without Polymarket creds never load it.
 *   - LAZY_INIT_ADAPTER — adapter construction happens on first per-tenant
 *     call. Subsequent calls reuse the cached instance until the process exits.
 *   - SHARED_PUBLIC_CLIENT — the `viem.PublicClient` used for RPC reads is a
 *     process-level singleton; wallet clients fan out per tenant.
 * Side-effects: on first `placeIntent` for a new tenant: HTTPS to
 *   Polymarket CLOB + Privy API. Subsequent calls reuse cached clients.
 * Links: work/items/task.0318 (Phase B3), docs/spec/poly-trader-wallet-port.md
 * @public
 */

import type {
  GetOrderResult,
  LoggerPort,
  MetricsPort,
  OrderIntent,
  OrderReceipt,
} from "@cogni/market-provider";
import type { PolymarketUserPosition } from "@cogni/market-provider/adapters/polymarket";
import type {
  OrderIntentSummary,
  PolyTraderWalletPort,
} from "@cogni/poly-wallet";
import type { Logger } from "pino";
import type { LocalAccount } from "viem";
import {
  type ClobExecutor,
  createClobExecutor,
} from "@/features/trading/clob-executor";

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;

/**
 * Build a viem wallet client around a Privy-backed signer, then ask the
 * Polymarket CLOB API to create or derive L2 API credentials for it. This
 * factory is the lone `@polymarket/clob-client` dynamic-import boundary
 * consumed by the provisioning path (`bootstrap/poly-trader-wallet.ts`).
 */
export async function createOrDerivePolymarketApiKeyForSigner({
  signer,
  polygonRpcUrl,
  host = DEFAULT_CLOB_HOST,
}: {
  signer: LocalAccount;
  polygonRpcUrl?: string | undefined;
  host?: string | undefined;
}): Promise<{ key: string; secret: string; passphrase: string }> {
  const { ClobClient } = await import("@polymarket/clob-client");
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
  const clob = new ClobClient(host, POLYGON_CHAIN_ID, clobSignerAny);
  return clob.createOrDeriveApiKey();
}

/** Parameters for the autonomous SELL-to-close path. */
export interface ClosePositionParams {
  /** ERC-1155 asset id (Polymarket token). */
  tokenId: string;
  /** Notional USDC cap. Actual size = min(cap, position_size * curPrice). */
  max_size_usdc: number;
  /** Limit price for the SELL; if omitted, executor uses aggressive take-bid. */
  limit_price?: number;
  /** Caller-supplied idempotency key. */
  client_order_id: `0x${string}`;
}

/** Thrown when `closePosition` finds no open position for the given tokenId. */
export class PolyTradeExecutorError extends Error {
  constructor(
    public readonly code: "no_position_to_close" | "not_authorized",
    message: string,
    public readonly reason?: string
  ) {
    super(message);
    this.name = "PolyTradeExecutorError";
  }
}

/**
 * Per-tenant surface for placing, closing, and listing orders. Every
 * `placeIntent` / `closePosition` call routes through `authorizeIntent` so
 * scope + cap checks run on the hot path.
 */
export interface PolyTradeExecutor {
  /** Tenant this executor is bound to. */
  readonly billingAccountId: string;
  /**
   * Authorized placement seam. Refuses (throws) when `authorizeIntent` denies.
   * The mirror-pipeline consumes this verbatim; the caller has already
   * selected sizing + client_order_id via `planMirrorFromFill`.
   */
  placeIntent: (intent: OrderIntent) => Promise<OrderReceipt>;
  /**
   * Autonomous SELL-to-close path. Finds the operator's position for the
   * token, caps size at position value, then routes through `placeIntent`
   * so `authorizeIntent` enforces scope + caps.
   */
  closePosition: (params: ClosePositionParams) => Promise<OrderReceipt>;
  /** Per-tenant position query for the operator address. */
  listPositions: () => Promise<PolymarketUserPosition[]>;
  /** Per-tenant getOrder for the reconciler path (optional, deferred). */
  getOrder: (orderId: string) => Promise<GetOrderResult>;
  /**
   * Market-constraints fetch — returns `{ minShares }` for a token id. Used
   * by the mirror pipeline to pre-flight sizing against the market's share
   * minimum. Raw passthrough to `PolymarketClobAdapter.getMarketConstraints`.
   */
  getMarketConstraints: (
    tokenId: string
  ) => Promise<{ minShares: number; minUsdcNotional?: number }>;
  /** The tenant's current EOA address (used for profile URLs + position queries). */
  readonly funderAddress: `0x${string}`;
}

export interface PolyTradeExecutorFactoryDeps {
  walletPort: PolyTraderWalletPort;
  logger: Logger;
  metrics: MetricsPort;
  host?: string | undefined;
  polygonRpcUrl?: string | undefined;
}

type CachedExecutor = {
  executor: PolyTradeExecutor;
  funderAddress: `0x${string}`;
};

/**
 * Process-level factory. Returns a function that caches executors per
 * `billingAccountId`. Every cached entry reuses the same
 * `PolymarketClobAdapter` (one HTTPS client) + shared `PublicClient` for RPC
 * reads. Scope + cap checks go through `walletPort.authorizeIntent` on every
 * call — the cache never makes auth decisions.
 *
 * @public
 */
export function createPolyTradeExecutorFactory(
  deps: PolyTradeExecutorFactoryDeps
): {
  getPolyTradeExecutorFor: (
    billingAccountId: string
  ) => Promise<PolyTradeExecutor>;
} {
  const cache = new Map<string, CachedExecutor>();
  const inflight = new Map<string, Promise<CachedExecutor>>();

  async function getPolyTradeExecutorFor(
    billingAccountId: string
  ): Promise<PolyTradeExecutor> {
    const cached = cache.get(billingAccountId);
    if (cached) return cached.executor;

    const existing = inflight.get(billingAccountId);
    if (existing) return (await existing).executor;

    const buildPromise = buildExecutor(billingAccountId, deps).then((built) => {
      cache.set(billingAccountId, built);
      inflight.delete(billingAccountId);
      return built;
    });
    inflight.set(billingAccountId, buildPromise);
    try {
      const built = await buildPromise;
      return built.executor;
    } catch (err) {
      inflight.delete(billingAccountId);
      throw err;
    }
  }

  return { getPolyTradeExecutorFor };
}

async function buildExecutor(
  billingAccountId: string,
  deps: PolyTradeExecutorFactoryDeps
): Promise<CachedExecutor> {
  const resolved = await deps.walletPort.resolve(billingAccountId);
  if (!resolved) {
    throw new PolyTradeExecutorError(
      "not_authorized",
      `poly-trade-executor: no active trading wallet for billingAccountId=${billingAccountId}`,
      "no_connection"
    );
  }

  const { PolymarketClobAdapter, PolymarketDataApiClient } = await import(
    "@cogni/market-provider/adapters/polymarket"
  );
  const { createWalletClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");

  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const accountAny: any = resolved.account;
  const walletClient = createWalletClient({
    account: accountAny,
    chain: polygon,
    transport: http(deps.polygonRpcUrl),
  });
  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const signerAny: any = walletClient;

  const loggerPort = adaptLogger(
    deps.logger.child({
      subcomponent: "poly-trade-executor",
      billing_account_id: billingAccountId,
    })
  );

  const adapter = new PolymarketClobAdapter({
    signer: signerAny,
    creds: {
      key: resolved.clobCreds.key,
      secret: resolved.clobCreds.secret,
      passphrase: resolved.clobCreds.passphrase,
    },
    funderAddress: resolved.funderAddress,
    host: deps.host ?? DEFAULT_CLOB_HOST,
    logger: loggerPort,
    metrics: deps.metrics,
  });

  const dataApiClient = new PolymarketDataApiClient();

  // Wrap placeOrder in the generic clob executor (structured logs + metrics)
  // then wrap again with authorize-first semantics.
  const basePlace: ClobExecutor = createClobExecutor({
    placeOrder: adapter.placeOrder.bind(adapter),
    logger: loggerPort,
    metrics: deps.metrics,
  });

  const authorizedPlace = async (
    intent: OrderIntent
  ): Promise<OrderReceipt> => {
    const summary: OrderIntentSummary = {
      side: intent.side,
      usdcAmount: intent.size_usdc,
      marketConditionId: intent.market_id.replace(
        /^prediction-market:polymarket:/,
        ""
      ),
    };
    const authz = await deps.walletPort.authorizeIntent(
      billingAccountId,
      summary
    );
    if (!authz.ok) {
      deps.metrics.incr("poly_authorize_denied_total", {
        reason: authz.reason,
      });
      deps.logger.warn(
        {
          event: "poly.trade.executor.authorize_denied",
          billing_account_id: billingAccountId,
          intent_side: intent.side,
          intent_usdc: intent.size_usdc,
          reason: authz.reason,
        },
        "poly-trade-executor: authorize denied; refusing placeOrder"
      );
      throw new PolyTradeExecutorError(
        "not_authorized",
        `poly-trade-executor: authorize denied (${authz.reason})`,
        authz.reason
      );
    }
    deps.logger.info(
      {
        event: "poly.mirror.place.tenant",
        billing_account_id: billingAccountId,
        grant_id: authz.context.grantId,
        intent_side: intent.side,
        intent_usdc: intent.size_usdc,
        market_id: intent.market_id,
        client_order_id: intent.client_order_id,
      },
      "poly-trade-executor: authorized → placeOrder"
    );
    // With auth green, route through the generic clob executor (logs +
    // metrics). placeOrder takes OrderIntent; the branded context is
    // validated upstream — the adapter's signer + creds already reflect the
    // authorized tenant because `resolved` was used to construct it.
    return basePlace(intent);
  };

  // At this point `resolved` has been null-checked at top of `buildExecutor`;
  // TS narrowing doesn't propagate into the closure, so re-anchor the address.
  const funderAddress = resolved.funderAddress;

  async function closePosition(
    params: ClosePositionParams
  ): Promise<OrderReceipt> {
    const positions = await dataApiClient.listUserPositions(funderAddress);
    const position = positions.find((p) => p.asset === params.tokenId);
    if (!position || position.size <= 0) {
      throw new PolyTradeExecutorError(
        "no_position_to_close",
        `poly-trade-executor: no open position for tokenId=${params.tokenId} on wallet=${funderAddress}`
      );
    }
    const positionValueUsdc = position.size * position.curPrice;
    const effective_size_usdc = Math.min(
      params.max_size_usdc,
      positionValueUsdc
    );
    const limit_price =
      params.limit_price ?? Math.max(0.01, position.curPrice - 0.01);
    const intent: OrderIntent = {
      provider: "polymarket",
      market_id: `prediction-market:polymarket:${position.conditionId}`,
      outcome: position.outcome ?? "",
      side: "SELL",
      size_usdc: effective_size_usdc,
      limit_price,
      client_order_id: params.client_order_id,
      attributes: { token_id: params.tokenId },
    };
    return authorizedPlace(intent);
  }

  const executor: PolyTradeExecutor = {
    billingAccountId,
    placeIntent: authorizedPlace,
    closePosition,
    listPositions: () => dataApiClient.listUserPositions(funderAddress),
    getOrder: adapter.getOrder.bind(adapter),
    getMarketConstraints: adapter.getMarketConstraints.bind(adapter),
    funderAddress,
  };

  return { executor, funderAddress };
}

function adaptLogger(pinoLogger: Logger): LoggerPort {
  return {
    debug(obj, msg) {
      pinoLogger.debug(obj as object, msg);
    },
    info(obj, msg) {
      pinoLogger.info(obj as object, msg);
    },
    warn(obj, msg) {
      pinoLogger.warn(obj as object, msg);
    },
    error(obj, msg) {
      pinoLogger.error(obj as object, msg);
    },
    child(bindings) {
      return adaptLogger(pinoLogger.child(bindings));
    },
  };
}
