// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/contract/app/poly.wallet.dashboard-db-read.routes`
 * Purpose: Regression tests for bug.5001 — dashboard page-load reads live
 *   open-order summary from `poly_copy_trade_fills`, and current holdings
 *   from Polymarket Data API, not CLOB.
 * Scope: Route-only with mocked bootstrap deps. Does not hit Privy, Polygon,
 *   Polymarket Data API, or Polymarket CLOB.
 * Invariants:
 *   - CLOB_NOT_ON_PAGE_LOAD: overview/execution do not read CLOB.
 *   - STALENESS_VISIBLE: execution rows expose sync freshness fields.
 * Side-effects: none
 * Links: bug.5001
 * @internal
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "@/features/trading";

const SESSION_USER = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT = { id: "billing-account-1" };
const FUNDER = "0x0000000000000000000000000000000000000001";
const ALL_LEDGER_STATUSES = [
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
] as const;
const NOW = new Date("2026-05-02T03:00:00.000Z");
const EMPTY_14_DAY_COUNTS = [
  { day: "2026-04-19", n: 0 },
  { day: "2026-04-20", n: 0 },
  { day: "2026-04-21", n: 0 },
  { day: "2026-04-22", n: 0 },
  { day: "2026-04-23", n: 0 },
  { day: "2026-04-24", n: 0 },
  { day: "2026-04-25", n: 0 },
  { day: "2026-04-26", n: 0 },
  { day: "2026-04-27", n: 0 },
  { day: "2026-04-28", n: 0 },
  { day: "2026-04-29", n: 0 },
  { day: "2026-04-30", n: 0 },
  { day: "2026-05-01", n: 0 },
  { day: "2026-05-02", n: 0 },
] as const;

const mockAccountsForUser = vi.fn();
const mockGetOrCreateBillingAccountForUser = vi.fn();
const mockListTenantPositions = vi.fn();
const mockGetPolyTraderWalletAdapter = vi.fn();
const mockGetBalances = vi.fn();
const mockGetAddress = vi.fn();
const mockGetTradingWalletPnlHistory = vi.fn();
const mockCreatePolyTradeExecutorFactory = vi.fn();
const mockGetPolyTradeExecutorFor = vi.fn();
const mockGetOrder = vi.fn();
const mockListPositions = vi.fn();
const mockUpdateStatus = vi.fn();
const mockMarkPositionClosedByAsset = vi.fn();
const mockMarkPositionLifecycleByAsset = vi.fn();
const mockMarkSynced = vi.fn();
const mockGetBalanceSlice = vi.fn();
const mockGetExecutionSlice = vi.fn();
const mockInvalidateWalletAnalysisCaches = vi.fn();
const mockReadCurrentWalletPositionModel = vi.fn();
const mockRefreshCurrentPositionsForWallet = vi.fn();
const mockServiceDb = {};

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (config: unknown, handler: (...args: unknown[]) => unknown) =>
    async (request: Request) => {
      const routeId =
        typeof config === "object" && config !== null && "routeId" in config
          ? String(config.routeId)
          : "test.route";
      return handler(
        {
          reqId: "req-test",
          routeId,
          log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            child: vi.fn().mockReturnThis(),
          },
        },
        request,
        SESSION_USER
      );
    },
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    accountsForUser: mockAccountsForUser,
    orderLedger: {
      listTenantPositions: mockListTenantPositions,
      updateStatus: mockUpdateStatus,
      markPositionClosedByAsset: mockMarkPositionClosedByAsset,
      markPositionLifecycleByAsset: mockMarkPositionLifecycleByAsset,
      markSynced: mockMarkSynced,
    },
    serviceDb: mockServiceDb,
  })),
}));

vi.mock("@/bootstrap/poly-trader-wallet", () => ({
  getPolyTraderWalletAdapter: mockGetPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError: class WalletAdapterUnconfiguredError extends Error {},
}));

vi.mock("@/bootstrap/capabilities/poly-trade-executor", () => ({
  createPolyTradeExecutorFactory: mockCreatePolyTradeExecutorFactory,
}));

vi.mock(
  "@/features/wallet-analysis/server/trading-wallet-overview-service",
  () => ({
    getTradingWalletPnlHistory: mockGetTradingWalletPnlHistory,
  })
);

vi.mock("@/features/wallet-analysis/server/wallet-analysis-service", () => ({
  getBalanceSlice: mockGetBalanceSlice,
  getExecutionSlice: mockGetExecutionSlice,
  invalidateWalletAnalysisCaches: mockInvalidateWalletAnalysisCaches,
}));

