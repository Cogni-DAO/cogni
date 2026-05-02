// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/contract/app/poly.wallet.dashboard-db-read.routes`
 * Purpose: Regression tests for bug.5001 — dashboard page-load reads live
 *   positions/open-order summary from `poly_copy_trade_fills`, not CLOB.
 * Scope: Route-only with mocked bootstrap deps. Does not hit Privy, Polygon,
 *   Polymarket Data API, or Polymarket CLOB.
 * Invariants:
 *   - CLOB_NOT_ON_PAGE_LOAD: overview/execution delegate to OrderLedger only.
 *   - STALENESS_VISIBLE: execution rows expose sync freshness fields.
 * Side-effects: none
 * Links: bug.5001
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
const mockMarkSynced = vi.fn();
const mockGetExecutionSlice = vi.fn();
const mockInvalidateWalletAnalysisCaches = vi.fn();

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
      markSynced: mockMarkSynced,
    },
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
  getExecutionSlice: mockGetExecutionSlice,
  invalidateWalletAnalysisCaches: mockInvalidateWalletAnalysisCaches,
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

describe("poly wallet dashboard DB read routes", () => {
  beforeEach(() => {
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
    mockUpdateStatus.mockResolvedValue(undefined);
    mockMarkPositionClosedByAsset.mockResolvedValue(1);
    mockMarkSynced.mockResolvedValue(undefined);
    mockGetExecutionSlice.mockResolvedValue({
      address: FUNDER,
      capturedAt: new Date().toISOString(),
      dailyTradeCounts: [],
      live_positions: [],
      closed_positions: [],
      warnings: [],
    });
    syncedAt = new Date();
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
      limit: 100,
    });
  });

  it("execution renders live positions from DB when CLOB is fully down", async () => {
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toHaveLength(1);
    expect(json.live_positions[0]).toMatchObject({
      positionId: "0xorder",
      conditionId:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      asset: "token-1",
      marketTitle: "Will CLOB stay up?",
      eventTitle: "CLOB Health",
      marketSlug: "will-clob-stay-up",
      eventSlug: "clob-health",
      resolvesAt: "2026-05-02T12:00:00.000Z",
      gameStartTime: "2026-05-02T12:00:00.000Z",
      outcome: "YES",
      currentValue: 10,
      syncedAt: syncedAt.toISOString(),
      syncStale: false,
    });
    expect(json.dailyTradeCounts).toEqual([
      { day: row.observed_at.toISOString().slice(0, 10), n: 1 },
    ]);
    expect(json.closed_positions).toEqual([]);
    expect(mockListTenantPositions).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      statuses: ["pending", "open", "filled", "partial", "canceled", "error"],
      limit: 500,
    });
  });

  it("overview does not double-count unfilled resting BUY orders as position MTM", async () => {
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

  it("execution does not resurrect a DB-backed row stamped closed", async () => {
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
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.live_positions).toEqual([]);
    expect(json.closed_positions).toHaveLength(1);
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
    const today = new Date("2026-05-02T03:00:00.000Z");
    const yesterday = new Date("2026-05-01T22:00:00.000Z");
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        observed_at: today,
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
        observed_at: today,
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
        observed_at: today,
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
        observed_at: today,
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
        observed_at: today,
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
      { day: "2026-05-01", n: 1 },
      { day: "2026-05-02", n: 1 },
    ]);
    expect(json.live_positions).toHaveLength(1);
    expect(mockGetExecutionSlice).not.toHaveBeenCalled();
  });

  it("execution trade counts include terminal order states when they have fills", async () => {
    const today = new Date("2026-05-02T03:00:00.000Z");
    mockListTenantPositions.mockResolvedValue([
      {
        ...row,
        observed_at: today,
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
        observed_at: today,
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
    const { GET } = await import("@/app/api/v1/poly/wallet/execution/route");

    const response = await GET(
      new Request("http://localhost/api/v1/poly/wallet/execution")
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.dailyTradeCounts).toEqual([{ day: "2026-05-02", n: 2 }]);
    expect(json.live_positions).toHaveLength(2);
  });

  it("refresh updates the ledger rows that dashboard page-loads read", async () => {
    mockListPositions.mockResolvedValue([]);
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
      limit: 500,
    });
    expect(mockGetOrder).toHaveBeenCalledWith("0xorder");
    expect(mockUpdateStatus).toHaveBeenCalledWith({
      client_order_id: "0xclient",
      status: "partial",
      filled_size_usdc: 10,
      order_id: "0xorder",
    });
    expect(mockMarkPositionClosedByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      reason: "refresh_no_position",
      closed_at: expect.any(Date),
    });
    expect(mockMarkSynced).toHaveBeenCalledWith(["0xclient"]);
    expect(mockInvalidateWalletAnalysisCaches).toHaveBeenCalledWith(FUNDER);
  });

  it("refresh still reconciles positions when one order lookup fails", async () => {
    mockGetOrder.mockRejectedValue(new Error("clob getOrder unavailable"));
    mockListPositions.mockResolvedValue([]);
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
    expect(mockListPositions).toHaveBeenCalled();
    expect(mockMarkPositionClosedByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      reason: "refresh_no_position",
      closed_at: expect.any(Date),
    });
  });

  it("refresh does not close DB positions when positions reconciliation fails", async () => {
    mockListPositions.mockRejectedValue(new Error("positions unavailable"));
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
    expect(mockMarkPositionClosedByAsset).not.toHaveBeenCalled();
  });
});
