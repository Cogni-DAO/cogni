// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/poly-trade-executor`
 * Purpose: Per-tenant Polymarket trade executor. Given a `billingAccountId`,
 *   returns a `PolyTradeExecutor` with `placeIntent` / `closePosition` /
 *   `exitPosition` / `redeemResolvedPosition` / `listPositions` methods.
 *   Entry and mirror-placement flows route through
 *   `PolyTraderWalletPort.authorizeIntent` before signing — so scope + cap +
 *   grant-revoke checks run on the hot path. User-initiated exits/redeems are
 *   authorized by active tenant connection instead of grant caps so users can
 *   always unwind their own positions. Caches the per-tenant
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
 *   - REDEEM_PRECHECK_ON_CHAIN — both manual `redeemResolvedPosition` and the
 *     autonomous sweep gate `redeemPositions` on `decideRedeem`: balance>0
 *     AND payoutNumerator>0. Data-API `redeemable` is enumeration-only.
 *     See bug.0376 (chain-truth predicate) and bug.0383 (winning-outcome gate).
 *   - REDEEM_RACE_GUARDS — bug.0384: (1) module-scope `sweepInFlight` mutex
 *     blocks inter-tick sweep overlap; (2) module-scope
 *     `redeemCooldownByConditionId` 60s cooldown blocks manual ↔ sweep
 *     races and double-clicks on the manual route. Both load-bearing for
 *     different scenarios — see code docs at `REDEEM_COOLDOWN_MS` /
 *     `sweepInFlight` for justification. Sweep wall-clock duration is
 *     emitted on every completion (`poly.ctf.redeem.sweep_completed`) so
 *     the next race-class issue is visible in Loki within the hour.
 *   - SINGLE_POD_ASSUMPTION — the cooldown Map and mutex are in-process.
 *     Scaling poly to >1 replica reintroduces the race; the deployment
 *     must stay single-replica until task.0377 (event-driven sweep via
 *     CTF `ConditionResolution` + own `PayoutRedemption` event subscription)
 *     replaces this polling architecture entirely. **bug.0384 is a
 *     band-aid; task.0377 is the real fix.**
 * Side-effects: on first `placeIntent` for a new tenant: HTTPS to
 *   Polymarket CLOB + Privy API. Subsequent calls reuse cached clients. Sweep
 *   path additionally issues one `eth_call` (multicall) per tick.
 * Links: work/items/task.0318 (Phase B3), work/items/bug.0376,
 *   docs/spec/poly-trader-wallet-port.md
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
import {
  decideRedeem,
  type RedeemSkipReason as PolicyRedeemSkipReason,
  type RedeemDecision,
  type RedeemMalformedReason,
} from "@cogni/market-provider/policy";
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

/** User-initiated full exit of the current wallet position. */
export interface ExitPositionParams {
  /** ERC-1155 asset id (Polymarket token). */
  tokenId: string;
  /** Caller-supplied idempotency key. */
  client_order_id: `0x${string}`;
}

export interface OpenOrderSummary {
  orderId: string;
  marketId: string | null;
  tokenId: string | null;
  outcome: string | null;
  side: "BUY" | "SELL" | null;
  price: number | null;
  originalShares: number | null;
  matchedShares: number | null;
  remainingUsdc: number | null;
  submittedAt: string;
  status: string;
}

/** Thrown when close/redeem preconditions fail or chain tx fails. */
export class PolyTradeExecutorError extends Error {
  constructor(
    public readonly code:
      | "no_position_to_close"
      | "not_authorized"
      | "not_redeemable"
      | "redeem_failed",
    message: string,
    public readonly reason?: string
  ) {
    super(message);
    this.name = "PolyTradeExecutorError";
  }
}

/** Single-market CTF redeem after Polymarket resolution (not CLOB). */
export interface RedeemResolvedParams {
  /** Polymarket condition id (`0x` + 64 hex). */
  condition_id: string;
}

