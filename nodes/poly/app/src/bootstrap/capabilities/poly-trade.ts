// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/poly-trade`
 * Purpose: Factory for `PolyTradeCapability` — binds the PolymarketClobAdapter (+ Privy signer + pino + prom-client sinks) behind the agent-callable `core__poly_place_trade` AI tool. Sole legal importer of `@polymarket/clob-client` and `@privy-io/node/viem` in this app. Returns `undefined` when CLOB / Privy / operator-wallet env is not fully configured, so non-trader pods register a stub.
 * Scope: Runtime wiring only. Does not read env directly (server-env supplies strings); does not persist anything; does not place orders itself. Holds the adapter + Privy wallet lifecycle for the process.
 * Invariants:
 *   - LAZY_INIT_MATCHES_TEMPORAL — factory is sync (returns `PolyTradeCapability | undefined` after env-presence check). Dynamic imports + Privy wallet resolution happen inside `placeTrade` on first call and are memoized. Matches the `getTemporalWorkflowClient` pattern in container.ts.
 *   - CAPABILITY_FAIL_LOUD — Privy wallet resolution errors throw on first `placeTrade` invocation with a clear message, not silently. (Bootstrap-time fail-fast deferred; the async `register()` hook could call a warm-up if ops needs it.)
 *   - NO_STATIC_CLOB_IMPORT — uses `await import(...)` so deployments without CLOB creds never pull in `@polymarket/clob-client`.
 *   - TEST_HOOK_IS_FACTORY_PARAM — `placeOrderOverride` is the sole mechanism for test substitution; production callers never pass it. Override path skips dynamic imports entirely.
 *   - PROM_REGISTRY_SHARED — counters + histograms register on the app's singleton registry via `getOrCreate` helpers; no duplicate-registration errors across HMR / test boots.
 *   - BUY_ONLY — the capability rejects SELL until CTF setApprovalForAll is wired (out of prototype scope).
 *   - KEY_NEVER_IN_APP — CLOB L2 creds + Privy signing key stay in env; the adapter holds them in-memory only for the lifetime of the process.
 * Side-effects: none on factory call; on first `placeTrade` invocation: Privy wallet list pagination to resolve `operatorWalletAddress`, then HTTPS to Polymarket CLOB on each subsequent call.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.25)
 * @internal
 */

import type {
  PolyPlaceTradeReceipt,
  PolyPlaceTradeRequest,
  PolyTradeCapability,
} from "@cogni/ai-tools";
import type {
  LoggerPort,
  MetricsPort,
  OrderIntent,
  OrderReceipt,
} from "@cogni/market-provider";
import type { Counter, Histogram } from "prom-client";
import client from "prom-client";

import { createClobExecutor } from "@/features/copy-trade/clob-executor";
import type { Logger } from "@/shared/observability/server";
import { metricsRegistry } from "@/shared/observability/server";

/** CLOB L2 credentials. Must match what `derive-polymarket-api-keys` emitted. */
export interface PolyCredsEnv {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

/** Privy env required to open the HSM-custodied signer. */
export interface PrivyEnv {
  appId: string;
  appSecret: string;
  signingKey: string;
}

export interface CreatePolyTradeCapabilityConfig {
  /** Pino child logger from the container; factory binds component context. */
  logger: Logger;
  /** Polymarket CLOB host. Defaults to `https://clob.polymarket.com`. */
  host?: string | undefined;
  /** The operator EOA (0x…40 hex). Must already be funded + approved on Polygon. */
  operatorWalletAddress?: `0x${string}` | undefined;
  /** CLOB L2 creds; all three required or the capability is not constructed. */
  creds?: PolyCredsEnv | undefined;
  /** Privy env; all three required. */
  privy?: PrivyEnv | undefined;
  /**
   * TEST ONLY — bypasses dynamic CLOB / Privy imports and wraps the supplied
   * `placeOrder` function in the executor. Production bootstrap never sets this.
   */
  placeOrderOverride?:
    | ((intent: OrderIntent) => Promise<OrderReceipt>)
    | undefined;
}

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

// ─────────────────────────────────────────────────────────────────────────────
// Prom-client sinks (shared registry; idempotent across hot reload)
// ─────────────────────────────────────────────────────────────────────────────

/** Stable metric names. Dashboards + Prom recording rules reference these. */
export const POLY_TRADE_METRICS = {
  placeTotal: "poly_trade_place_total",
  placeDurationMs: "poly_trade_place_duration_ms",
} as const;

function getOrCreateCounter<T extends string>(
  name: string,
  help: string,
  labelNames: readonly T[]
): Counter<T> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Counter<T>;
  return new client.Counter({
    name,
    help,
    labelNames: labelNames as T[],
    registers: [metricsRegistry],
  });
}