vi.mock(
  "@/features/wallet-analysis/server/current-position-read-model",
  () => ({
    readCurrentWalletPositionModel: mockReadCurrentWalletPositionModel,
  })
);

vi.mock("@/features/wallet-analysis/server/trader-observation-service", () => ({
  refreshCurrentPositionsForWallet: mockRefreshCurrentPositionsForWallet,
}));

vi.mock("@/shared/env/server-env", () => ({
  serverEnv: vi.fn(() => ({
    POLY_CLOB_HOST: "https://clob.polymarket.com",
    POLYGON_RPC_URL: "https://polygon.example",
  })),
}));

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

let syncedAt: Date;
let row: LedgerRow;

function mockCurrentPositionsMtm(positions: number): void {
  mockReadCurrentWalletPositionModel.mockResolvedValue({
    positions: [],
    summary: {
      positionsMtm: positions,
      syncedAt: syncedAt.toISOString(),
      syncAgeMs: 0,
      stale: false,
      activeRows: positions > 0 ? 1 : 0,
    },
    warnings: [],
  });
}

function mockCurrentPositionModel(
  positions = [makeCurrentExecutionPosition()]
): void {
  mockReadCurrentWalletPositionModel.mockResolvedValue({
    positions,
    summary: {
      positionsMtm: positions.reduce(
        (sum, position) => sum + position.currentValue,
        0
      ),
      syncedAt: syncedAt.toISOString(),
      syncAgeMs: 0,
      stale: false,
      activeRows: positions.length,
    },
    warnings: [],
  });
}

function makeCurrentExecutionPosition(overrides: Record<string, unknown> = {}) {
  return {
    positionId:
      "0x1111111111111111111111111111111111111111111111111111111111111111:token-1",
    conditionId:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    asset: "token-1",
    marketTitle: "Will CLOB stay up?",
    eventTitle: "CLOB Health",
    marketSlug: "will-clob-stay-up",
    eventSlug: "clob-health",
    marketUrl: "https://polymarket.com/event/clob-health/will-clob-stay-up",
    outcome: "YES",
    status: "open",
    lifecycleState: null,
    openedAt: new Date(Date.now() - 60_000).toISOString(),
    closedAt: null,
    resolvesAt: "2026-05-03T00:00:00.000Z",
    gameStartTime: "2026-05-02T12:00:00.000Z",
    heldMinutes: 1,
    entryPrice: 0.5,
    currentPrice: 0.5,
    size: 20,
    currentValue: 10,
    pnlUsd: 0,
    pnlPct: 0,
    syncedAt: syncedAt.toISOString(),
    syncAgeMs: 0,
    syncStale: false,
    timeline: [],
    events: [],
    ...overrides,
  };
}

