// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/poly-trade`
 * Purpose: Factory for `PolyTradeBundle` — binds the PolymarketClobAdapter (+ Privy signer + pino + prom-client sinks) and exposes BOTH the agent-callable `PolyTradeCapability` AND the raw `placeIntent(OrderIntent) => OrderReceipt` seam. The mirror-coordinator (CP4.3) consumes `placeIntent` with a caller-supplied `client_order_id`; the agent tool consumes `capability.placeTrade`. Both paths share one executor + one lazy adapter + one Privy wallet — zero duplication. Test mode substitutes `FakePolymarketClobAdapter` from `@/adapters/test/`. Sole legal importer of `@polymarket/clob-client` and `@privy-io/node/viem` in this app.
 * Scope: Runtime wiring only. Does not read env directly (server-env supplies strings); does not persist anything; does not place orders itself. Holds the adapter + Privy wallet lifecycle for the process.
 * Invariants:
 *   - ENV_IS_SOLE_SWITCH — production factory branches only on env.isTestMode and env-presence. No per-call test knobs on the public config interface. Matches the `createRepoCapability` / `createMetricsCapability` pattern.
 *   - LAZY_INIT_MATCHES_TEMPORAL — production path is sync to construct; dynamic imports + Privy wallet resolution happen inside `placeTrade` on first call and memoize. Matches `getTemporalWorkflowClient` in container.ts.
 *   - CAPABILITY_FAIL_LOUD — Privy wallet resolution errors throw on first `placeTrade` invocation with a clear message; the capability logs a boot-time `env_ok` positive signal before that point so ops sees "configured" without waiting for the first trade.
 *   - NO_STATIC_CLOB_IMPORT — uses `await import(...)` in production; deployments without CLOB creds never pull in `@polymarket/clob-client`. Enforced additionally by Biome `noRestrictedImports`.
 *   - PROM_REGISTRY_SHARED — counters + histograms register on the app's singleton registry with idempotent get-or-create helpers; no duplicate-registration errors across HMR / test boots.
 *   - BUY_ONLY — the capability rejects SELL until CTF setApprovalForAll is wired (out of prototype scope).
 *   - KEY_NEVER_IN_APP — CLOB L2 creds + Privy signing key stay in env; the adapter holds them in-memory only for the lifetime of the process.
 *   - HARDCODED_WALLET_SECRETS_OK — per task.0315 prototype constraint, the env → single-operator Privy-wallet resolution block is the ONE place where non-multi-tenant wiring is allowed. Every other branch (test fake; tool invocation; executor wrap) is production-generic.
 * Side-effects: none on factory call; on first `placeTrade` invocation: Privy wallet list pagination to resolve `operatorWalletAddress`, then HTTPS to Polymarket CLOB on each subsequent call.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.25)
 * @internal
 */

import type {
  PolyListOpenOrdersRequest,
  PolyOpenOrder,
  PolyPlaceTradeReceipt,
  PolyPlaceTradeRequest,
  PolyTradeCapability,
} from "@cogni/ai-tools";
import {
  clientOrderIdFor,
  type LoggerPort,
  type MetricsPort,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/market-provider";
import { EVENT_NAMES } from "@cogni/node-shared";
import type { Counter, Histogram } from "prom-client";
import client from "prom-client";

import { FakePolymarketClobAdapter } from "@/adapters/test";
import { createClobExecutor } from "@/features/trading/clob-executor";
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
  /**
   * `env.APP_ENV === 'test'` — when true, the factory returns a capability
   * backed by `FakePolymarketClobAdapter` from `@/adapters/test/`. Matches
   * the `createRepoCapability` / `createMetricsCapability` convention.
   */
  isTestMode: boolean;
  /** Polymarket CLOB host. Defaults to `https://clob.polymarket.com`. */
  host?: string | undefined;
  /** The operator EOA (0x…40 hex). Must already be funded + approved on Polygon. */
  operatorWalletAddress?: `0x${string}` | undefined;
  /** CLOB L2 creds; all three required or the capability is not constructed. */
  creds?: PolyCredsEnv | undefined;
  /** Privy env; all three required. */
  privy?: PrivyEnv | undefined;
}

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

