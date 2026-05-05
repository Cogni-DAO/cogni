// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trader-observation-service`
 * Purpose: Live-forward observation service for configured Polymarket trader wallets — fills, current positions, and (when `userPnlClient` is injected) user-pnl time-series for the page-load read model.
 * Scope: Feature service. Caller injects DB/client/logger; this module does not construct runtime dependencies or own scheduling.
 * Invariants:
 *   - LIVE_FORWARD_COLLECTION: polls `active_for_research` wallets and stores facts for later query windows.
 *   - SAME_OBSERVED_TRADE_TABLE: target and Cogni public wallet trades are both stored in `poly_trader_fills`.
 *   - WATERMARKED_INGESTION: reads newest-to-prior-watermark and advances cursor only after DB upserts complete.
 *   - PNL_INGEST_INDEPENDENT: per-wallet user-pnl ingest runs after observation regardless of observe outcome; failures bump `errors` and continue. Retention prune runs once per tick after all wallets.
 *   - COGNI_POSITION_ABSENCE_NEEDS_AUTHORITY: complete Data API polls do not
 *     deactivate Cogni-wallet current-position rows unless an injected
 *     authority classifies the missing row terminal.
 * Side-effects: IO through injected Data API client + optional user-pnl client + injected DB.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005, work/items/task.5012
 * @public
 */