describe("poly wallet dashboard DB read routes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    vi.resetModules();
    vi.clearAllMocks();
    mockAccountsForUser.mockReturnValue({
      getOrCreateBillingAccountForUser: mockGetOrCreateBillingAccountForUser,
    });
    mockGetOrCreateBillingAccountForUser.mockResolvedValue(ACCOUNT);
    mockGetBalances.mockResolvedValue({
      address: FUNDER,
      errors: [],
      usdcE: 25,
      pusd: 5,
      pol: 0.2,
    });
    mockGetAddress.mockResolvedValue(FUNDER);
    mockGetPolyTraderWalletAdapter.mockReturnValue({
      getBalances: mockGetBalances,
      getAddress: mockGetAddress,
    });
    mockCreatePolyTradeExecutorFactory.mockReturnValue({
      getPolyTradeExecutorFor: mockGetPolyTradeExecutorFor,
    });
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      getOrder: mockGetOrder,
      listPositions: mockListPositions,
      getPositionShareBalance: vi.fn().mockResolvedValue(0),
      getMarketConstraints: vi.fn().mockResolvedValue({ minShares: 1 }),
    });
    mockGetOrder.mockResolvedValue({
      found: {
        order_id: "0xorder",
        client_order_id: "0xclient",
        status: "partial",
        filled_size_usdc: 10,
        submitted_at: new Date().toISOString(),
      },
    });
    mockListPositions.mockResolvedValue([
      {
        asset: "token-1",
        size: 20,
        currentValue: 10,
      },
    ]);
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [{ asset: "token-1", size: 20, currentValue: 10 }],
      positionRows: 1,
      complete: true,
    });
    syncedAt = new Date();
    mockUpdateStatus.mockResolvedValue(undefined);
    mockMarkPositionClosedByAsset.mockResolvedValue(1);
    mockMarkPositionLifecycleByAsset.mockResolvedValue(1);
    mockMarkSynced.mockResolvedValue(undefined);
    mockCurrentPositionModel();
    mockGetExecutionSlice.mockRejectedValue(new Error("data api unavailable"));
    row = {
      target_id: "target-1",
      fill_id: "data-api:fill-1",
      observed_at: new Date(Date.now() - 60_000),
      client_order_id: "0xclient",
      order_id: "0xorder",
      status: "partial",
      position_lifecycle: "open",
      attributes: {
        market_id:
          "prediction-market:polymarket:0x1111111111111111111111111111111111111111111111111111111111111111",
        condition_id:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        token_id: "token-1",
        title: "Will CLOB stay up?",
        slug: "will-clob-stay-up",
        event_slug: "clob-health",
        event_title: "CLOB Health",
        end_date: "2026-05-03T00:00:00.000Z",
        game_start_time: "2026-05-02T12:00:00.000Z",
        outcome: "YES",
        side: "BUY",
        size_usdc: 20,
        filled_size_usdc: 10,
        limit_price: 0.5,
      },
      synced_at: syncedAt,
      created_at: new Date(Date.now() - 59_000),
      updated_at: syncedAt,
      billing_account_id: ACCOUNT.id,
    };
    mockListTenantPositions.mockResolvedValue([row]);
    mockGetTradingWalletPnlHistory.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("overview derives open orders and locked USDC from the ledger read model", async () => {
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      address: FUNDER,
      usdc_available: 20,
      usdc_locked: 10,
      usdc_positions_mtm: 10,
      usdc_total: 40,
      open_orders: 1,
      positions_synced_at: syncedAt.toISOString(),
      positions_stale: false,
    });
    expect(mockListTenantPositions).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      statuses: ALL_LEDGER_STATUSES,
      limit: 2_000,
    });
  });

  it("overview values positions from current Polymarket holdings instead of ledger cost basis", async () => {
    mockCurrentPositionsMtm(7.5);
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        attributes: {
          ...row.attributes,
          size_usdc: 200,
          filled_size_usdc: 100,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usdc_available: 0,
      usdc_locked: 100,
      usdc_positions_mtm: 7.5,
      usdc_total: 37.5,
      open_orders: 1,
    });
  });

  it("overview does not fall back to ledger MTM when current-position inventory is unavailable", async () => {
    mockReadCurrentWalletPositionModel.mockRejectedValueOnce(
      new Error("current inventory unavailable")
    );
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        attributes: {
          ...row.attributes,
          size_usdc: 200,
          filled_size_usdc: 100,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      usdc_available: 0,
      usdc_locked: 100,
      usdc_positions_mtm: null,
      usdc_total: null,
      open_orders: 1,
    });
    expect(json.warnings).toContainEqual(
      expect.objectContaining({
        code: "current_positions_read_model_unavailable",
      })
    );
  });

  it("overview read-model freshness skips live Polymarket valuation and P/L history", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        attributes: {
          ...row.attributes,
          size_usdc: 200,
          filled_size_usdc: 100,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/overview?interval=1W&freshness=read_model"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      freshness: "read_model",
      usdc_available: 0,
      usdc_locked: 100,
      usdc_positions_mtm: 10,
      usdc_total: 40,
      pnlHistory: [],
      warnings: [],
    });
    expect(mockGetBalanceSlice).not.toHaveBeenCalled();
    expect(mockGetTradingWalletPnlHistory).not.toHaveBeenCalled();
  });

  it("execution renders live positions from DB when CLOB is fully down", async () => {
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      positionId:
        "0x1111111111111111111111111111111111111111111111111111111111111111:token-1",
      conditionId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      asset: "token-1",
      marketTitle: "Will CLOB stay up?",
      eventTitle: "CLOB Health",
      marketSlug: "will-clob-stay-up",
      eventSlug: "clob-health",
      resolvesAt: "2026-05-03T00:00:00.000Z",
      gameStartTime: "2026-05-02T12:00:00.000Z",
      outcome: "YES",
      currentValue: 10,
      pnlUsd: 0,
      pnlPct: 0,
      syncedAt: syncedAt.toISOString(),
      syncStale: false,
    });
    expect(json.live_positions[0].timeline).toEqual([]);
    expect(json.dailyTradeCounts).toEqual([
      ...EMPTY_14_DAY_COUNTS.slice(0, -1),
      { day: "2026-05-02", n: 1 },
    ]);
    expect(json.closed_positions).toEqual([]);
    expect(mockListTenantPositions).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      statuses: ["pending", "open", "filled", "partial", "canceled", "error"],
      limit: 2_000,
    });
  });

  it("execution moves zero-value current positions into history", async () => {
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        asset: "token-live",
        positionId:
          "0x1111111111111111111111111111111111111111111111111111111111111111:token-live",
        currentValue: 5,
      }),
      makeCurrentExecutionPosition({
        asset: "token-loser",
        positionId:
          "0x2222222222222222222222222222222222222222222222222222222222222222:token-loser",
        conditionId:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        marketTitle: "Resolved loser",
        status: "closed",
        lifecycleState: "loser",
        currentPrice: 0,
        currentValue: 0,
        pnlUsd: 0,
        pnlPct: 0,
        closedAt: NOW.toISOString(),
      }),
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({ asset: "token-live" });
    expect(
      json.live_positions.map((p: { asset: string }) => p.asset)
    ).not.toContain("token-loser");
    expect(json.closed_positions).toContainEqual(
      expect.objectContaining({
        asset: "token-loser",
        status: "closed",
        lifecycleState: "loser",
        currentValue: 0,
      })
    );
  });

  it("execution returns all live current-position rows", async () => {
    mockListTenantPositions.mockResolvedValue([]);
    mockCurrentPositionModel(
      Array.from({ length: 100 }, (_, index) =>
        makeCurrentExecutionPosition({
          positionId: `open:${index}`,
          conditionId: `0x${String(index + 1).padStart(64, "0")}`,
          asset: `open-token-${index}`,
          marketTitle: `Open market ${index}`,
          currentValue: index + 1,
        })
      )
    );
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(100);
    expect(json.closed_positions).toEqual([]);
  });

  it("execution caps closed history rows from the current-position read model", async () => {
    mockListTenantPositions.mockResolvedValue([]);
    mockCurrentPositionModel(
      Array.from({ length: 40 }, (_, index) =>
        makeCurrentExecutionPosition({
          positionId: `closed:${index}`,
          conditionId: `0x${String(index + 1).padStart(64, "0")}`,
          asset: `closed-token-${index}`,
          marketTitle: `Closed market ${index}`,
          status: "closed",
          lifecycleState: "redeemed",
          currentValue: 0,
          closedAt: new Date(Date.now() - index * 60_000).toISOString(),
        })
      )
    );
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toEqual([]);
    expect(json.closed_positions).toHaveLength(30);
  });

  it("execution read-model freshness skips live Polymarket positions", async () => {
    mockGetExecutionSlice.mockResolvedValue({
      address: FUNDER,
      capturedAt: NOW.toISOString(),
      dailyTradeCounts: [],
      live_positions: [
        {
          positionId: "condition-live:token-live",
          conditionId:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          asset: "token-live",
          marketTitle: "Live-only row",
          marketSlug: "live-only-row",
          eventSlug: "live-event",
          marketUrl: "https://polymarket.com/event/live-event",
          outcome: "YES",
          status: "open",
          lifecycleState: null,
          openedAt: NOW.toISOString(),
          closedAt: null,
          resolvesAt: null,
          heldMinutes: 0,
          entryPrice: 0.5,
          currentPrice: 1,
          size: 7,
          currentValue: 7,
          pnlUsd: 3.5,
          pnlPct: 100,
          timeline: [],
          events: [],
        },
      ],
      closed_positions: [],
      warnings: [],
    });
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=read_model"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.freshness).toBe("read_model");
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-1",
      marketTitle: "Will CLOB stay up?",
      currentValue: 10,
    });
    expect(json.dailyTradeCounts).toEqual([
      ...EMPTY_14_DAY_COUNTS.slice(0, -1),
      { day: "2026-05-02", n: 1 },
    ]);
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("execution does not fall back to ledger open rows when current-position inventory is unavailable", async () => {
    mockReadCurrentWalletPositionModel.mockRejectedValueOnce(
      new Error("current inventory unavailable")
    );
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toEqual([]);
    expect(json.closed_positions).toEqual([]);
    expect(json.warnings).toContainEqual(
      expect.objectContaining({
        code: "current_positions_read_model_unavailable",
      })
    );
  });

  it("execution derives position P/L from refreshed DB current value", async () => {
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        currentValue: 1.9,
        pnlUsd: 0.9,
        pnlPct: 90,
      }),
    ]);
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        attributes: {
          ...row.attributes,
          size_usdc: 1,
          filled_size_usdc: 1.9,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      currentValue: 1.9,
      pnlUsd: 0.9,
      pnlPct: 90,
    });
  });

  it("execution drops live-only rows and preserves DB row identity during live enrichment", async () => {
    mockGetExecutionSlice.mockResolvedValue({
      address: FUNDER,
      capturedAt: NOW.toISOString(),
      dailyTradeCounts: [],
      live_positions: [
        {
          positionId: "condition-1:token-live",
          conditionId:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          asset: "token-live",
          marketTitle: "Current winner",
          marketSlug: "current-winner",
          eventSlug: "current-event",
          marketUrl: "https://polymarket.com/event/current-event",
          outcome: "YES",
          status: "redeemable",
          lifecycleState: null,
          openedAt: NOW.toISOString(),
          closedAt: null,
          resolvesAt: null,
          heldMinutes: 0,
          entryPrice: 0.5,
          currentPrice: 1,
          size: 7,
          currentValue: 7,
          pnlUsd: 3.5,
          pnlPct: 100,
          timeline: [],
          events: [],
        },
        {
          positionId: "condition-2:token-loser",
          conditionId:
            "0x3333333333333333333333333333333333333333333333333333333333333333",
          asset: "token-loser",
          marketTitle: "Resolved loser",
          marketSlug: "resolved-loser",
          eventSlug: "resolved-event",
          marketUrl: "https://polymarket.com/event/resolved-event",
          outcome: "NO",
          status: "redeemable",
          lifecycleState: null,
          openedAt: NOW.toISOString(),
          closedAt: null,
          resolvesAt: null,
          heldMinutes: 0,
          entryPrice: 0.5,
          currentPrice: 0,
          size: 10,
          currentValue: 0,
          pnlUsd: -5,
          pnlPct: -100,
          timeline: [],
          events: [],
        },
      ],
      closed_positions: [],
      warnings: [],
    });
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-1",
      positionId:
        "0x1111111111111111111111111111111111111111111111111111111111111111:token-1",
      marketTitle: "Will CLOB stay up?",
      currentValue: 10,
    });
    expect(
      json.live_positions.map((p: { asset: string }) => p.asset)
    ).not.toEqual(expect.arrayContaining(["token-live", "token-loser"]));
    expect(json.dailyTradeCounts).toEqual([
      ...EMPTY_14_DAY_COUNTS.slice(0, -1),
      { day: "2026-05-02", n: 1 },
    ]);
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("execution renders all DB current-position rows without dropping ledger-backed history", async () => {
    const olderRow = {
      ...row,
      fill_id: "data-api:fill-older",
      client_order_id: "0xclient-older",
      order_id: "0xorder-older",
      observed_at: new Date(Date.now() - 2 * 60 * 60 * 1_000),
      attributes: {
        ...row.attributes,
        token_id: "token-older",
        title: "Older DB-backed row",
        filled_size_usdc: 2,
      },
    };
    mockListTenantPositions.mockResolvedValue([row, olderRow]);
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        currentPrice: 0.7,
        currentValue: 14,
        pnlUsd: 4,
        pnlPct: 40,
      }),
      makeCurrentExecutionPosition({
        positionId:
          "0x1111111111111111111111111111111111111111111111111111111111111111:token-older",
        asset: "token-older",
        marketTitle: "Older DB-backed row",
        currentValue: 2,
        pnlUsd: 0,
        pnlPct: 0,
      }),
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(2);
    expect(json.live_positions).toContainEqual(
      expect.objectContaining({
        asset: "token-older",
        marketTitle: "Older DB-backed row",
      })
    );
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-1",
      currentPrice: 0.7,
      currentValue: 14,
      pnlUsd: 4,
      heldMinutes: 1,
      timeline: [],
    });
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("execution uses the current-position read model instead of duplicate ledger rows for live exposure", async () => {
    const duplicateRow = {
      ...row,
      fill_id: "data-api:fill-duplicate",
      client_order_id: "0xclient-duplicate",
      order_id: "0xorder-duplicate",
      observed_at: new Date(Date.now() - 30_000),
      attributes: {
        ...row.attributes,
        size_usdc: 12,
        filled_size_usdc: 12,
      },
    };
    mockListTenantPositions.mockResolvedValue([row, duplicateRow]);
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        currentValue: 29.58,
        pnlUsd: -1.12,
        pnlPct: -3.66,
      }),
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-1",
      currentValue: 29.58,
      pnlUsd: -1.12,
      pnlPct: -3.66,
    });
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("overview does not double-count unfilled resting BUY orders as position MTM", async () => {
    mockCurrentPositionsMtm(0);
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "open",
        attributes: {
          ...row.attributes,
          size_usdc: 10,
          filled_size_usdc: 0,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usdc_available: 20,
      usdc_locked: 10,
      usdc_positions_mtm: 0,
      usdc_total: 30,
      open_orders: 1,
    });
  });

  it("overview does not count closed partial rows as open orders or locked USDC", async () => {
    mockCurrentPositionsMtm(0);
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "partial",
        position_lifecycle: "closed",
        attributes: {
          ...row.attributes,
          closed_at: new Date().toISOString(),
          size_usdc: 20,
          filled_size_usdc: 10,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usdc_available: 30,
      usdc_locked: 0,
      usdc_positions_mtm: 0,
      usdc_total: 30,
      open_orders: 0,
    });
  });

  it("overview does not count typed winner rows as resting orders", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "partial",
        position_lifecycle: "winner",
        attributes: {
          ...row.attributes,
          size_usdc: 20,
          filled_size_usdc: 10,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usdc_locked: 0,
      usdc_positions_mtm: 10,
      open_orders: 0,
    });
  });

  it("overview counts canceled orders that still have position exposure", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "canceled",
        position_lifecycle: "open",
        attributes: {
          ...row.attributes,
          size_usdc: 20,
          filled_size_usdc: 10,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/overview/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/overview?interval=1W")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usdc_available: 30,
      usdc_locked: 0,
      usdc_positions_mtm: 10,
      usdc_total: 40,
      open_orders: 0,
    });
  });

  it("execution lets current-position snapshot override a stale closed ledger row", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        position_lifecycle: "closed",
        attributes: {
          ...row.attributes,
          closed_at: new Date().toISOString(),
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request(
        "http://localhost/api/v1/poly/wallet/execution?freshness=live"
      )
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-1",
      currentValue: 10,
    });
    expect(json.closed_positions).toEqual([]);
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("execution marks typed winner lifecycle rows redeemable", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        position_lifecycle: "winner",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 10,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      status: "redeemable",
      lifecycleState: "winner",
      currentValue: 10,
    });
    expect(json.closed_positions).toEqual([]);
  });

  it("execution moves terminal ledger lifecycle rows to closed history", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        position_lifecycle: "redeemed",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 10,
        },
      },
    ]);
    mockCurrentPositionModel([]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toEqual([]);
    expect(json.closed_positions).toHaveLength(1);
    expect(json.closed_positions[0]).toMatchObject({
      status: "closed",
      lifecycleState: "redeemed",
      currentValue: 0,
    });
  });

  it("execution keeps dust ledger rows closed when current snapshot omits them", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        position_lifecycle: "dust",
        attributes: {
          ...row.attributes,
          token_id: "token-1",
          filled_size_usdc: 10,
        },
      },
    ]);
    mockCurrentPositionModel([]);
    mockGetExecutionSlice.mockResolvedValue({
      address: FUNDER,
      capturedAt: NOW.toISOString(),
      dailyTradeCounts: [],
      live_positions: [
        {
          positionId: "condition-1:token-1",
          conditionId:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          asset: "token-1",
          marketTitle: "Sub-floor dust",
          marketSlug: "sub-floor-dust",
          eventSlug: "dust-event",
          marketUrl: "https://polymarket.com/event/dust-event",
          outcome: "YES",
          status: "open",
          lifecycleState: null,
          openedAt: NOW.toISOString(),
          closedAt: null,
          resolvesAt: null,
          heldMinutes: 0,
          entryPrice: 0.5,
          currentPrice: 0.98,
          size: 4.898,
          currentValue: 4.8,
          pnlUsd: -0.1,
          pnlPct: -2,
          timeline: [],
          events: [],
        },
        {
          positionId: "condition-2:token-live",
          conditionId:
            "0x2222222222222222222222222222222222222222222222222222222222222222",
          asset: "token-live",
          marketTitle: "Still actionable",
          marketSlug: "still-actionable",
          eventSlug: "live-event",
          marketUrl: "https://polymarket.com/event/live-event",
          outcome: "NO",
          status: "open",
          lifecycleState: null,
          openedAt: NOW.toISOString(),
          closedAt: null,
          resolvesAt: null,
          heldMinutes: 0,
          entryPrice: 0.5,
          currentPrice: 0.5,
          size: 5,
          currentValue: 2.5,
          pnlUsd: 0,
          pnlPct: 0,
          timeline: [],
          events: [],
        },
      ],
      closed_positions: [],
      warnings: [],
    });
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toEqual([]);
    expect(json.closed_positions).toHaveLength(1);
    expect(json.closed_positions[0]).toMatchObject({
      asset: "token-1",
      lifecycleState: "dust",
    });
  });

  it("execution keeps sibling outcome assets independent by ledger lifecycle", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "filled",
        position_lifecycle: "redeemed",
      },
      {
        ...row,
        fill_id: "data-api:fill-2",
        client_order_id: "0xclient-2",
        order_id: "0xorder-2",
        attributes: {
          ...row.attributes,
          token_id: "token-2",
          outcome: "NO",
        },
      },
    ]);
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        positionId:
          "0x1111111111111111111111111111111111111111111111111111111111111111:token-2",
        asset: "token-2",
        outcome: "NO",
      }),
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.closed_positions).toHaveLength(1);
    expect(json.closed_positions[0]).toMatchObject({
      asset: "token-1",
      lifecycleState: "redeemed",
    });
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      asset: "token-2",
      lifecycleState: "open",
      status: "open",
    });
  });

  it("execution keeps canceled orders with filled exposure in live positions", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        status: "canceled",
        position_lifecycle: "open",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 10,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      status: "open",
      lifecycleState: "open",
      currentValue: 10,
    });
    expect(json.closed_positions).toEqual([]);
  });

  it("execution trade counts ignore raw non-fill ledger rows", async () => {
    const yesterday = new Date("2026-05-01T22:00:00.000Z");
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        observed_at: NOW,
        status: "filled",
        position_lifecycle: "open",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 2,
        },
      },
      {
        ...row,
        fill_id: "data-api:closed-fill",
        client_order_id: "0xclosed",
        order_id: "0xclosed-order",
        observed_at: yesterday,
        status: "filled",
        position_lifecycle: "closed",
        attributes: {
          ...row.attributes,
          token_id: "token-closed",
          filled_size_usdc: 1.5,
          closed_at: yesterday.toISOString(),
        },
      },
      {
        ...row,
        fill_id: "data-api:pending-intent",
        client_order_id: "0xpending",
        observed_at: NOW,
        status: "pending",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 0,
          size_usdc: 25,
        },
      },
      {
        ...row,
        fill_id: "data-api:open-resting",
        client_order_id: "0xopen",
        observed_at: NOW,
        status: "open",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 0,
          size_usdc: 25,
        },
      },
      {
        ...row,
        fill_id: "data-api:error",
        client_order_id: "0xerror",
        observed_at: NOW,
        status: "error",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 0,
          size_usdc: 99,
        },
      },
      {
        ...row,
        fill_id: "data-api:canceled",
        client_order_id: "0xcanceled",
        observed_at: NOW,
        status: "canceled",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 0,
          size_usdc: 25,
        },
      },
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.dailyTradeCounts).toEqual([
      ...EMPTY_14_DAY_COUNTS.slice(0, -2),
      { day: "2026-05-01", n: 1 },
      { day: "2026-05-02", n: 1 },
    ]);
    expect(json.live_positions).toHaveLength(1);
  });

  it("execution trade counts include terminal order states when they have fills", async () => {
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        observed_at: NOW,
        status: "canceled",
        position_lifecycle: "open",
        attributes: {
          ...row.attributes,
          filled_size_usdc: 2,
          size_usdc: 20,
        },
      },
      {
        ...row,
        fill_id: "data-api:error-fill",
        client_order_id: "0xerror-fill",
        observed_at: NOW,
        status: "error",
        position_lifecycle: "open",
        attributes: {
          ...row.attributes,
          token_id: "token-error",
          filled_size_usdc: 1,
          size_usdc: 20,
        },
      },
    ]);
    mockCurrentPositionModel([
      makeCurrentExecutionPosition({
        currentValue: 2,
      }),
      makeCurrentExecutionPosition({
        positionId:
          "0x1111111111111111111111111111111111111111111111111111111111111111:token-error",
        asset: "token-error",
        currentValue: 1,
      }),
    ]);
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.dailyTradeCounts).toEqual([
      ...EMPTY_14_DAY_COUNTS.slice(0, -1),
      { day: "2026-05-02", n: 2 },
    ]);
    expect(json.live_positions).toHaveLength(2);
  });

  it("refresh updates the ledger rows that dashboard page-loads read", async () => {
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [],
      positionRows: 0,
      complete: true,
    });
    mockGetExecutionSlice.mockResolvedValue({
      address: FUNDER,
      capturedAt: NOW.toISOString(),
      dailyTradeCounts: [],
      live_positions: [],
      closed_positions: [],
      warnings: [],
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      address: FUNDER,
      warnings: [],
    });
    expect(mockListTenantPositions).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      statuses: ALL_LEDGER_STATUSES,
      limit: 2_000,
    });
    expect(mockGetOrder).toHaveBeenCalledWith("0xorder");
    expect(mockRefreshCurrentPositionsForWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        db: expect.anything(),
        client: expect.anything(),
        walletAddress: FUNDER,
      })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith({
      client_order_id: "0xclient",
      status: "partial",
      filled_size_usdc: 10,
      order_id: "0xorder",
    });
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      lifecycle: "closed",
      updated_at: expect.any(Date),
    });
    expect(mockMarkSynced).toHaveBeenCalledWith(["0xclient"]);
    expect(mockInvalidateWalletAnalysisCaches).toHaveBeenCalledWith(FUNDER);
  });

  it("refresh still reconciles positions when one order lookup fails", async () => {
    mockGetOrder.mockRejectedValue(new Error("clob getOrder unavailable"));
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [],
      positionRows: 0,
      complete: true,
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toContainEqual(
      expect.objectContaining({ code: "order_refresh_partial" })
    );
    expect(json.warnings).not.toContainEqual(
      expect.objectContaining({ code: "ledger_refresh_unavailable" })
    );
    expect(mockRefreshCurrentPositionsForWallet).toHaveBeenCalled();
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      lifecycle: "closed",
      updated_at: expect.any(Date),
    });
  });

  it("refresh marks Data API-omitted sub-floor chain balances as dust", async () => {
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [],
      positionRows: 0,
      complete: true,
    });
    const getPositionShareBalance = vi.fn().mockResolvedValue(0.67);
    const getMarketConstraints = vi.fn().mockResolvedValue({ minShares: 1 });
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      getOrder: mockGetOrder,
      listPositions: mockListPositions,
      getPositionShareBalance,
      getMarketConstraints,
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(getPositionShareBalance).toHaveBeenCalledWith("token-1");
    expect(getMarketConstraints).toHaveBeenCalledWith("token-1");
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      lifecycle: "dust",
      updated_at: expect.any(Date),
    });
  });

  it("refresh keeps Data API-omitted above-floor chain balances actionable without writing shares as USDC", async () => {
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [],
      positionRows: 0,
      complete: true,
    });
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        order_id: null,
        status: "filled",
      },
    ]);
    const getPositionShareBalance = vi.fn().mockResolvedValue(7);
    const getMarketConstraints = vi.fn().mockResolvedValue({ minShares: 1 });
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      getOrder: mockGetOrder,
      listPositions: mockListPositions,
      getPositionShareBalance,
      getMarketConstraints,
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(getPositionShareBalance).toHaveBeenCalledWith("token-1");
    expect(getMarketConstraints).toHaveBeenCalledWith("token-1");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockMarkPositionLifecycleByAsset).not.toHaveBeenCalled();
    expect(mockMarkSynced).toHaveBeenCalledWith(["0xclient"]);
  });

  it("refresh keeps other reconciliation work when actionability classification fails", async () => {
    mockListPositions.mockResolvedValue([]);
    const getPositionShareBalance = vi
      .fn()
      .mockRejectedValue(new Error("rpc unavailable"));
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      getOrder: mockGetOrder,
      listPositions: mockListPositions,
      getPositionShareBalance,
      getMarketConstraints: vi.fn(),
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toContainEqual(
      expect.objectContaining({ code: "positions_actionability_partial" })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith({
      client_order_id: "0xclient",
      status: "partial",
      filled_size_usdc: 10,
      order_id: "0xorder",
    });
    expect(mockMarkPositionLifecycleByAsset).not.toHaveBeenCalled();
  });

  it("refresh does not close DB positions when positions reconciliation fails", async () => {
    mockRefreshCurrentPositionsForWallet.mockRejectedValue(
      new Error("positions unavailable")
    );
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toContainEqual(
      expect.objectContaining({ code: "positions_reconciliation_unavailable" })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith({
      client_order_id: "0xclient",
      status: "partial",
      filled_size_usdc: 10,
      order_id: "0xorder",
    });
    expect(mockMarkPositionLifecycleByAsset).not.toHaveBeenCalled();
  });

  it("refresh keeps stale DB rows active when the current-position poll is partial", async () => {
    mockRefreshCurrentPositionsForWallet.mockResolvedValue({
      positions: [],
      positionRows: 0,
      complete: false,
    });
    const { POST } = await import("@/app/api/v1/poly/wallet/refresh/route");

    const response = await POST(
      new Request("http://localhost/api/v1/poly/wallet/refresh", {
        method: "POST",
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warnings).toContainEqual(
      expect.objectContaining({ code: "positions_reconciliation_partial" })
    );
    expect(mockMarkPositionClosedByAsset).not.toHaveBeenCalled();
  });
});