/**
 * Refusal codes attached to `PolyTradeExecutorError.reason`. Combines:
 *   - policy skip reasons (recoverable; from `@cogni/market-provider/policy`)
 *   - policy malformed reasons (design defect; same source)
 *   - executor-local cooldown signal (`pending_redeem`)
 *   - input-shape errors not covered by the policy (`missing_outcome_index`
 *     when the Data-API position lacks an `outcomeIndex`)
 *
 * Kept as a single union so existing callers / tests can continue to pattern-
 * match on `error.reason` without learning a second type.
 */
export type RedeemSkipReason =
  | PolicyRedeemSkipReason
  | RedeemMalformedReason
  | "pending_redeem"
  | "missing_outcome_index";

/**
 * bug.0384 — per-condition in-process cooldown.
 *
 * Why this AND the sweep mutex? They cover different races:
 *   - Mutex: catches inter-tick sweep overlap (tick B starts before tick A
 *     finishes its serial per-candidate await). This is the prod-observed
 *     case from 2026-04-26 (82 txs / 3 payouts after 1 POL refund).
 *   - Cooldown: catches manual ↔ sweep races and double-clicks on
 *     /api/v1/poly/wallet/positions/redeem. Mutex doesn't help these
 *     because the manual route doesn't take the sweep mutex.
 *
 * Window rationale (60s = REDEEM_COOLDOWN_MS):
 *   Polygon block time 2s, probabilistic finality ~3-5 blocks (~10s),
 *   Alchemy RPC propagation lag adds a few seconds → mined-and-readable
 *   ≈ 15-30s end-to-end. 60s is a 2× safety margin without being so long
 *   that a legitimate retry-after-failure stalls.
 *
 * Map is module-scope so all tenant executors in this process share one
 * cooldown table. SINGLE_POD_ASSUMPTION: this and the mutex below break
 * the moment the poly node scales to >1 replica. Multi-pod idempotency
 * (Redis SETNX, on-chain event-driven sweep) tracked in task.0377 +
 * task.0379. Until then, the deployment must stay single-replica.
 */
const REDEEM_COOLDOWN_MS = 60_000;
const redeemCooldownByConditionId = new Map<string, number>();

/** Test-only: clear the cooldown table (used by unit tests). @internal */
export function _resetRedeemCooldownForTests(): void {
  redeemCooldownByConditionId.clear();
}

/** Returns ms remaining until cooldown expires, or 0 if not pending. */
function pendingRedeemMsRemaining(conditionIdHex: string): number {
  const expiry = redeemCooldownByConditionId.get(conditionIdHex);
  if (expiry === undefined) return 0;
  const remaining = expiry - Date.now();
  if (remaining <= 0) {
    redeemCooldownByConditionId.delete(conditionIdHex);
    return 0;
  }
  return remaining;
}

/** Mark a condition as pending redeem; called immediately after `writeContract`. */
function markRedeemPending(conditionIdHex: string): void {
  redeemCooldownByConditionId.set(
    conditionIdHex,
    Date.now() + REDEEM_COOLDOWN_MS
  );
}

/**
 * bug.0384 — sweep-level mutex. `redeemAllRedeemableResolvedPositions`
 * iterates candidates with `await redeemResolvedPosition(...)`, which itself
 * awaits `waitForTransactionReceipt`. With N winners, total sweep wall-clock
 * = N × (writeContract + receipt wait) ≈ 5-30s per condition. mirror-pipeline
 * ticks every ~30s. With even 2 winners under load, ticks overlap.
 *
 * Without this mutex: tick B starts mid-tick-A, multicall reads all balances
 * pre-burn (tick A still on candidate 1), predicate passes for candidates
 * 2..N (cooldown only set on candidate 1), tick B fires writes that race
 * tick A's still-pending writes. Cooldown alone can't prevent this because
 * cooldown for candidates 2..N hasn't been set yet.
 *
 * SINGLE_POD_ASSUMPTION applies (see cooldown doc above).
 */
let sweepInFlight = false;