/** Placeholder address used in test mode so receipts carry a stable profile URL. */
const TEST_MODE_OPERATOR_ADDRESS =
  "0x1111111111111111111111111111111111111111" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Prom-client sinks (shared registry; idempotent across hot reload)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default histogram buckets for CLOB placement latency (ms). Covers local
 * sub-100ms happy paths all the way to 30s worst-case network failures.
 */
const DEFAULT_DURATION_BUCKETS_MS = [
  50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
];

/**
 * Generic, lazy, registry-backed MetricsPort shim.
 *
 * Why generic: this capability wraps TWO emitters — the CP4.2 executor
 * (`poly_copy_trade_execute_{total,duration_ms}`) and the PR #890 adapter
 * (`poly_clob_{place,cancel,get_order}_{total,duration_ms}`). Hard-coding any
 * subset in the shim silently drops the rest. Lazy per-name creation avoids
 * that and accepts any future emitter without code changes.
 *
 * `getSingleMetric(name) ?? new client.Counter/Histogram(...)` keeps the
 * shim safe across HMR / test boots that re-enter the factory.
 */
function buildMetricsPort(): MetricsPort {
  const counters = new Map<string, Counter<string>>();
  const histograms = new Map<string, Histogram<string>>();

  function getCounter(
    name: string,
    labels: Record<string, string> | undefined
  ): Counter<string> {
    const cached = counters.get(name);
    if (cached) return cached;
    const existing = metricsRegistry.getSingleMetric(name);
    if (existing) {
      const hit = existing as Counter<string>;
      counters.set(name, hit);
      return hit;
    }
    const created = new client.Counter({
      name,
      help: `${name} — emitted via PolyTradeCapability`,
      labelNames: Object.keys(labels ?? {}),
      registers: [metricsRegistry],
    });
    counters.set(name, created);
    return created;
  }

  function getHistogram(
    name: string,
    labels: Record<string, string> | undefined
  ): Histogram<string> {
    const cached = histograms.get(name);
    if (cached) return cached;
    const existing = metricsRegistry.getSingleMetric(name);
    if (existing) {
      const hit = existing as Histogram<string>;
      histograms.set(name, hit);
      return hit;
    }
    const created = new client.Histogram({
      name,
      help: `${name} — emitted via PolyTradeCapability`,
      labelNames: Object.keys(labels ?? {}),
      buckets: DEFAULT_DURATION_BUCKETS_MS,
      registers: [metricsRegistry],
    });
    histograms.set(name, created);
    return created;
  }

  return {
    incr(name, labels) {
      getCounter(name, labels).inc(labels ?? {});
    },
    observeDurationMs(name, ms, labels) {
      getHistogram(name, labels).observe(labels ?? {}, ms);
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
// Profile URL helper
// ─────────────────────────────────────────────────────────────────────────────

function profileUrl(address: string): string {
  return `https://polymarket.com/profile/${address.toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure composition — adapter-agnostic capability builder
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFromAdapterDeps {
  /** `MarketProviderPort.placeOrder` — production adapter OR `FakePolymarketClobAdapter`. */
  placeOrder: (intent: OrderIntent) => Promise<OrderReceipt>;
  /** `listOpenOrders` — production adapter OR fake. */
  listOpenOrders: (params?: {
    tokenId?: string;
    market?: string;
  }) => Promise<OrderReceipt[]>;
  /** `cancelOrder(orderId)` — production adapter OR fake. */
  cancelOrder: (orderId: string) => Promise<void>;
  /** Operator EOA (used for the receipt's profile_url). */
  operatorWalletAddress: `0x${string}`;
  /** Pino logger (factory wraps in a LoggerPort + adds executor child). */
  logger: Logger;
  /** Optional shared metrics shim; factory builds one if omitted. */
  metrics?: MetricsPort;
}

/**
 * Bundle returned by the factory. Holds both placement surfaces + shared state:
 *
 * - `capability` — agent-callable `PolyTradeCapability` (place/list/cancel).
 *   Generates its own `client_order_id` via `clientOrderIdFor("agent", …)`.
 * - `placeIntent` — raw `(OrderIntent) => OrderReceipt` seam for callers that
 *   supply their own `client_order_id` (the mirror-coordinator uses
 *   `clientOrderIdFor(target_id, fill_id)` so the ledger composite PK dedupes).
 * - `operatorWalletAddress` — exposed for read APIs (e.g. balance).
 *
 * Both surfaces wrap the SAME executor + the SAME lazy adapter, so there is
 * exactly one Privy wallet init, one `@polymarket/clob-client` load, and one
 * prom-client registry across agent + autonomous paths.
 */
export interface PolyTradeBundle {
  capability: PolyTradeCapability;
  placeIntent: (intent: OrderIntent) => Promise<OrderReceipt>;
  operatorWalletAddress: `0x${string}`;
}

/**
 * Pure composition: wrap any `placeOrder` function in the CP4.2 executor
 * (structured logs + bounded-label metrics) and return a `PolyTradeBundle`
 * that exposes both the agent-tool surface and the raw `placeIntent` seam.
 *
 * `capability.placeTrade` generates `client_order_id` via `clientOrderIdFor`;
 * `placeIntent` does not — callers pass a full `OrderIntent` with the id
 * already computed. Every placement path must produce compatible keys so the
 * composite PK on `poly_copy_trade_fills` dedupes correctly (CP3.3 invariant).
 *
 * Called from BOTH the production path (real Polymarket adapter) and the test
 * path (`FakePolymarketClobAdapter`). No environment awareness; env branching
 * lives in `createPolyTradeCapability`.
 *
 * @public
 */
export function createPolyTradeCapabilityFromAdapter(
  deps: CreateFromAdapterDeps
): PolyTradeBundle {
  const metrics = deps.metrics ?? buildMetricsPort();
  // No `component` binding here — the real adapter binds
  // `component: "poly-clob-adapter"` in its own constructor (PR #890). The
  // CP4.2 executor adds `subcomponent: "copy-trade-executor"` on top. In
  // test mode, the fake adapter doesn't bind a component, so executor log
  // lines correctly appear without the misleading adapter label.
  const loggerPort = adaptLogger(deps.logger);
  const executor = createClobExecutor({
    placeOrder: deps.placeOrder,
    logger: loggerPort,
    metrics,
  });
  const operatorAddress = deps.operatorWalletAddress;

  const capability: PolyTradeCapability = {
    async placeTrade(
      request: PolyPlaceTradeRequest
    ): Promise<PolyPlaceTradeReceipt> {
      if (request.side !== "BUY") {
        throw new Error(
          "poly-trade: SELL orders are out of scope for the prototype (requires CTF setApprovalForAll)."
        );
      }
      // `target_id="agent"` marks the placement as tool-initiated. The mirror-
      // coordinator (CP4.3) calls `placeIntent` directly with a caller-supplied
      // `client_order_id` = `clientOrderIdFor(target_id, fill_id)`, so the two
      // paths share the pinned hash function without colliding.
      const client_order_id = clientOrderIdFor(
        "agent",
        `${request.tokenId}:${Date.now()}`
      );
      const intent: OrderIntent = {
        provider: "polymarket",
        market_id: `prediction-market:polymarket:${request.conditionId}`,
        outcome: request.outcome,
        side: "BUY",
        size_usdc: request.size_usdc,
        limit_price: request.limit_price,
        client_order_id,
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
    async listOpenOrders(
      request?: PolyListOpenOrdersRequest
    ): Promise<PolyOpenOrder[]> {
      const params: { tokenId?: string; market?: string } = {};
      if (request?.token_id) params.tokenId = request.token_id;
      if (request?.market) params.market = request.market;
      const receipts = await deps.listOpenOrders(
        Object.keys(params).length > 0 ? params : undefined
      );
      return receipts.map(receiptToPolyOpenOrder);
    },
    async cancelOrder(orderId: string): Promise<void> {
      await deps.cancelOrder(orderId);
    },
  };

  return {
    capability,
    placeIntent: executor,
    operatorWalletAddress: operatorAddress,
  };
}

function receiptToPolyOpenOrder(r: OrderReceipt): PolyOpenOrder {
  const attrs = r.attributes ?? {};
  const readStr = (k: string): string | undefined => {
    const v = attrs[k];
    return typeof v === "string" ? v : undefined;
  };
  const readNum = (k: string): number | undefined => {
    const v = attrs[k];
    return typeof v === "number" ? v : undefined;
  };
  const priceStr = readStr("price");
  const originalSizeStr = readStr("originalSize");
  const sizeMatchedStr = readStr("sizeMatched");
  const sideStr = (readStr("side") ?? "BUY").toUpperCase();
  const side: PolyOpenOrder["side"] = sideStr === "SELL" ? "SELL" : "BUY";
  return {
    order_id: r.order_id,
    status: r.status,
    side,
    market: readStr("market") ?? "",
    token_id: readStr("tokenId") ?? "",
    outcome: readStr("outcome") ?? "",
    price: priceStr ? Number(priceStr) : 0,
    original_size_shares: originalSizeStr ? Number(originalSizeStr) : 0,
    filled_size_shares: sizeMatchedStr ? Number(sizeMatchedStr) : 0,
    created_at: readNum("createdAt") ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Production entry — env-driven. THE ONE allowed hardcoding for wallet
// secrets lives below in `buildRealPlaceOrder`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `PolyTradeBundle` from environment. Three outcomes:
 *
 * - **`env.isTestMode === true`** → bundle backed by `FakePolymarketClobAdapter`.
 *   No dynamic imports, no network, no Privy.
 * - **Env incomplete** (missing `operatorWalletAddress` / `creds` / `privy`) → returns
 *   `undefined`. The tool binding installs the ai-tools stub which throws a clear
 *   error if an agent tries to place on an unconfigured pod. The mirror-coordinator
 *   boot path likewise declines to start the 30s poll when the bundle is undefined.
 * - **Env complete** → returns a bundle that lazily resolves the Privy wallet +
 *   builds the real `PolymarketClobAdapter` on the first call to either
 *   `capability.placeTrade` or `placeIntent` (whichever fires first — both share
 *   the cached adapter). Matches `getTemporalWorkflowClient` — sync factory,
 *   async first-call init.
 *
 * @public
 */
export function createPolyTradeCapability(
  config: CreatePolyTradeCapabilityConfig
): PolyTradeBundle | undefined {
  // Test mode — canonical fake from @/adapters/test/. No env-decoding required;
  // matches createRepoCapability(env.isTestMode → FakeRepoAdapter) pattern.
  if (config.isTestMode) {
    const fake = new FakePolymarketClobAdapter();
    const operator = config.operatorWalletAddress ?? TEST_MODE_OPERATOR_ADDRESS;
    config.logger.info(
      {
        event: EVENT_NAMES.POLY_TRADE_CAPABILITY_TEST_MODE,
        operator_wallet_address: operator,
      },
      "poly-trade capability wired to FakePolymarketClobAdapter (APP_ENV=test)"
    );
    return createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      operatorWalletAddress: operator,
      logger: config.logger,
    });
  }

  if (!config.operatorWalletAddress || !config.creds || !config.privy) {
    config.logger.info(
      {
        event: EVENT_NAMES.POLY_TRADE_CAPABILITY_UNAVAILABLE,
        has_operator_wallet: Boolean(config.operatorWalletAddress),
        has_clob_creds: Boolean(config.creds),
        has_privy: Boolean(config.privy),
      },
      "poly-trade capability not constructed: env incomplete"
    );
    return undefined;
  }

  // Capture narrowed values for the closure — control-flow narrowing does not
  // propagate through the `async` placeOrder builder below.
  const operatorWalletAddress: `0x${string}` = config.operatorWalletAddress;
  const creds: PolyCredsEnv = config.creds;
  const privy: PrivyEnv = config.privy;
  const host = config.host ?? DEFAULT_CLOB_HOST;

  // Boot-time positive signal — env shape is valid and the capability WILL be
  // constructed on first invocation. Ops can alert on the absence of this
  // line on trader pods without waiting for the first agent-initiated trade.
  config.logger.info(
    {
      event: EVENT_NAMES.POLY_TRADE_CAPABILITY_ENV_OK,
      operator_wallet_address: operatorWalletAddress,
      host,
    },
    "poly-trade capability env validated (adapter + Privy wallet will init on first placeTrade)"
  );

  // Single MetricsPort shared by the executor + adapter — both write to the
  // same prom-client registry, so one shim is sufficient and avoids a second
  // in-memory cache.
  const metrics = buildMetricsPort();

  // Lazy-init: wrap a deferred builder so we don't pull in @polymarket/clob-client
  // until someone actually calls the capability.
  type AdapterMethods = {
    placeOrder: (intent: OrderIntent) => Promise<OrderReceipt>;
    listOpenOrders: (params?: {
      tokenId?: string;
      market?: string;
    }) => Promise<OrderReceipt[]>;
    cancelOrder: (orderId: string) => Promise<void>;
  };
  let cached: AdapterMethods | undefined;
  let initPromise: Promise<AdapterMethods> | undefined;

  async function ensureMethods(): Promise<AdapterMethods> {
    if (cached) return cached;
    initPromise ??= buildRealAdapterMethods({
      operatorWalletAddress,
      creds,
      privy,
      host,
      logger: config.logger,
      metrics,
    });
    cached = await initPromise;
    return cached;
  }

  async function lazyPlaceOrder(intent: OrderIntent): Promise<OrderReceipt> {
    const m = await ensureMethods();
    return m.placeOrder(intent);
  }
  async function lazyListOpenOrders(params?: {
    tokenId?: string;
    market?: string;
  }): Promise<OrderReceipt[]> {
    const m = await ensureMethods();
    return m.listOpenOrders(params);
  }
  async function lazyCancelOrder(orderId: string): Promise<void> {
    const m = await ensureMethods();
    return m.cancelOrder(orderId);
  }

  return createPolyTradeCapabilityFromAdapter({
    placeOrder: lazyPlaceOrder,
    listOpenOrders: lazyListOpenOrders,
    cancelOrder: lazyCancelOrder,
    operatorWalletAddress,
    logger: config.logger,
    metrics,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE allowed hardcoding — single-operator Privy wallet resolution.
// Everything below constructs the real PolymarketClobAdapter from env-resolved
// secrets. Per task.0315 prototype constraint, this is intentionally
// single-tenant; multi-operator support is P2 (task.0318).
// ─────────────────────────────────────────────────────────────────────────────

interface BuildRealAdapterMethodsDeps {
  operatorWalletAddress: `0x${string}`;
  creds: PolyCredsEnv;
  privy: PrivyEnv;
  host: string;
  logger: Logger;
  /** Shared metrics shim — same instance the executor uses. */
  metrics: MetricsPort;
}

async function buildRealAdapterMethods(
  deps: BuildRealAdapterMethodsDeps
): Promise<{
  placeOrder: (intent: OrderIntent) => Promise<OrderReceipt>;
  listOpenOrders: (params?: {
    tokenId?: string;
    market?: string;
  }) => Promise<OrderReceipt[]>;
  cancelOrder: (orderId: string) => Promise<void>;
}> {
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
      `[poly-trade] FAIL: Privy has no wallet matching POLY_PROTO_WALLET_ADDRESS ${deps.operatorWalletAddress}. ` +
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

  // Adapter uses the SAME MetricsPort the executor uses (passed in via deps)
  // so there's one Prom-shim cache per capability, not two. Adapter binds its
  // own `component: "poly-clob-adapter"` in its constructor; the logger passed
  // in here stays component-free so the outer executor-side binding doesn't
  // collide.
  const loggerForAdapter = adaptLogger(deps.logger);
  const adapter = new PolymarketClobAdapter({
    signer: signerAny,
    creds: {
      key: deps.creds.apiKey,
      secret: deps.creds.apiSecret,
      passphrase: deps.creds.passphrase,
    },
    funderAddress: deps.operatorWalletAddress,
    host: deps.host,
    logger: loggerForAdapter,
    metrics: deps.metrics,
  });

  deps.logger.info(
    {
      event: EVENT_NAMES.POLY_TRADE_CAPABILITY_READY,
      wallet_id: walletId,
      address: deps.operatorWalletAddress,
      host: deps.host,
    },
    "poly-trade capability initialized (first placeTrade call)"
  );

  return {
    placeOrder: adapter.placeOrder.bind(adapter),
    listOpenOrders: adapter.listOpenOrders.bind(adapter),
    cancelOrder: adapter.cancelOrder.bind(adapter),
  };
}
