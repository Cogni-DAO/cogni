// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/poly.wallet.withdraw.route`
 * Purpose: Verify the trading-wallet withdrawal route validates the
 *   confirmation envelope, delegates to the tenant wallet adapter, and maps
 *   adapter failures to stable HTTP responses.
 * Scope: Route-only with mocked bootstrap deps. Does not hit Privy, Polygon,
 *   or Polymarket.
 * Invariants: TENANT_SCOPED; IRREVERSIBLE_CONFIRMATION_REQUIRED;
 *   NO_GENERIC_SIGNING.
 * Side-effects: none
 * Links: src/app/api/v1/poly/wallet/withdraw/route.ts
 * @internal
 */

import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_USER = { id: "11111111-1111-4111-8111-111111111111" };
const ACCOUNT = { id: "billing-account-1" };
const DESTINATION = "0x3333333333333333333333333333333333333333";
const CASED_DESTINATION = "0xabcdef0000000000000000000000000000000001";
const SOURCE = "0x1111111111111111111111111111111111111111";
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const mockGetPolyTraderWalletAdapter = vi.fn();
const mockAccountsForUser = vi.fn();
const mockGetOrCreateBillingAccountForUser = vi.fn();
const mockWithdraw = vi.fn();
const mockInvalidateWalletAnalysisCaches = vi.fn();

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
  })),
}));

vi.mock("@/bootstrap/poly-trader-wallet", () => ({
  getPolyTraderWalletAdapter: mockGetPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError: class WalletAdapterUnconfiguredError extends Error {},
}));

vi.mock("@/features/wallet-analysis/server/wallet-analysis-service", () => ({
  invalidateWalletAnalysisCaches: mockInvalidateWalletAnalysisCaches,
}));

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

function makeJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/poly/wallet/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    asset: "pusd",
    destination: DESTINATION,
    amount_atomic: "2500000",
    confirmation: {
      asset: "pusd",
      destination: DESTINATION,
      amount_atomic: "2500000",
      irreversible: true,
    },
    ...overrides,
  };
}

describe("poly wallet withdraw route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAccountsForUser.mockReturnValue({
      getOrCreateBillingAccountForUser: mockGetOrCreateBillingAccountForUser,
    });
    mockGetOrCreateBillingAccountForUser.mockResolvedValue(ACCOUNT);
    mockWithdraw.mockResolvedValue({
      asset: "pusd",
      deliveredAsset: "usdc_e",
      sourceAddress: SOURCE,
      destination: DESTINATION,
      amountAtomic: 2500000n,
      primaryTxHash: TX_HASH,
      txHashes: [TX_HASH],
    });
    mockGetPolyTraderWalletAdapter.mockReturnValue({
      withdraw: mockWithdraw,
    });
  });

  it("delegates typed pUSD withdrawal and returns the contract-shaped receipt", async () => {
    const { POST } = await import("@/app/api/v1/poly/wallet/withdraw/route");
    const response = await POST(makeJsonRequest(validBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asset: "pusd",
      delivered_asset: "usdc_e",
      source_address: SOURCE,
      destination: DESTINATION,
      amount_atomic: "2500000",
      primary_tx_hash: TX_HASH,
      tx_hashes: [TX_HASH],
    });
    expect(mockWithdraw).toHaveBeenCalledWith({
      billingAccountId: ACCOUNT.id,
      asset: "pusd",
      destination: DESTINATION,
      amountAtomic: 2500000n,
      requestedByUserId: SESSION_USER.id,
    });
    expect(mockInvalidateWalletAnalysisCaches).toHaveBeenCalledWith(SOURCE);
  });

  it("rejects confirmation mismatches before adapter delegation", async () => {
    const { POST } = await import("@/app/api/v1/poly/wallet/withdraw/route");
    const response = await POST(
      makeJsonRequest(
        validBody({
          confirmation: {
            asset: "pusd",
            destination: "0x4444444444444444444444444444444444444444",
            amount_atomic: "2500000",
            irreversible: true,
          },
        })
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "confirmation_mismatch",
    });
    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it("accepts checksum-case differences in the repeated destination", async () => {
    const { POST } = await import("@/app/api/v1/poly/wallet/withdraw/route");
    const response = await POST(
      makeJsonRequest(
        validBody({
          destination: CASED_DESTINATION,
          confirmation: {
            asset: "pusd",
            destination: `0x${CASED_DESTINATION.slice(2).toUpperCase()}`,
            amount_atomic: "2500000",
            irreversible: true,
          },
        })
      )
    );

    expect(response.status).toBe(200);
    expect(mockWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: getAddress(CASED_DESTINATION),
      })
    );
  });

  it("maps no-connection and insufficient-balance adapter failures", async () => {
    mockWithdraw
      .mockRejectedValueOnce(
        Object.assign(new Error("missing connection"), {
          code: "no_connection",
        })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("short balance"), {
          code: "insufficient_balance",
        })
      );

    const { POST } = await import("@/app/api/v1/poly/wallet/withdraw/route");

    const noConnection = await POST(makeJsonRequest(validBody()));
    expect(noConnection.status).toBe(409);
    await expect(noConnection.json()).resolves.toEqual({
      error: "no_active_connection",
    });

    const insufficient = await POST(makeJsonRequest(validBody()));
    expect(insufficient.status).toBe(409);
    await expect(insufficient.json()).resolves.toEqual({
      error: "insufficient_balance",
    });
  });
});