/** Test-only: clear the mutex (used by unit tests). @internal */
export function _resetSweepMutexForTests(): void {
  sweepInFlight = false;
}

function errMsg(
  r: { status: "success" } | { status: "failure"; error: unknown } | undefined
): string | null {
  if (!r) return "missing";
  if (r.status === "success") return null;
  return r.error instanceof Error ? r.error.message : String(r.error);
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
  /**
   * User-facing full exit path. Sells the wallet's entire share balance for
   * the token via a market FOK order and bypasses grant caps so users can
   * always unwind exposure.
   */
  exitPosition: (params: ExitPositionParams) => Promise<OrderReceipt>;
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
  /** Per-tenant live open orders from the CLOB. */
  listOpenOrders: () => Promise<OpenOrderSummary[]>;
  /**
   * Redeem winning outcome tokens for USDC.e via Conditional Tokens `redeemPositions`
   * after the market is resolved (Data API `redeemable: true`). Requires only
   * an active tenant wallet connection; grant caps never block redemptions.
   */
  redeemResolvedPosition: (
    params: RedeemResolvedParams
  ) => Promise<{ tx_hash: `0x${string}` }>;
  /**
   * Sweep all Data-API positions with `redeemable: true` for this wallet (dedupes by condition id).
   */
  redeemAllRedeemableResolvedPositions: () => Promise<
    Array<{ condition_id: string; tx_hash: `0x${string}` }>
  >;
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

type MarketExitAdapter = {
  sellPositionAtMarket: (params: {
    tokenId: string;
    shares: number;
    client_order_id: `0x${string}`;
    orderType?: "FOK" | "FAK";
  }) => Promise<OrderReceipt>;
};

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

  const {
    // BINARY_REDEEM_INDEX_SETS / PARENT_COLLECTION_ID_ZERO are no longer
    // imported here — `decideRedeem` (Capability A) emits the correct
    // `indexSet` and `parentCollectionId` per market topology. The constants
    // stay in `@cogni/market-provider/adapters/polymarket` for now; task.0388
    // removes them when the legacy sweep dies.
    normalizePolygonConditionId,
    POLYGON_CONDITIONAL_TOKENS,
    POLYGON_USDC_E,
    PolymarketClobAdapter,
    PolymarketDataApiClient,
    polymarketCtfRedeemAbi,
  } = await import("@cogni/market-provider/adapters/polymarket");
  const { createPublicClient, createWalletClient, http, parseAbi } =
    await import("viem");
  const { polygon } = await import("viem/chains");

  // Capability A precheck reads (task.0387). Four reads per candidate:
  //   - balanceOf — funder still holds shares?
  //   - payoutNumerators — did our slot win?
  //   - payoutDenominator — is the market actually resolved on-chain?
  //     (zero ⇒ Polymarket Data-API may say `redeemable:true` while CTF has
  //      not yet recorded a resolution; do not fire — bug.0383/bug.0384 class.)
  //   - getOutcomeSlotCount — needed by `decideRedeem` to validate
  //     `outcomeIndex` and pick the multi-outcome index-set when slotCount > 2.
  const ctfPrecheckAbi = parseAbi([
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function payoutNumerators(bytes32 conditionId, uint256 outcomeIndex) view returns (uint256)",
    "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
    "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
  ]);

  // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
  const accountAny: any = resolved.account;
  const walletClient = createWalletClient({
    account: accountAny,
    chain: polygon,
    transport: http(deps.polygonRpcUrl),
  });
  const publicClient = createPublicClient({
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
    const limit_price =
      params.limit_price ?? Math.max(0.01, position.curPrice - 0.01);
    const positionValueUsdcAtLimit = position.size * limit_price;
    const effective_size_usdc = Math.min(
      params.max_size_usdc,
      positionValueUsdcAtLimit
    );
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

  async function authorizeWalletExit(params: {
    action: "close" | "redeem";
    requireTradingReady: boolean;
  }): Promise<void> {
    const connection =
      await deps.walletPort.getConnectionSummary(billingAccountId);
    if (!connection) {
      deps.logger.warn(
        {
          event: "poly.trade.executor.exit_denied",
          billing_account_id: billingAccountId,
          action: params.action,
          reason: "no_connection",
        },
        "poly-trade-executor: exit denied; no active tenant wallet connection"
      );
      throw new PolyTradeExecutorError(
        "not_authorized",
        `poly-trade-executor: ${params.action} denied (no_connection)`,
        "no_connection"
      );
    }
    if (params.requireTradingReady && !connection.tradingApprovalsReadyAt) {
      try {
        const ready =
          await deps.walletPort.ensureTradingApprovals(billingAccountId);
        if (ready.ready) return;
      } catch (err) {
        deps.logger.warn(
          {
            event: "poly.trade.executor.exit_denied",
            billing_account_id: billingAccountId,
            action: params.action,
            reason: "trading_not_ready",
            err: err instanceof Error ? err.message : String(err),
          },
          "poly-trade-executor: exit denied; trading approvals bootstrap failed"
        );
        throw new PolyTradeExecutorError(
          "not_authorized",
          `poly-trade-executor: ${params.action} denied (trading_not_ready)`,
          "trading_not_ready"
        );
      }
      deps.logger.warn(
        {
          event: "poly.trade.executor.exit_denied",
          billing_account_id: billingAccountId,
          action: params.action,
          reason: "trading_not_ready",
        },
        "poly-trade-executor: exit denied; trading approvals not ready"
      );
      throw new PolyTradeExecutorError(
        "not_authorized",
        `poly-trade-executor: ${params.action} denied (trading_not_ready)`,
        "trading_not_ready"
      );
    }
  }

  async function exitPosition(
    params: ExitPositionParams
  ): Promise<OrderReceipt> {
    await authorizeWalletExit({
      action: "close",
      requireTradingReady: true,
    });

    const marketExitAdapter = adapter as typeof adapter & MarketExitAdapter;
    let totalFilledUsdc = 0;
    let lastReceipt: OrderReceipt | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const positions = await dataApiClient.listUserPositions(funderAddress);
      const position = positions.find((p) => p.asset === params.tokenId);
      if (!position || position.size <= 0) {
        if (!lastReceipt) {
          throw new PolyTradeExecutorError(
            "no_position_to_close",
            `poly-trade-executor: no open position for tokenId=${params.tokenId} on wallet=${funderAddress}`
          );
        }
        return {
          ...lastReceipt,
          filled_size_usdc: totalFilledUsdc,
        };
      }

      deps.logger.info(
        {
          event: "poly.exit.place.tenant",
          billing_account_id: billingAccountId,
          token_id: params.tokenId,
          shares: position.size,
          client_order_id: params.client_order_id,
          attempt: attempt + 1,
        },
        "poly-trade-executor: market exit authorized → placeOrder"
      );

      const receipt = await marketExitAdapter.sellPositionAtMarket({
        tokenId: params.tokenId,
        shares: position.size,
        client_order_id: params.client_order_id,
        orderType: "FAK",
      });
      totalFilledUsdc += receipt.filled_size_usdc;
      lastReceipt = receipt;

      const refreshedPositions =
        await dataApiClient.listUserPositions(funderAddress);
      const remaining = refreshedPositions.find(
        (p) => p.asset === params.tokenId
      );
      if (!remaining || remaining.size <= 0) {
        return {
          ...receipt,
          filled_size_usdc: totalFilledUsdc,
        };
      }
      if (remaining.size >= position.size) {
      }
    }

    throw new Error(
      `poly-trade-executor: market exit incomplete after retries for tokenId=${params.tokenId}`
    );
  }

  async function redeemResolvedPosition(
    params: RedeemResolvedParams
  ): Promise<{ tx_hash: `0x${string}` }> {
    let normalized: `0x${string}`;
    try {
      normalized = normalizePolygonConditionId(params.condition_id);
    } catch {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: invalid condition_id=${params.condition_id}`
      );
    }

    const positions = await dataApiClient.listUserPositions(funderAddress);
    const match = positions.find((p) => {
      try {
        return (
          normalizePolygonConditionId(p.conditionId) === normalized &&
          p.redeemable
        );
      } catch {
        return false;
      }
    });

    if (!match) {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: no redeemable position for conditionId=${params.condition_id}`
      );
    }

    // bug.0384 cooldown gate: refuse if a redeem is already in flight for
    // this conditionId. Defeats double-click on the dashboard and any
    // sweep-vs-manual race window.
    const pendingMs = pendingRedeemMsRemaining(normalized);
    if (pendingMs > 0) {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: redeem already pending for conditionId=${params.condition_id} (${pendingMs}ms remaining)`,
        "pending_redeem"
      );
    }

    // bug.0383 precheck: balance > 0 AND payoutNumerator > 0. CTF
    // `redeemPositions` succeeds-with-payout=0 on losers; gate before signing.
    let positionId: bigint;
    try {
      if (!match.asset) throw new Error("missing asset");
      positionId = BigInt(match.asset);
    } catch {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: invalid asset positionId for conditionId=${params.condition_id}`
      );
    }
    if (match.outcomeIndex == null) {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: Data-API position missing outcomeIndex for conditionId=${params.condition_id}`,
        "missing_outcome_index"
      );
    }
    const reads = await publicClient.multicall({
      contracts: [
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "balanceOf" as const,
          args: [funderAddress as `0x${string}`, positionId] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "payoutNumerators" as const,
          args: [normalized, BigInt(match.outcomeIndex)] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "payoutDenominator" as const,
          args: [normalized] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "getOutcomeSlotCount" as const,
          args: [normalized] as const,
        },
      ],
      allowFailure: true,
    });
    const decision: RedeemDecision = decideRedeem({
      balance:
        reads[0]?.status === "success" ? (reads[0].result as bigint) : null,
      payoutNumerator:
        reads[1]?.status === "success" ? (reads[1].result as bigint) : null,
      payoutDenominator:
        reads[2]?.status === "success" ? (reads[2].result as bigint) : null,
      outcomeIndex: match.outcomeIndex,
      outcomeSlotCount:
        reads[3]?.status === "success"
          ? Number(reads[3].result as bigint)
          : null,
      negativeRisk: match.negativeRisk ?? false,
    });
    deps.logger.info(
      {
        event: "poly.ctf.redeem.policy_decision",
        billing_account_id: billingAccountId,
        condition_id: params.condition_id,
        funder: funderAddress,
        outcome_index: match.outcomeIndex,
        negative_risk: match.negativeRisk ?? false,
        policy_decision:
          decision.kind === "redeem"
            ? { kind: "redeem", flavor: decision.flavor }
            : { kind: decision.kind, reason: decision.reason },
      },
      "poly-trade-executor: redeem policy decision"
    );
    if (decision.kind === "skip") {
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: precheck refused redeem conditionId=${params.condition_id} reason=${decision.reason}`,
        decision.reason
      );
    }
    if (decision.kind === "malformed") {
      // bug.0384 class — design defect, not a recoverable skip. Caller must
      // investigate the fixture corpus + code, not retry. See
      // docs/design/poly-positions.md § Abandoned-position runbook (Class A).
      deps.metrics.incr("poly_ctf_redeem_total", {
        result: "malformed",
        reason: decision.reason,
      });
      throw new PolyTradeExecutorError(
        "not_redeemable",
        `poly-trade-executor: malformed redeem inputs conditionId=${params.condition_id} reason=${decision.reason}`,
        decision.reason
      );
    }

    await authorizeWalletExit({
      action: "redeem",
      requireTradingReady: false,
    });

    try {
      const hash = await walletClient.writeContract({
        address: POLYGON_CONDITIONAL_TOKENS,
        abi: polymarketCtfRedeemAbi,
        functionName: "redeemPositions",
        args: [
          POLYGON_USDC_E,
          decision.parentCollectionId,
          normalized,
          [...decision.indexSet],
        ],
        chain: polygon,
        account: accountAny,
      });
      // bug.0384: mark pending immediately after submission so the next
      // sweep tick (within ~30s, possibly before this tx mines) skips this
      // condition rather than re-firing it.
      markRedeemPending(normalized);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status !== "success") {
        throw new PolyTradeExecutorError(
          "redeem_failed",
          `poly-trade-executor: redeem tx not successful conditionId=${params.condition_id}`
        );
      }
      deps.logger.info(
        {
          event: "poly.ctf.redeem.ok",
          billing_account_id: billingAccountId,
          condition_id: params.condition_id,
          tx_hash: hash,
        },
        "poly-trade-executor: redeemPositions confirmed"
      );
      deps.metrics.incr("poly_ctf_redeem_total", { result: "ok" });
      return { tx_hash: hash };
    } catch (err) {
      if (err instanceof PolyTradeExecutorError) throw err;
      deps.metrics.incr("poly_ctf_redeem_total", { result: "error" });
      throw new PolyTradeExecutorError(
        "redeem_failed",
        `poly-trade-executor: redeemPositions failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async function redeemAllRedeemableResolvedPositions(): Promise<
    Array<{ condition_id: string; tx_hash: `0x${string}` }>
  > {
    // bug.0384 mutex: one sweep cycle in flight per process. mirror-pipeline
    // ticks every ~30s but a sweep with N winners + receipt waits exceeds
    // that. Without this, two ticks compute predicates against pre-burn
    // chain state and both fire the same conditions.
    if (sweepInFlight) {
      deps.logger.info(
        {
          event: "poly.ctf.redeem.sweep_skip_in_flight",
          billing_account_id: billingAccountId,
          funder: funderAddress,
        },
        "poly-trade-executor: redeem sweep tick skipped — previous sweep still in flight"
      );
      return [];
    }
    sweepInFlight = true;
    const startedAt = Date.now();
    try {
      const out = await runRedeemSweep();
      // bug.0384 observability: this race went undetected for 24h because
      // we had no signal for "sweep wall-clock > tick interval." Emit on
      // every completion so the next race-class bug shows up in Loki the
      // same hour it ships. Alert: `duration_ms > tick_interval_ms` =
      // ticks are guaranteed to overlap (mutex saves us, but it's a smell).
      deps.logger.info(
        {
          event: "poly.ctf.redeem.sweep_completed",
          billing_account_id: billingAccountId,
          funder: funderAddress,
          duration_ms: Date.now() - startedAt,
          redeems: out.length,
        },
        "poly-trade-executor: redeem sweep completed"
      );
      return out;
    } finally {
      sweepInFlight = false;
    }
  }

  async function runRedeemSweep(): Promise<
    Array<{ condition_id: string; tx_hash: `0x${string}` }>
  > {
    // Predicate is on-chain (`balanceOf` + `payoutNumerators`), NOT Data-API
    // `redeemable`. The Data-API flag is the bug.0376 source (stays true for
    // already-redeemed positions); the chain is the truth source. bug.0383
    // adds the `payoutNumerators` gate so we don't fire on losing outcomes.
    // bug.0384 adds a per-condition cooldown so pending-tx don't re-fire.
    // Positions list is the *enumeration source* only.
    const positions = await dataApiClient.listUserPositions(funderAddress);
    const candidates: Array<{
      condition_id: string;
      conditionIdHex: `0x${string}`;
      asset: bigint;
      outcomeIndex: number | null;
      negativeRisk: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const p of positions) {
      if (!p.conditionId) continue;
      let conditionIdHex: `0x${string}`;
      try {
        conditionIdHex = normalizePolygonConditionId(p.conditionId);
      } catch {
        continue;
      }
      if (seen.has(conditionIdHex)) continue;
      seen.add(conditionIdHex);
      if (!p.asset) continue;
      let asset: bigint;
      try {
        asset = BigInt(p.asset);
      } catch {
        continue;
      }
      candidates.push({
        condition_id: p.conditionId,
        conditionIdHex,
        asset,
        outcomeIndex: p.outcomeIndex ?? null,
        negativeRisk: p.negativeRisk ?? false,
      });
    }
    if (candidates.length === 0) return [];

    // 4N batched read per candidate (task.0387 Capability A inputs):
    //   balanceOf + payoutNumerators + payoutDenominator + getOutcomeSlotCount
    // One RPC round-trip via multicall.
    const reads = await publicClient.multicall({
      contracts: candidates.flatMap((c) => [
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "balanceOf" as const,
          args: [funderAddress as `0x${string}`, c.asset] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "payoutNumerators" as const,
          // outcomeIndex `null` becomes 0 here; decideRedeem still classifies
          // null `outcomeIndex` as malformed via its own gate.
          args: [c.conditionIdHex, BigInt(c.outcomeIndex ?? 0)] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "payoutDenominator" as const,
          args: [c.conditionIdHex] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfPrecheckAbi,
          functionName: "getOutcomeSlotCount" as const,
          args: [c.conditionIdHex] as const,
        },
      ]),
      allowFailure: true,
    });

    const out: Array<{ condition_id: string; tx_hash: `0x${string}` }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c) continue;
      const balRes = reads[i * 4];
      const numRes = reads[i * 4 + 1];
      const denRes = reads[i * 4 + 2];
      const slotsRes = reads[i * 4 + 3];

      const decision: RedeemDecision = decideRedeem({
        balance:
          balRes && balRes.status === "success"
            ? (balRes.result as bigint)
            : null,
        payoutNumerator:
          numRes && numRes.status === "success"
            ? (numRes.result as bigint)
            : null,
        payoutDenominator:
          denRes && denRes.status === "success"
            ? (denRes.result as bigint)
            : null,
        outcomeIndex: c.outcomeIndex,
        outcomeSlotCount:
          slotsRes && slotsRes.status === "success"
            ? Number(slotsRes.result as bigint)
            : null,
        negativeRisk: c.negativeRisk,
      });

      const base = {
        billing_account_id: billingAccountId,
        condition_id: c.condition_id,
        asset: c.asset.toString(),
        funder: funderAddress,
        outcome_index: c.outcomeIndex,
        negative_risk: c.negativeRisk,
      };
      // Single structured log for every decision — Loki query
      // `{app="poly"} |= "policy_decision"` reflects exactly what the policy
      // emitted, in the shape consumed by the validation block.
      deps.logger.info(
        {
          event: "poly.ctf.redeem.policy_decision",
          ...base,
          policy_decision:
            decision.kind === "redeem"
              ? { kind: "redeem", flavor: decision.flavor }
              : { kind: decision.kind, reason: decision.reason },
        },
        "poly-trade-executor: redeem sweep policy decision"
      );

      if (decision.kind === "skip") {
        switch (decision.reason) {
          case "zero_balance":
            deps.logger.info(
              { event: "poly.ctf.redeem.skip_zero_balance", ...base },
              "poly-trade-executor: redeem sweep skipped — funder holds zero ERC1155 balance"
            );
            break;
          case "losing_outcome":
            deps.logger.info(
              { event: "poly.ctf.redeem.skip_losing_outcome", ...base },
              "poly-trade-executor: redeem sweep skipped — losing outcome (payoutNumerator=0)"
            );
            break;
          case "market_not_resolved":
            deps.logger.info(
              { event: "poly.ctf.redeem.skip_market_not_resolved", ...base },
              "poly-trade-executor: redeem sweep skipped — payoutDenominator=0; CTF has not recorded resolution despite Data-API redeemable hint"
            );
            break;
          case "read_failed":
            deps.logger.warn(
              {
                event: "poly.ctf.redeem.balance_read_failed",
                ...base,
                bal_err: errMsg(balRes),
                num_err: errMsg(numRes),
                den_err: errMsg(denRes),
                slots_err: errMsg(slotsRes),
              },
              "poly-trade-executor: precheck read failed; skipping condition"
            );
            break;
        }
        continue;
      }

      if (decision.kind === "malformed") {
        // bug.0384 class — design defect. Do NOT call back into
        // `redeemResolvedPosition` (which would re-fetch + re-decide and
        // hit the same wall, or — worse — fire a tx with a wrong index-set
        // that produces zero burn). Skip this candidate; emit a high-signal
        // log so the on-call sees abandoned-class events in Loki.
        deps.logger.error(
          {
            event: "poly.ctf.redeem.malformed",
            ...base,
            policy_reason: decision.reason,
          },
          "poly-trade-executor: redeem sweep refused — malformed policy input"
        );
        deps.metrics.incr("poly_ctf_redeem_total", {
          result: "malformed",
          reason: decision.reason,
        });
        continue;
      }

      // bug.0384 cooldown gate (post-predicate): if we just submitted a
      // redeem for this condition, skip — its tx may not have mined yet
      // and the multicall above is reading pre-burn balance.
      const pendingMs = pendingRedeemMsRemaining(c.conditionIdHex);
      if (pendingMs > 0) {
        deps.logger.info(
          {
            event: "poly.ctf.redeem.skip_pending_redeem",
            billing_account_id: billingAccountId,
            condition_id: c.condition_id,
            funder: funderAddress,
            expires_in_ms: pendingMs,
          },
          "poly-trade-executor: redeem sweep skipped — redeem already pending in cooldown"
        );
        continue;
      }

      try {
        const r = await redeemResolvedPosition({
          condition_id: c.condition_id,
        });
        out.push({ condition_id: c.condition_id, tx_hash: r.tx_hash });
      } catch (err) {
        // Post-precheck error path: precheck passed but `redeemResolvedPosition`
        // failed (Data-API match drift, RPC error, write failure). Rare.
        deps.logger.warn(
          {
            event: "poly.ctf.redeem.error",
            billing_account_id: billingAccountId,
            condition_id: c.condition_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "poly-trade-executor: redeem failed after on-chain precheck"
        );
      }
    }
    return out;
  }

  const executor: PolyTradeExecutor = {
    billingAccountId,
    placeIntent: authorizedPlace,
    closePosition,
    exitPosition,
    listPositions: () => dataApiClient.listUserPositions(funderAddress),
    getOrder: adapter.getOrder.bind(adapter),
    getMarketConstraints: adapter.getMarketConstraints.bind(adapter),
    listOpenOrders: async () =>
      (await adapter.listOpenOrders()).map(mapOpenOrderSummary),
    redeemResolvedPosition,
    redeemAllRedeemableResolvedPositions,
    funderAddress,
  };

  return { executor, funderAddress };
}

function mapOpenOrderSummary(
  order: Awaited<
    ReturnType<
      import("@cogni/market-provider/adapters/polymarket").PolymarketClobAdapter["listOpenOrders"]
    >
  >[number]
): OpenOrderSummary {
  const attrs = (order.attributes ?? {}) as Record<string, unknown>;
  const price = readFinite(attrs.price);
  const originalShares = readFinite(attrs.originalSize);
  const matchedShares = readFinite(attrs.sizeMatched) ?? 0;
  const side =
    attrs.side === "BUY" || attrs.side === "SELL" ? attrs.side : null;
  const remainingShares =
    originalShares !== null
      ? Math.max(0, originalShares - matchedShares)
      : null;
  const remainingUsdc =
    price !== null && remainingShares !== null
      ? roundToCents(price * remainingShares)
      : null;

  return {
    orderId: order.order_id,
    marketId: typeof attrs.market === "string" ? attrs.market : null,
    tokenId: typeof attrs.tokenId === "string" ? attrs.tokenId : null,
    outcome: typeof attrs.outcome === "string" ? attrs.outcome : null,
    side,
    price,
    originalShares,
    matchedShares,
    remainingUsdc,
    submittedAt: order.submitted_at,
    status: order.status,
  };
}

function readFinite(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
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