function getOrCreateHistogram<T extends string>(
  name: string,
  help: string,
  labelNames: readonly T[],
  buckets: number[]
): Histogram<T> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) return existing as Histogram<T>;
  return new client.Histogram({
    name,
    help,
    labelNames: labelNames as T[],
    buckets,
    registers: [metricsRegistry],
  });
}

/** Build a MetricsPort that emits into the app's shared registry. */
function buildMetricsPort(): MetricsPort {
  const placeTotal = getOrCreateCounter(
    POLY_TRADE_METRICS.placeTotal,
    "Polymarket CLOB trade placements issued by the agent-callable tool, by result",
    ["result"] as const
  );
  const placeDurationMs = getOrCreateHistogram(
    POLY_TRADE_METRICS.placeDurationMs,
    "Polymarket CLOB trade placement latency in milliseconds, by result",
    ["result"] as const,
    [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]
  );

  return {
    incr(name, labels) {
      if (name === POLY_TRADE_METRICS.placeTotal) {
        placeTotal.inc(labels ?? {});
      }
    },
    observeDurationMs(name, ms, labels) {
      if (name === POLY_TRADE_METRICS.placeDurationMs) {
        placeDurationMs.observe(labels ?? {}, ms);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LoggerPort ← pino.Logger (child-method signature differs slightly)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Profile URL helper (used on every receipt)
// ─────────────────────────────────────────────────────────────────────────────

function profileUrl(address: string): string {
  return `https://polymarket.com/profile/${address.toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `PolyTradeCapability` if the env has everything needed to place real
 * orders on Polymarket. Returns `undefined` when any required piece is missing —
 * the tool binding then registers the ai-tools stub, which throws a clear error
 * if an agent tries to call the tool on an unconfigured pod.
 *
 * **Sync + lazy-init** (matches `getTemporalWorkflowClient` in container.ts):
 * the factory only checks env presence. The first `placeTrade(...)` call does
 * the dynamic imports + Privy wallet resolution and memoizes the result.
 * Subsequent calls reuse the cached adapter.
 *
 * @public
 */
export function createPolyTradeCapability(
  config: CreatePolyTradeCapabilityConfig
): PolyTradeCapability | undefined {
  // Test / override path — skip all dynamic imports.
  if (config.placeOrderOverride) {
    const metrics = buildMetricsPort();
    const placeOrder = config.placeOrderOverride;
    const operatorAddress =
      config.operatorWalletAddress ??
      ("0x0000000000000000000000000000000000000000" as const);
    const executor = createClobExecutor({
      placeOrder,
      logger: adaptLogger(config.logger),
      metrics,
    });
    return wrapExecutor(executor, operatorAddress);
  }

  if (!config.operatorWalletAddress || !config.creds || !config.privy) {
    config.logger.info(
      {
        event: "poly.trade.capability.unavailable",
        has_operator_wallet: Boolean(config.operatorWalletAddress),
        has_clob_creds: Boolean(config.creds),
        has_privy: Boolean(config.privy),
      },
      "poly-trade capability not constructed: env incomplete"
    );
    return undefined;
  }

  // Capture narrowed values for the closure — control-flow narrowing does not
  // propagate through `async function getExecutor()`.
  const operatorWalletAddress: `0x${string}` = config.operatorWalletAddress;
  const creds: PolyCredsEnv = config.creds;
  const privy: PrivyEnv = config.privy;
  const host = config.host ?? DEFAULT_CLOB_HOST;

  // Lazy-init executor — first call to placeTrade builds the adapter.
  const metrics = buildMetricsPort();
  const loggerPort = adaptLogger(
    config.logger.child({ component: "poly-clob-adapter" })
  );
  let cachedExecutor:
    | ((intent: OrderIntent) => Promise<OrderReceipt>)
    | undefined;
  let initPromise:
    | Promise<(intent: OrderIntent) => Promise<OrderReceipt>>
    | undefined;

  async function getExecutor(): Promise<
    (intent: OrderIntent) => Promise<OrderReceipt>
  > {
    if (cachedExecutor) return cachedExecutor;
    initPromise ??= buildRealExecutor({
      operatorWalletAddress,
      creds,
      privy,
      host,
      logger: config.logger,
      loggerPort,
      metrics,
    });
    cachedExecutor = await initPromise;
    return cachedExecutor;
  }

  return {
    async placeTrade(
      request: PolyPlaceTradeRequest
    ): Promise<PolyPlaceTradeReceipt> {
      if (request.side !== "BUY") {
        throw new Error(
          "poly-trade: SELL orders are out of scope for the prototype (requires CTF setApprovalForAll)."
        );
      }
      const executor = await getExecutor();
      const intent: OrderIntent = {
        provider: "polymarket",
        market_id: `prediction-market:polymarket:${request.conditionId}`,
        outcome: request.outcome,
        side: "BUY",
        size_usdc: request.size_usdc,
        limit_price: request.limit_price,
        client_order_id: request.client_order_id,
        attributes: { token_id: request.tokenId },
      };
      const receipt = await executor(intent);
      return {
        order_id: receipt.order_id,
        client_order_id: receipt.client_order_id,
        status: receipt.status,
        filled_size_usdc: receipt.filled_size_usdc,
        submitted_at: receipt.submitted_at,
        profile_url: profileUrl(operatorWalletAddress),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// First-call init — resolves Privy wallet, builds viem client + adapter
// ─────────────────────────────────────────────────────────────────────────────

interface BuildRealExecutorDeps {
  operatorWalletAddress: `0x${string}`;
  creds: PolyCredsEnv;
  privy: PrivyEnv;
  host: string;
  logger: Logger;
  loggerPort: LoggerPort;
  metrics: MetricsPort;
}

async function buildRealExecutor(
  deps: BuildRealExecutorDeps
): Promise<(intent: OrderIntent) => Promise<OrderReceipt>> {
  // Dynamic imports — keep `@polymarket/clob-client` + `@privy-io/node` out of
  // bundles that don't configure the capability.
  const { PolymarketClobAdapter } = await import(
    "@cogni/market-provider/adapters/polymarket"
  );
  const { PrivyClient } = await import("@privy-io/node");
  const { createViemAccount } = await import("@privy-io/node/viem");
  const { createWalletClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");

  const privyClient = new PrivyClient({
    appId: deps.privy.appId,
    appSecret: deps.privy.appSecret,
  });
  let walletId: string | undefined;
  for await (const wallet of privyClient.wallets().list()) {
    if (
      wallet.address.toLowerCase() === deps.operatorWalletAddress.toLowerCase()
    ) {
      walletId = wallet.id;
      break;
    }
  }
  if (!walletId) {
    throw new Error(
      `[poly-trade] FAIL: Privy has no wallet matching OPERATOR_WALLET_ADDRESS ${deps.operatorWalletAddress}. ` +
        "Verify PRIVY_APP_ID / PRIVY_APP_SECRET and that the EOA was created under this Privy app."
    );
  }

  const account = createViemAccount(privyClient, {
    walletId,
    address: deps.operatorWalletAddress,
    authorizationContext: {
      authorization_private_keys: [deps.privy.signingKey],
    },
  });
  // viem version drift between @privy-io/node/viem peerDep and this app's viem
  // forces a cast; runtime shape matches WalletClient.account exactly.
  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const accountAny: any = account;
  const walletClient = createWalletClient({
    account: accountAny,
    chain: polygon,
    transport: http(),
  });

  // Same cast rationale as above — dual-peerDep viem typing.
  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const signerAny: any = walletClient;
  const adapter = new PolymarketClobAdapter({
    signer: signerAny,
    creds: {
      key: deps.creds.apiKey,
      secret: deps.creds.apiSecret,
      passphrase: deps.creds.passphrase,
    },
    funderAddress: deps.operatorWalletAddress,
    host: deps.host,
    logger: deps.loggerPort,
    metrics: deps.metrics,
  });

  deps.logger.info(
    {
      event: "poly.trade.capability.ready",
      wallet_id: walletId,
      address: deps.operatorWalletAddress,
      host: deps.host,
    },
    "poly-trade capability initialized (first placeTrade call)"
  );

  return createClobExecutor({
    placeOrder: adapter.placeOrder.bind(adapter),
    logger: deps.loggerPort,
    metrics: deps.metrics,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor → PolyTradeCapability shim (override path only; the real/lazy path
// inlines this logic so it doesn't pay for executor resolution twice).
// ─────────────────────────────────────────────────────────────────────────────

function wrapExecutor(
  executor: (intent: OrderIntent) => Promise<OrderReceipt>,
  operatorAddress: `0x${string}`
): PolyTradeCapability {
  return {
    async placeTrade(
      request: PolyPlaceTradeRequest
    ): Promise<PolyPlaceTradeReceipt> {
      if (request.side !== "BUY") {
        throw new Error(
          "poly-trade: SELL orders are out of scope for the prototype (requires CTF setApprovalForAll)."
        );
      }
      const intent: OrderIntent = {
        provider: "polymarket",
        market_id: `prediction-market:polymarket:${request.conditionId}`,
        outcome: request.outcome,
        side: "BUY",
        size_usdc: request.size_usdc,
        limit_price: request.limit_price,
        client_order_id: request.client_order_id,
        attributes: { token_id: request.tokenId },
      };
      const receipt = await executor(intent);
      return {
        order_id: receipt.order_id,
        client_order_id: receipt.client_order_id,
        status: receipt.status,
        filled_size_usdc: receipt.filled_size_usdc,
        submitted_at: receipt.submitted_at,
        profile_url: profileUrl(operatorAddress),
      };
    },
  };
}
