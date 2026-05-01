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

const mockAccountsForUser = vi.fn();
const mockGetOrCreateBillingAccountForUser = vi.fn();
const mockListTenantPositions = vi.fn();
const mockGetPolyTraderWalletAdapter = vi.fn();
const mockGetBalances = vi.fn();
const mockGetAddress = vi.fn();
const mockGetTradingWalletPnlHistory = vi.fn();

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (_config: unknown, handler: (...args: unknown[]) => unknown) =>
    async (request: Request) =>
      handler(
        {
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
      ),
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    accountsForUser: mockAccountsForUser,
    orderLedger: {
      listTenantPositions: mockListTenantPositions,
    },
  })),
}));

vi.mock("@/bootstrap/poly-trader-wallet", () => ({
  getPolyTraderWalletAdapter: mockGetPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError: class WalletAdapterUnconfiguredError extends Error {},
}));

vi.mock(
  "@/features/wallet-analysis/server/trading-wallet-overview-service",
  () => ({
    getTradingWalletPnlHistory: mockGetTradingWalletPnlHistory,
  })
);

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
    syncedAt = new Date();
    row = {
      target_id: "target-1",
      fill_id: "data-api:fill-1",
      observed_at: new Date(Date.now() - 60_000),
      client_order_id: "0xclient",
      order_id: "0xorder",
      status: "open",
      attributes: {
        market_id: "condition-1",
        token_id: "token-1",
        title: "Will CLOB stay up?",
        outcome: "YES",
        side: "BUY",
        size_usdc: 10,
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
      statuses: ["open", "filled", "partial"],
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
      asset: "token-1",
      marketTitle: "Will CLOB stay up?",
      outcome: "YES",
      currentValue: 10,
      syncedAt: syncedAt.toISOString(),
      syncStale: false,
    });
    expect(json.closed_positions).toEqual([]);
    expect(mockListTenantPositions).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      statuses: ["open", "filled", "partial"],
      limit: 100,
    });
  });
});
