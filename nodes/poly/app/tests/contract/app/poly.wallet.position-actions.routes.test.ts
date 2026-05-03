// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/poly.wallet.position-actions.routes`
 * Purpose: Verify the tenant-scoped close/redeem route handlers validate input,
 *   delegate to the executor, and map executor failures to stable HTTP
 *   responses.
 * Scope: Route-only with mocked bootstrap deps. Does not hit Privy, Polygon, or
 *   Polymarket.
 * Invariants:
 *   - Close delegates to `exitPosition` with a generated client-order id.
 *   - Redeem delegates to `redeemResolvedPosition` with the requested
 *     condition id.
 *   - Executor authorization / redeemability failures map to 403 / 409.
 * Side-effects: none
 * Links: src/app/api/v1/poly/wallet/positions/close/route.ts,
 *        src/app/api/v1/poly/wallet/positions/redeem/route.ts
 * @internal
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT = { id: "billing-account-1" };

const mockGetPolyTradeExecutorFor = vi.fn();
const mockGetPolyTraderWalletAdapter = vi.fn();
const mockAccountsForUser = vi.fn();
const mockGetOrCreateBillingAccountForUser = vi.fn();
const mockGetAddress = vi.fn();
const mockInvalidateWalletAnalysisCaches = vi.fn();
const mockMarkPositionClosedByAsset = vi.fn();
const mockMarkPositionLifecycleByAsset = vi.fn();
const mockRedeemPipelineFor = vi.fn();
const mockRedeemJobsEnqueue = vi.fn();
const mockRedeemJobsFindByKey = vi.fn();
const mockResolveRedeemCandidatesForCondition = vi.fn();

class MockPolyTradeExecutorError extends Error {
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

vi.mock("@/bootstrap/capabilities/poly-trade-executor", () => ({
  createPolyTradeExecutorFactory: vi.fn(() => ({
    getPolyTradeExecutorFor: mockGetPolyTradeExecutorFor,
  })),
  PolyTradeExecutorError: MockPolyTradeExecutorError,
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    accountsForUser: mockAccountsForUser,
    redeemPipelineFor: mockRedeemPipelineFor,
    orderLedger: {
      markPositionClosedByAsset: mockMarkPositionClosedByAsset,
      markPositionLifecycleByAsset: mockMarkPositionLifecycleByAsset,
    },
  })),
}));

vi.mock("@/bootstrap/poly-trader-wallet", () => ({
  getPolyTraderWalletAdapter: mockGetPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError: class WalletAdapterUnconfiguredError extends Error {},
}));

vi.mock("@/shared/env/server-env", () => ({
  serverEnv: vi.fn(() => ({
    POLY_CLOB_HOST: "https://clob.polymarket.com",
    POLYGON_RPC_URL: "https://polygon.example",
  })),
}));

vi.mock("@/features/wallet-analysis/server/wallet-analysis-service", () => ({
  invalidateWalletAnalysisCaches: mockInvalidateWalletAnalysisCaches,
}));

vi.mock("@/features/redeem", () => ({
  resolveRedeemCandidatesForCondition: mockResolveRedeemCandidatesForCondition,
}));

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

function makeJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("poly wallet position action routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAccountsForUser.mockReturnValue({
      getOrCreateBillingAccountForUser: mockGetOrCreateBillingAccountForUser,
    });
    mockGetOrCreateBillingAccountForUser.mockResolvedValue(ACCOUNT);
    mockMarkPositionClosedByAsset.mockResolvedValue(1);
    mockMarkPositionLifecycleByAsset.mockResolvedValue(1);
    mockRedeemJobsEnqueue.mockResolvedValue({
      jobId: "redeem-job-1",
      alreadyExisted: false,
    });
    mockRedeemJobsFindByKey.mockResolvedValue(null);
    mockRedeemPipelineFor.mockReturnValue({
      funderAddress: "0xAbCdEf0000000000000000000000000000000001",
      redeemJobs: {
        enqueue: mockRedeemJobsEnqueue,
        findByKey: mockRedeemJobsFindByKey,
      },
    });
    mockGetAddress.mockResolvedValue(
      "0xAbCdEf0000000000000000000000000000000001"
    );
    mockGetPolyTraderWalletAdapter.mockReturnValue({
      getAddress: mockGetAddress,
    });
  });

  it("close route delegates to exitPosition and returns the contract-shaped receipt", async () => {
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      exitPosition: vi.fn().mockResolvedValue({
        order_id: "0xclose",
        status: "filled",
        client_order_id: "0xclient",
        filled_size_usdc: 1.25,
      }),
    });

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/positions/close/route"
    );
    const response = await POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/close", {
        token_id: "token-1",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      order_id: "0xclose",
      status: "filled",
      client_order_id: "0xclient",
      filled_size_usdc: 1.25,
    });
    expect(mockGetPolyTradeExecutorFor).toHaveBeenCalledWith(ACCOUNT.id);
    const executor = await mockGetPolyTradeExecutorFor.mock.results[0]?.value;
    expect(executor.exitPosition).toHaveBeenCalledWith({
      tokenId: "token-1",
      client_order_id: expect.stringMatching(/^0x[a-f0-9]{64}$/),
    });
    expect(mockMarkPositionClosedByAsset).not.toHaveBeenCalled();
    expect(mockGetAddress).toHaveBeenCalledWith(ACCOUNT.id);
    expect(mockInvalidateWalletAnalysisCaches).toHaveBeenCalledWith(
      "0xAbCdEf0000000000000000000000000000000001"
    );
  });

  it("close route maps executor authorization / no-position failures to 403 / 409", async () => {
    mockGetPolyTradeExecutorFor
      .mockResolvedValueOnce({
        exitPosition: vi
          .fn()
          .mockRejectedValue(
            new MockPolyTradeExecutorError(
              "not_authorized",
              "denied",
              "trading_not_ready"
            )
          ),
      })
      .mockResolvedValueOnce({
        exitPosition: vi
          .fn()
          .mockRejectedValue(
            new MockPolyTradeExecutorError(
              "no_position_to_close",
              "missing position"
            )
          ),
      });

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/positions/close/route"
    );

    const denied = await POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/close", {
        token_id: "token-1",
      })
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({
      error: "not_authorized",
      reason: "trading_not_ready",
    });

    const missing = await POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/close", {
        token_id: "token-1",
      })
    );
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toEqual({
      error: "no_position_to_close",
    });
  });

  it("close route marks sub-floor positions as dust instead of returning close_failed", async () => {
    const belowMarketMin = new Error("share balance below market floor");
    (belowMarketMin as { code?: string }).code = "BELOW_MARKET_MIN";
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      exitPosition: vi.fn().mockRejectedValue(belowMarketMin),
    });

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/positions/close/route"
    );
    const response = await POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/close", {
        token_id: "token-1",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      order_id: "",
      status: "dust",
      client_order_id: "",
      filled_size_usdc: 0,
    });
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "token-1",
      lifecycle: "dust",
      updated_at: expect.any(Date),
    });
    expect(mockInvalidateWalletAnalysisCaches).toHaveBeenCalledWith(
      "0xAbCdEf0000000000000000000000000000000001"
    );
  });

  it("rejects invalid JSON bodies before touching the executor", async () => {
    const { POST: closePost } = await import(
      "@/app/api/v1/poly/wallet/positions/close/route"
    );
    const { POST: redeemPost } = await import(
      "@/app/api/v1/poly/wallet/positions/redeem/route"
    );

    const badClose = await closePost(
      new Request("http://localhost/api/v1/poly/wallet/positions/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    );
    expect(badClose.status).toBe(400);
    await expect(badClose.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });

    const badRedeem = await redeemPost(
      new Request("http://localhost/api/v1/poly/wallet/positions/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    );
    expect(badRedeem.status).toBe(400);
    const body = await badRedeem.json();
    expect(body.error).toBe("Invalid input");
    expect(mockGetPolyTradeExecutorFor).not.toHaveBeenCalled();
  });

  it("still returns success when cache invalidation lookup fails", async () => {
    mockGetAddress.mockRejectedValueOnce(new Error("address lookup failed"));
    mockGetPolyTradeExecutorFor.mockResolvedValue({
      exitPosition: vi.fn().mockResolvedValue({
        order_id: "0xclose",
        status: "filled",
        client_order_id: "0xclient",
        filled_size_usdc: 1.25,
      }),
    });

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/positions/close/route"
    );
    const response = await POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/close", {
        token_id: "token-1",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      order_id: "0xclose",
      status: "filled",
      client_order_id: "0xclient",
      filled_size_usdc: 1.25,
    });
    expect(mockInvalidateWalletAnalysisCaches).not.toHaveBeenCalled();
  });

  it("redeem route mirrors winner and redeemed lifecycle into the ledger", async () => {
    vi.useFakeTimers();
    const conditionId =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const txHash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      {
        conditionId,
        positionId: 1n,
        outcomeIndex: 0,
        negativeRisk: false,
        collateralToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        decision: {
          kind: "redeem",
          flavor: "binary",
          indexSet: [1n],
          expectedShares: 1n,
          expectedPayoutUsdc: 1_000_000n,
        },
      },
    ]);
    mockRedeemJobsFindByKey.mockResolvedValue({
      id: "redeem-job-1",
      positionId: "1",
      status: "confirmed",
      txHashes: [txHash],
      errorClass: null,
      lastError: null,
    });

    const { POST } = await import(
      "@/app/api/v1/poly/wallet/positions/redeem/route"
    );
    const pending = POST(
      makeJsonRequest("http://localhost/api/v1/poly/wallet/positions/redeem", {
        condition_id: conditionId,
      })
    );
    await vi.advanceTimersByTimeAsync(500);
    const response = await pending;
    vi.useRealTimers();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tx_hash: txHash });
    expect(mockRedeemJobsEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionId,
        lifecycleState: "winner",
      })
    );
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "1",
      lifecycle: "winner",
      updated_at: expect.any(Date),
    });
    expect(mockMarkPositionLifecycleByAsset).toHaveBeenCalledWith({
      billing_account_id: ACCOUNT.id,
      token_id: "1",
      lifecycle: "redeemed",
      updated_at: expect.any(Date),
    });
  });
});