import { createHash } from "node:crypto";
import {
  type PolyTraderWallet,
  polyTraderCurrentPositions,
  polyTraderFills,
  polyTraderIngestionCursors,
  polyTraderPositionSnapshots,
  polyTraderWallets,
} from "@cogni/poly-db-schema/trader-activity";
import { polyWalletConnections } from "@cogni/poly-db-schema/wallet-connections";
import type {
  Fill,
  LoggerPort,
  MetricsPort,
} from "@cogni/poly-market-provider";
import {
  createPolymarketActivitySource,
  type PolymarketDataApiClient,
  type PolymarketUserPnlClient,
  type PolymarketUserPosition,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { and, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  fetchAndPersistTradingWalletPnlHistory,
  pruneOldTradingWalletPnlPoints,
} from "./trading-wallet-overview-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const TRADE_SOURCE = "data-api-trades";
const POSITION_SOURCE = "data-api-positions";
const DEFAULT_TRADE_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 10;
const POSITION_FETCH_LIMIT = 500;
const DEFAULT_POSITION_MAX_PAGES = 10;
const DEFAULT_POSITION_POLL_MS = 5 * 60 * 1000;
const TENANT_TRADING_WALLET_LABEL = "Tenant trading wallet";

export interface TraderObservationTickDeps {
  db: Db;
  client: PolymarketDataApiClient;
  userPnlClient?: PolymarketUserPnlClient;
  logger: LoggerPort;
  metrics: MetricsPort;
  tradePageLimit?: number;
  maxPages?: number;
  positionMaxPages?: number;
  positionPollMs?: number;
}

export interface TraderObservationTickResult {
  wallets: number;
  fills: number;
  positions: number;
  pnlPoints: number;
  prunedPnlPoints: number;
  errors: number;
}

export interface CurrentPositionRefreshResult {
  positions: PolymarketUserPosition[];
  positionRows: number;
  complete: boolean;
  stalePositionRowsDeactivated: number;
  stalePositionRowsPreserved: number;
}

type PersistedCurrentPositions = {
  observedPositions: PolymarketUserPosition[];
  positionRows: number;
  complete: boolean;
  stalePositionRowsDeactivated: number;
  stalePositionRowsPreserved: number;
};

export interface MissingCurrentPosition {
  conditionId: string;
  tokenId: string;
  shares: number;
  currentValueUsdc: number;
  lastObservedAt: Date;
}

export type MissingCurrentPositionDecision =
  | { kind: "deactivate"; reason: "zero_balance" | "dust" }
  | { kind: "preserve"; reason: "actionable" | "authority_unavailable" };

export async function runTraderObservationTick(
  deps: TraderObservationTickDeps
): Promise<TraderObservationTickResult> {
  const log = deps.logger.child({
    component: "trader-observation",
  });
  await syncActiveTenantWallets(deps.db);
  const wallets = await deps.db
    .select()
    .from(polyTraderWallets)
    .where(
      and(
        eq(polyTraderWallets.activeForResearch, true),
        isNull(polyTraderWallets.disabledAt)
      )
    )
    .orderBy(polyTraderWallets.kind, polyTraderWallets.label);

  let fills = 0;
  let positions = 0;
  let pnlPoints = 0;
  let errors = 0;

  for (const wallet of wallets) {
    try {
      const result = await observeWallet({ ...deps, wallet, logger: log });
      fills += result.fills;
      positions += result.positions;
    } catch (err: unknown) {
      errors += 1;
      log.error(
        {
          event: "poly.trader.observe",
          phase: "error",
          trader_wallet_id: wallet.id,
          wallet: wallet.walletAddress,
          err: err instanceof Error ? err.message : String(err),
        },
        "trader observation failed"
      );
      await markCursorError(deps.db, wallet.id, err);
    }
    if (deps.userPnlClient) {
      try {
        const pnlResult = await fetchAndPersistTradingWalletPnlHistory({
          db: deps.db,
          traderWalletId: wallet.id,
          walletAddress: wallet.walletAddress as `0x${string}`,
          client: deps.userPnlClient,
          logger: log,
          component: "trader-observation",
        });
        pnlPoints += pnlResult.inserted;
      } catch (err: unknown) {
        errors += 1;
        log.error(
          {
            event: "poly.trader.observe",
            phase: "user_pnl_error",
            trader_wallet_id: wallet.id,
            wallet: wallet.walletAddress,
            err: err instanceof Error ? err.message : String(err),
          },
          "trader user-pnl ingest failed"
        );
      }
    }
  }

  let prunedPnlPoints = 0;
  if (deps.userPnlClient) {
    try {
      const prune = await pruneOldTradingWalletPnlPoints(deps.db);
      prunedPnlPoints = prune.deleted;
    } catch (err: unknown) {
      log.warn(
        {
          event: "poly.trader.observe",
          phase: "user_pnl_prune_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "trader user-pnl prune failed"
      );
    }
  }

  log.info(
    {
      event: "poly.trader.observe",
      phase: "tick_ok",
      wallets: wallets.length,
      fills,
      positions,
      pnl_points: pnlPoints,
      pruned_pnl_points: prunedPnlPoints,
      errors,
    },
    "trader observation tick complete"
  );

  return {
    wallets: wallets.length,
    fills,
    positions,
    pnlPoints,
    prunedPnlPoints,
    errors,
  };
}

export async function refreshCurrentPositionsForWallet(params: {
  db: Db;
  client: PolymarketDataApiClient;
  walletAddress: string;
  positionMaxPages?: number;
  classifyMissingPosition?: (
    position: MissingCurrentPosition
  ) => Promise<MissingCurrentPositionDecision>;
}): Promise<CurrentPositionRefreshResult> {
  const wallet = await upsertCogniObservedWallet(
    params.db,
    params.walletAddress.toLowerCase()
  );
  return observePositionsNow({
    db: params.db,
    client: params.client,
    wallet,
    ...(params.positionMaxPages === undefined
      ? {}
      : { positionMaxPages: params.positionMaxPages }),
    ...(params.classifyMissingPosition === undefined
      ? {}
      : { classifyMissingPosition: params.classifyMissingPosition }),
  });
}

async function syncActiveTenantWallets(db: Db): Promise<void> {
  const now = new Date();
  const activeConnections = await db
    .select({
      address: polyWalletConnections.address,
    })
    .from(polyWalletConnections)
    .where(isNull(polyWalletConnections.revokedAt));
  if (activeConnections.length === 0) {
    await disableMissingTenantWallets(db, [], now);
    return;
  }

  await db
    .insert(polyTraderWallets)
    .values(
      activeConnections.map((connection) => ({
        walletAddress: connection.address.toLowerCase(),
        kind: "cogni_wallet",
        label: TENANT_TRADING_WALLET_LABEL,
        activeForResearch: true,
        disabledAt: null,
        updatedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: polyTraderWallets.walletAddress,
      set: {
        kind: "cogni_wallet",
        label: TENANT_TRADING_WALLET_LABEL,
        activeForResearch: true,
        disabledAt: null,
        updatedAt: now,
      },
    });
  await disableMissingTenantWallets(
    db,
    activeConnections.map((connection) => connection.address.toLowerCase()),
    now
  );
}

async function upsertCogniObservedWallet(
  db: Db,
  walletAddress: string
): Promise<PolyTraderWallet> {
  const now = new Date();
  const [wallet] = await db
    .insert(polyTraderWallets)
    .values({
      walletAddress,
      kind: "cogni_wallet",
      label: TENANT_TRADING_WALLET_LABEL,
      activeForResearch: true,
      disabledAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: polyTraderWallets.walletAddress,
      set: {
        kind: "cogni_wallet",
        label: TENANT_TRADING_WALLET_LABEL,
        activeForResearch: true,
        disabledAt: null,
        updatedAt: now,
      },
    })
    .returning();
  if (!wallet) {
    throw new Error(`failed to upsert observed wallet ${walletAddress}`);
  }
  return wallet;
}

async function disableMissingTenantWallets(
  db: Db,
  activeWalletAddresses: readonly string[],
  now: Date
): Promise<void> {
  const filters = [
    eq(polyTraderWallets.kind, "cogni_wallet"),
    eq(polyTraderWallets.label, TENANT_TRADING_WALLET_LABEL),
    isNull(polyTraderWallets.disabledAt),
  ];
  if (activeWalletAddresses.length > 0) {
    filters.push(
      notInArray(polyTraderWallets.walletAddress, [...activeWalletAddresses])
    );
  }
  await db
    .update(polyTraderWallets)
    .set({
      activeForResearch: false,
      disabledAt: now,
      updatedAt: now,
    })
    .where(and(...filters));
}

async function observeWallet(
  deps: TraderObservationTickDeps & {
    wallet: PolyTraderWallet;
  }
): Promise<{ fills: number; positions: number }> {
  const cursor = await deps.db
    .select()
    .from(polyTraderIngestionCursors)
    .where(
      and(
        eq(polyTraderIngestionCursors.traderWalletId, deps.wallet.id),
        eq(polyTraderIngestionCursors.source, TRADE_SOURCE)
      )
    )
    .limit(1);
  const since = cursor[0]?.lastSeenAt
    ? Math.floor(cursor[0].lastSeenAt.getTime() / 1000)
    : undefined;

  const source = createPolymarketActivitySource({
    client: deps.client,
    wallet: deps.wallet.walletAddress as `0x${string}`,
    logger: deps.logger,
    metrics: deps.metrics,
    limit: deps.tradePageLimit ?? DEFAULT_TRADE_PAGE_LIMIT,
    maxPages: deps.maxPages ?? DEFAULT_MAX_PAGES,
  });
  const observed = await source.fetchSince(since);
  const insertedFills = await upsertObservedFills(
    deps.db,
    deps.wallet.id,
    observed.fills
  );
  const positionResult = await observePositionsIfDue(deps).catch(
    async (err: unknown) => {
      deps.logger.error(
        {
          event: "poly.trader.observe",
          phase: "positions_error",
          trader_wallet_id: deps.wallet.id,
          wallet: deps.wallet.walletAddress,
          err: err instanceof Error ? err.message : String(err),
        },
        "trader position observation failed"
      );
      await markCursorError(deps.db, deps.wallet.id, err, POSITION_SOURCE);
      return { positions: 0, complete: false, skipped: false };
    }
  );

  await deps.db
    .insert(polyTraderIngestionCursors)
    .values({
      traderWalletId: deps.wallet.id,
      source: TRADE_SOURCE,
      lastSeenAt:
        observed.newSince > 0
          ? new Date(observed.newSince * 1000)
          : cursor[0]?.lastSeenAt,
      lastSeenNativeId:
        observed.fills[0]?.fill_id ?? cursor[0]?.lastSeenNativeId,
      lastSuccessAt: new Date(),
      status: "ok",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        polyTraderIngestionCursors.traderWalletId,
        polyTraderIngestionCursors.source,
      ],
      set: {
        lastSeenAt:
          observed.newSince > 0
            ? new Date(observed.newSince * 1000)
            : cursor[0]?.lastSeenAt,
        lastSeenNativeId:
          observed.fills[0]?.fill_id ?? cursor[0]?.lastSeenNativeId,
        lastSuccessAt: new Date(),
        status: "ok",
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

  deps.logger.info(
    {
      event: "poly.trader.observe",
      phase: "wallet_ok",
      trader_wallet_id: deps.wallet.id,
      wallet: deps.wallet.walletAddress,
      kind: deps.wallet.kind,
      fills: insertedFills,
      positions: positionResult.positions,
      positions_complete: positionResult.complete,
      positions_skipped: positionResult.skipped,
      new_since: observed.newSince,
    },
    "trader wallet observed"
  );

  return { fills: insertedFills, positions: positionResult.positions };
}

async function upsertObservedFills(
  db: Db,
  traderWalletId: string,
  fills: readonly Fill[]
): Promise<number> {
  if (fills.length === 0) return 0;
  const values = fills.flatMap((fill) => {
    const conditionId = readString(fill.attributes, "condition_id");
    const tokenId = readString(fill.attributes, "asset");
    if (!conditionId || !tokenId || fill.price <= 0) return [];
    const shares = fill.size_usdc / fill.price;
    return [
      {
        traderWalletId,
        source: fill.source,
        nativeId: fill.fill_id,
        conditionId,
        tokenId,
        side: fill.side,
        price: fill.price.toFixed(8),
        shares: shares.toFixed(8),
        sizeUsdc: fill.size_usdc.toFixed(8),
        txHash: readString(fill.attributes, "transaction_hash"),
        observedAt: new Date(fill.observed_at),
        raw: fill as unknown as Record<string, unknown>,
      },
    ];
  });
  if (values.length === 0) return 0;
  await db
    .insert(polyTraderFills)
    .values(values)
    .onConflictDoNothing({
      target: [
        polyTraderFills.traderWalletId,
        polyTraderFills.source,
        polyTraderFills.nativeId,
      ],
    });
  return values.length;
}

async function observePositionsIfDue(
  deps: TraderObservationTickDeps & { wallet: PolyTraderWallet }
): Promise<{ positions: number; complete: boolean; skipped: boolean }> {
  const cursor = await deps.db
    .select()
    .from(polyTraderIngestionCursors)
    .where(
      and(
        eq(polyTraderIngestionCursors.traderWalletId, deps.wallet.id),
        eq(polyTraderIngestionCursors.source, POSITION_SOURCE)
      )
    )
    .limit(1);
  const pollMs = deps.positionPollMs ?? DEFAULT_POSITION_POLL_MS;
  const lastSuccessAt = cursor[0]?.lastSuccessAt;
  if (lastSuccessAt && Date.now() - lastSuccessAt.getTime() < pollMs) {
    return {
      positions: 0,
      complete: cursor[0]?.status !== "partial",
      skipped: true,
    };
  }

  const pageResult = await fetchTraderPositionsPages({
    client: deps.client,
    walletAddress: deps.wallet.walletAddress,
    maxPages: deps.positionMaxPages ?? DEFAULT_POSITION_MAX_PAGES,
  });
  const result = await persistObservedCurrentPositions(
    deps.db,
    deps.wallet,
    pageResult
  );
  return {
    positions: result.positionRows,
    complete: result.complete,
    skipped: false,
  };
}

async function observePositionsNow(deps: {
  db: Db;
  client: PolymarketDataApiClient;
  wallet: PolyTraderWallet;
  positionMaxPages?: number;
  classifyMissingPosition?: (
    position: MissingCurrentPosition
  ) => Promise<MissingCurrentPositionDecision>;
}): Promise<CurrentPositionRefreshResult> {
  const pageResult = await fetchTraderPositionsPages({
    client: deps.client,
    walletAddress: deps.wallet.walletAddress,
    maxPages: deps.positionMaxPages ?? DEFAULT_POSITION_MAX_PAGES,
  });
  const result = await persistObservedCurrentPositions(
    deps.db,
    deps.wallet,
    pageResult,
    deps.classifyMissingPosition === undefined
      ? undefined
      : { classifyMissingPosition: deps.classifyMissingPosition }
  );
  return {
    positions: result.observedPositions,
    positionRows: result.positionRows,
    complete: result.complete,
    stalePositionRowsDeactivated: result.stalePositionRowsDeactivated,
    stalePositionRowsPreserved: result.stalePositionRowsPreserved,
  };
}

async function persistObservedCurrentPositions(
  db: Db,
  wallet: PolyTraderWallet,
  pageResult: { positions: PolymarketUserPosition[]; complete: boolean },
  options?: {
    classifyMissingPosition?: (
      position: MissingCurrentPosition
    ) => Promise<MissingCurrentPositionDecision>;
  }
): Promise<PersistedCurrentPositions> {
  const positions = pageResult.positions;
  const capturedAt = new Date();
  const values = positions.map((position) => {
    const contentHash = hashPosition(position);
    return {
      traderWalletId: wallet.id,
      conditionId: position.conditionId,
      tokenId: position.asset,
      shares: Math.max(0, position.size).toFixed(8),
      costBasisUsdc: positionCostUsdc(position).toFixed(8),
      currentValueUsdc: Math.max(0, position.currentValue).toFixed(8),
      avgPrice: Math.max(0, position.avgPrice).toFixed(8),
      contentHash,
      capturedAt,
      raw: position as unknown as Record<string, unknown>,
    };
  });
  if (values.length > 0) {
    await db
      .insert(polyTraderPositionSnapshots)
      .values(values)
      .onConflictDoNothing({
        target: [
          polyTraderPositionSnapshots.traderWalletId,
          polyTraderPositionSnapshots.conditionId,
          polyTraderPositionSnapshots.tokenId,
          polyTraderPositionSnapshots.contentHash,
        ],
      });
    await db
      .insert(polyTraderCurrentPositions)
      .values(
        values.map((value) => ({
          traderWalletId: value.traderWalletId,
          conditionId: value.conditionId,
          tokenId: value.tokenId,
          active: true,
          shares: value.shares,
          costBasisUsdc: value.costBasisUsdc,
          currentValueUsdc: value.currentValueUsdc,
          avgPrice: value.avgPrice,
          contentHash: value.contentHash,
          lastObservedAt: capturedAt,
          raw: value.raw,
        }))
      )
      .onConflictDoUpdate({
        target: [
          polyTraderCurrentPositions.traderWalletId,
          polyTraderCurrentPositions.conditionId,
          polyTraderCurrentPositions.tokenId,
        ],
        set: {
          active: true,
          shares: sql`excluded.shares`,
          costBasisUsdc: sql`excluded.cost_basis_usdc`,
          currentValueUsdc: sql`excluded.current_value_usdc`,
          avgPrice: sql`excluded.avg_price`,
          contentHash: sql`excluded.content_hash`,
          lastObservedAt: capturedAt,
          raw: sql`excluded.raw`,
        },
      });
  }
  const staleDisposition = pageResult.complete
    ? await classifyStaleCurrentPositionRows(db, wallet, capturedAt, options)
    : { deactivateTokenIds: [], preservedRows: 0 };
  if (staleDisposition.deactivateTokenIds.length > 0) {
    await db
      .update(polyTraderCurrentPositions)
      .set({
        active: false,
        shares: "0",
        costBasisUsdc: "0",
        currentValueUsdc: "0",
        avgPrice: "0",
        lastObservedAt: capturedAt,
      })
      .where(
        and(
          eq(polyTraderCurrentPositions.traderWalletId, wallet.id),
          eq(polyTraderCurrentPositions.active, true),
          lt(polyTraderCurrentPositions.lastObservedAt, capturedAt),
          inArray(
            polyTraderCurrentPositions.tokenId,
            staleDisposition.deactivateTokenIds
          )
        )
      );
  }

  const cursorStatus = pageResult.complete
    ? staleDisposition.preservedRows > 0
      ? "stale"
      : "ok"
    : "partial";
  const cursorErrorMessage = pageResult.complete
    ? staleDisposition.preservedRows > 0
      ? `${staleDisposition.preservedRows} previously active position rows were not returned by Data API and were preserved pending chain-authoritative refresh`
      : null
    : `position page cap reached at ${positions.length} rows`;

  await db
    .insert(polyTraderIngestionCursors)
    .values({
      traderWalletId: wallet.id,
      source: POSITION_SOURCE,
      lastSuccessAt: capturedAt,
      status: cursorStatus,
      errorMessage: cursorErrorMessage,
      updatedAt: capturedAt,
    })
    .onConflictDoUpdate({
      target: [
        polyTraderIngestionCursors.traderWalletId,
        polyTraderIngestionCursors.source,
      ],
      set: {
        lastSuccessAt: capturedAt,
        status: cursorStatus,
        errorMessage: cursorErrorMessage,
        updatedAt: capturedAt,
      },
    });

  return {
    observedPositions: positions,
    positionRows: values.length,
    complete: pageResult.complete,
    stalePositionRowsDeactivated: staleDisposition.deactivateTokenIds.length,
    stalePositionRowsPreserved: staleDisposition.preservedRows,
  };
}

async function classifyStaleCurrentPositionRows(
  db: Db,
  wallet: PolyTraderWallet,
  capturedAt: Date,
  options?: {
    classifyMissingPosition?: (
      position: MissingCurrentPosition
    ) => Promise<MissingCurrentPositionDecision>;
  }
): Promise<{ deactivateTokenIds: string[]; preservedRows: number }> {
  const staleRows = await db
    .select({
      conditionId: polyTraderCurrentPositions.conditionId,
      tokenId: polyTraderCurrentPositions.tokenId,
      shares: polyTraderCurrentPositions.shares,
      currentValueUsdc: polyTraderCurrentPositions.currentValueUsdc,
      lastObservedAt: polyTraderCurrentPositions.lastObservedAt,
    })
    .from(polyTraderCurrentPositions)
    .where(
      and(
        eq(polyTraderCurrentPositions.traderWalletId, wallet.id),
        eq(polyTraderCurrentPositions.active, true),
        lt(polyTraderCurrentPositions.lastObservedAt, capturedAt)
      )
    );
  if (staleRows.length === 0) {
    return { deactivateTokenIds: [], preservedRows: 0 };
  }

  const classifyMissingPosition = options?.classifyMissingPosition;
  if (classifyMissingPosition === undefined) {
    if (wallet.kind === "cogni_wallet") {
      return { deactivateTokenIds: [], preservedRows: staleRows.length };
    }
    return {
      deactivateTokenIds: staleRows.map((row) => row.tokenId),
      preservedRows: 0,
    };
  }

  const deactivateTokenIds: string[] = [];
  let preservedRows = 0;
  for (const row of staleRows) {
    const decision = await classifyMissingPosition({
      conditionId: row.conditionId,
      tokenId: row.tokenId,
      shares: Number(row.shares),
      currentValueUsdc: Number(row.currentValueUsdc),
      lastObservedAt: row.lastObservedAt,
    });
    if (decision.kind === "deactivate") {
      deactivateTokenIds.push(row.tokenId);
    } else {
      preservedRows += 1;
    }
  }

  return { deactivateTokenIds, preservedRows };
}

export async function fetchTraderPositionsPages(params: {
  client: PolymarketDataApiClient;
  walletAddress: string;
  maxPages: number;
}): Promise<{ positions: PolymarketUserPosition[]; complete: boolean }> {
  const maxPages = Math.max(1, params.maxPages);
  const positions: PolymarketUserPosition[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const pagePositions = await params.client.listUserPositions(
      params.walletAddress,
      {
        sizeThreshold: 0,
        limit: POSITION_FETCH_LIMIT,
        offset: page * POSITION_FETCH_LIMIT,
      }
    );
    positions.push(...pagePositions);
    if (pagePositions.length < POSITION_FETCH_LIMIT) {
      return { positions, complete: true };
    }
  }
  return { positions, complete: false };
}

async function markCursorError(
  db: Db,
  traderWalletId: string,
  err: unknown,
  source = TRADE_SOURCE
): Promise<void> {
  await db
    .insert(polyTraderIngestionCursors)
    .values({
      traderWalletId,
      source,
      lastErrorAt: new Date(),
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        polyTraderIngestionCursors.traderWalletId,
        polyTraderIngestionCursors.source,
      ],
      set: {
        lastErrorAt: new Date(),
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: new Date(),
      },
    });
}

function positionCostUsdc(
  position: Pick<PolymarketUserPosition, "initialValue" | "size" | "avgPrice">
): number {
  if (Number.isFinite(position.initialValue) && position.initialValue > 0) {
    return position.initialValue;
  }
  return Math.max(0, position.size * position.avgPrice);
}

function hashPosition(position: PolymarketUserPosition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        conditionId: position.conditionId,
        asset: position.asset,
        size: position.size,
        avgPrice: position.avgPrice,
        initialValue: position.initialValue,
        currentValue: position.currentValue,
        curPrice: position.curPrice,
      })
    )
    .digest("hex");
}

function readString(
  value: Record<string, unknown> | undefined,
  key: string
): string | null {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

export async function listObservedTraderWallets(db: Db): Promise<
  Array<{
    id: string;
    walletAddress: string;
    kind: string;
    label: string;
    lastSuccessAt: Date | null;
    status: string | null;
  }>
> {
  const rows = await db
    .select({
      id: polyTraderWallets.id,
      walletAddress: polyTraderWallets.walletAddress,
      kind: polyTraderWallets.kind,
      label: polyTraderWallets.label,
      lastSuccessAt: polyTraderIngestionCursors.lastSuccessAt,
      status: polyTraderIngestionCursors.status,
    })
    .from(polyTraderWallets)
    .leftJoin(
      polyTraderIngestionCursors,
      and(
        eq(polyTraderIngestionCursors.traderWalletId, polyTraderWallets.id),
        eq(polyTraderIngestionCursors.source, TRADE_SOURCE)
      )
    )
    .where(
      and(
        eq(polyTraderWallets.activeForResearch, true),
        isNull(polyTraderWallets.disabledAt)
      )
    )
    .orderBy(polyTraderWallets.kind, polyTraderWallets.label);
  return rows;
}
