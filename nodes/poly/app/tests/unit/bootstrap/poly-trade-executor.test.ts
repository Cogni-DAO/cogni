// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { OrderReceipt } from "@cogni/poly-market-provider";
import type { PolyTraderWalletPort } from "@cogni/poly-wallet";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listUserPositions = vi.fn();
const placeOrder = vi.fn();
const sellPositionAtMarket = vi.fn();
const getOrder = vi.fn();
const getMarketConstraints = vi.fn();
const listOpenOrders = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();
const multicall = vi.fn();
const readContract = vi.fn();
const createOrDeriveApiKey = vi.fn();
const clobClientV1Constructor = vi.fn();

vi.mock("@cogni/poly-market-provider/adapters/polymarket", () => {
  class FakePolymarketClobAdapter {
    placeOrder = placeOrder;
    sellPositionAtMarket = sellPositionAtMarket;
    getOrder = getOrder;
    getMarketConstraints = getMarketConstraints;
    listOpenOrders = listOpenOrders;
  }

  class FakePolymarketDataApiClient {
    listUserPositions = listUserPositions;
  }

  return {
    normalizePolygonConditionId: (raw: string) =>
      (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`,
    PARENT_COLLECTION_ID_ZERO:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as const,
    POLYGON_CONDITIONAL_TOKENS:
      "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const,
    POLYGON_USDC_E: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const,
    PolymarketClobAdapter: FakePolymarketClobAdapter,
    PolymarketDataApiClient: FakePolymarketDataApiClient,
    withSanitizedClobSdkConsoleErrors: <T>(fn: () => T) => fn(),
    polymarketCtfRedeemAbi: [],
  };
});

vi.mock("@polymarket/clob-client", () => ({
  ClobClient: class FakeClobClient {
    constructor(...args: unknown[]) {
      clobClientV1Constructor(...args);
    }

    createOrDeriveApiKey = createOrDeriveApiKey;
  },
}));

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({ writeContract })),
  createPublicClient: vi.fn(() => ({
    waitForTransactionReceipt,
    multicall,
    readContract,
  })),
  http: vi.fn(() => "transport"),
  formatUnits: vi.fn((value: bigint, decimals: number) =>
    (Number(value) / 10 ** decimals).toString()
  ),
  parseAbi: vi.fn(() => []),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
}));

import {
  classifyClobCredentialRotationError,
  createOrDerivePolymarketApiKeyForSigner,
  normalizePolymarketApiKeyCreds,
} from "@/bootstrap/capabilities/poly-clob-creds";
import { createPolyTradeExecutorFactory } from "@/bootstrap/capabilities/poly-trade-executor";

const BILLING_ACCOUNT_ID = "billing-account-1";
const FUNDER = "0x1111111111111111111111111111111111111111" as const;
const CONDITION_ID =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;

function makeLogger() {
  return {
    child() {
      return this;
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function makeMetrics() {
  return {
    incr() {},
    observeDurationMs() {},
  };
}

function makeWalletPort(): PolyTraderWalletPort {
  return {
    resolve: vi.fn().mockResolvedValue({
      account: { address: FUNDER },
      clobCreds: {
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      },
      funderAddress: FUNDER,
      connectionId: "connection-1",
    }),
    getAddress: vi.fn().mockResolvedValue(FUNDER),
    getConnectionSummary: vi.fn().mockResolvedValue({
      connectionId: "connection-1",
      funderAddress: FUNDER,
      tradingApprovalsReadyAt: new Date("2026-04-23T00:00:00.000Z"),
      autoWrapConsentAt: null,
      autoWrapFloorUsdceAtomic: 1_000_000n,
    }),
    getBalances: vi.fn(),
    provision: vi.fn(),
    revoke: vi.fn(),
    authorizeIntent: vi.fn().mockResolvedValue({
      ok: true,
      context: {
        account: { address: FUNDER },
        clobCreds: {
          key: "key",
          secret: "secret",
          passphrase: "passphrase",
        },
        funderAddress: FUNDER,
        connectionId: "connection-1",
        grantId: "grant-1",
        authorizedIntent: {
          side: "SELL",
          usdcAmount: 1,
          marketConditionId: CONDITION_ID,
        },
      },
    }),
    withdraw: vi.fn(),
    rotateClobCreds: vi.fn(),
    ensureTradingApprovals: vi.fn(),
  } as unknown as PolyTraderWalletPort;
}

describe("createPolyTradeExecutorFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUserPositions.mockReset();
    placeOrder.mockReset();
    sellPositionAtMarket.mockReset();
    getOrder.mockReset();
    getMarketConstraints.mockReset();
    listOpenOrders.mockReset();
    createOrDeriveApiKey.mockReset();
    clobClientV1Constructor.mockReset();
    writeContract.mockReset();
    waitForTransactionReceipt.mockReset();
    multicall.mockReset();
    readContract.mockReset();
    getMarketConstraints.mockResolvedValue({ minShares: 1 });
    listOpenOrders.mockResolvedValue([]);
    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("exitPosition sells the wallet's full share balance via market order without grant-cap authorization", async () => {
    listUserPositions.mockResolvedValue([
      {
        asset: "token-1",
        size: 5,
        curPrice: 0.25,
        conditionId: CONDITION_ID,
        outcome: "YES",
        redeemable: false,
      },
    ]);
    const receipt: OrderReceipt = {
      order_id: "0xexit",
      client_order_id: "0xclient",
      status: "filled",
      filled_size_usdc: 1.25,
      submitted_at: "2026-04-23T00:00:00.000Z",
    };
    sellPositionAtMarket.mockResolvedValue(receipt);
    const walletPort = makeWalletPort();

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    const result = await executor.exitPosition({
      tokenId: "token-1",
      client_order_id: "0xclient",
    });

    expect(result).toEqual(receipt);
    expect(sellPositionAtMarket).toHaveBeenCalledWith({
      tokenId: "token-1",
      shares: 5,
      client_order_id: "0xclient",
      orderType: "FAK",
    });
    expect(sellPositionAtMarket).toHaveBeenCalledTimes(1);
    expect(listUserPositions).toHaveBeenCalledTimes(1);
    expect(walletPort.authorizeIntent).not.toHaveBeenCalled();
  });

  it("exitPosition returns an accepted pending market sell without retrying the same shares", async () => {
    listUserPositions.mockResolvedValue([
      {
        asset: "token-1",
        size: 5,
        curPrice: 0.25,
        conditionId: CONDITION_ID,
        outcome: "YES",
        redeemable: false,
      },
    ]);
    const receipt: OrderReceipt = {
      order_id: "0xexit",
      client_order_id: "0xclient",
      status: "pending",
      filled_size_usdc: 0,
      submitted_at: "2026-04-23T00:00:00.000Z",
    };
    sellPositionAtMarket.mockResolvedValue(receipt);
    const walletPort = makeWalletPort();

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    const result = await executor.exitPosition({
      tokenId: "token-1",
      client_order_id: "0xclient",
    });

    expect(result).toEqual(receipt);
    expect(sellPositionAtMarket).toHaveBeenCalledTimes(1);
    expect(listUserPositions).toHaveBeenCalledTimes(1);
  });

  it("exitPosition reads on-chain CTF balance when Data API omits a legacy holding", async () => {
    listUserPositions.mockResolvedValue([]);
    readContract.mockResolvedValue(4_898_000n);
    const receipt: OrderReceipt = {
      order_id: "0xexit",
      client_order_id: "0xclient",
      status: "filled",
      filled_size_usdc: 4.8,
      submitted_at: "2026-04-23T00:00:00.000Z",
    };
    sellPositionAtMarket.mockResolvedValue(receipt);
    const walletPort = makeWalletPort();

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    const result = await executor.exitPosition({
      tokenId: "123",
      client_order_id: "0xclient",
    });

    expect(result).toEqual(receipt);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "balanceOf",
        args: [FUNDER, 123n],
      })
    );
    expect(sellPositionAtMarket).toHaveBeenCalledWith({
      tokenId: "123",
      shares: 4.898,
      client_order_id: "0xclient",
      orderType: "FAK",
    });
  });

  it("exitPosition reads on-chain CTF balance when Data API reports sub-floor shares", async () => {
    listUserPositions.mockResolvedValue([
      {
        asset: "123",
        size: 0.67,
        curPrice: 0.25,
        conditionId: CONDITION_ID,
        outcome: "YES",
        redeemable: false,
      },
    ]);
    readContract.mockResolvedValue(4_898_000n);
    getMarketConstraints.mockResolvedValue({ minShares: 1 });
    const receipt: OrderReceipt = {
      order_id: "0xexit",
      client_order_id: "0xclient",
      status: "filled",
      filled_size_usdc: 4.8,
      submitted_at: "2026-04-23T00:00:00.000Z",
    };
    sellPositionAtMarket.mockResolvedValue(receipt);
    const walletPort = makeWalletPort();

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    const result = await executor.exitPosition({
      tokenId: "123",
      client_order_id: "0xclient",
    });

    expect(result).toEqual(receipt);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "balanceOf",
        args: [FUNDER, 123n],
      })
    );
    expect(sellPositionAtMarket).toHaveBeenCalledWith({
      tokenId: "123",
      shares: 4.898,
      client_order_id: "0xclient",
      orderType: "FAK",
    });
  });

  it("exitPosition self-heals trading approvals when the readiness stamp is missing", async () => {
    listUserPositions
      .mockResolvedValueOnce([
        {
          asset: "token-1",
          size: 2,
          curPrice: 0.4,
          conditionId: CONDITION_ID,
          outcome: "YES",
          redeemable: false,
        },
      ])
      .mockResolvedValueOnce([]);
    sellPositionAtMarket.mockResolvedValue({
      order_id: "0xexit",
      client_order_id: "0xclient",
      status: "filled",
      filled_size_usdc: 0.8,
      submitted_at: "2026-04-23T00:00:00.000Z",
    });
    const walletPort = makeWalletPort();
    vi.mocked(walletPort.getConnectionSummary).mockResolvedValue({
      connectionId: "connection-1",
      funderAddress: FUNDER,
      tradingApprovalsReadyAt: null,
      autoWrapConsentAt: null,
      autoWrapFloorUsdceAtomic: 1_000_000n,
    });
    vi.mocked(walletPort.ensureTradingApprovals).mockResolvedValue({
      ready: true,
      address: FUNDER,
      polBalance: 1,
      steps: [],
      readyAt: new Date("2026-04-23T00:00:00.000Z"),
    });

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    await executor.exitPosition({
      tokenId: "token-1",
      client_order_id: "0xclient",
    });

    expect(walletPort.ensureTradingApprovals).toHaveBeenCalledWith(
      BILLING_ACCOUNT_ID
    );
    expect(sellPositionAtMarket).toHaveBeenCalledWith({
      tokenId: "token-1",
      shares: 2,
      client_order_id: "0xclient",
      orderType: "FAK",
    });
  });

  it("closePosition caps SELL notional at the requested limit price so it never oversells shares", async () => {
    listUserPositions.mockResolvedValue([
      {
        asset: "token-1",
        size: 5,
        curPrice: 0.3,
        conditionId: CONDITION_ID,
        outcome: "YES",
        redeemable: false,
      },
    ]);
    placeOrder.mockResolvedValue({
      order_id: "0xclose",
      client_order_id: "0xclient",
      status: "open",
      filled_size_usdc: 0,
      submitted_at: "2026-04-23T00:00:00.000Z",
    });
    const walletPort = makeWalletPort();

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    await executor.closePosition({
      tokenId: "token-1",
      max_size_usdc: 1.5,
      limit_price: 0.2,
      client_order_id: "0xclient",
    });

    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(placeOrder.mock.calls[0]?.[0]).toMatchObject({
      side: "SELL",
      limit_price: 0.2,
      size_usdc: 1,
    });
    expect(walletPort.authorizeIntent).toHaveBeenCalledTimes(1);
  });
});

describe("createOrDerivePolymarketApiKeyForSigner", () => {
  it("uses the manually verified v1 CLOB client boundary for provisioning credentials", async () => {
    createOrDeriveApiKey.mockResolvedValue({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });

    await expect(
      createOrDerivePolymarketApiKeyForSigner({
        signer: { address: FUNDER } as never,
        polygonRpcUrl: "https://polygon.example",
        geoBlockToken: "geo-token",
        host: "https://clob.polymarket.com",
      })
    ).resolves.toEqual({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });

    expect(clobClientV1Constructor).toHaveBeenCalledWith(
      "https://clob.polymarket.com",
      137,
      { writeContract },
      undefined,
      undefined,
      undefined,
      "geo-token",
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(createOrDeriveApiKey).toHaveBeenCalledTimes(1);
  });
});

describe("classifyClobCredentialRotationError", () => {
  it("classifies Polymarket Cloudflare blocks distinctly from normal 403s", () => {
    const err = Object.assign(
      new Error(
        'Sorry, you have been blocked. Cloudflare Ray ID: <strong class="font-semibold">9f63041f8df7cc1e</strong>'
      ),
      { status: 403 }
    );

    expect(classifyClobCredentialRotationError(err)).toEqual({
      reasonCode: "clob_cloudflare_blocked",
      httpStatus: 403,
      errorClass: "Error",
      cloudflareRayId: "9f63041f8df7cc1e",
    });
  });
});

describe("normalizePolymarketApiKeyCreds", () => {
  it("keeps plain v2 SDK credentials JSON-serializable before storage", () => {
    expect(
      normalizePolymarketApiKeyCreds({
        key: "key",
        secret: "secret",
        passphrase: "passphrase",
      })
    ).toEqual({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });
  });

  it("accepts raw REST credential shape and maps apiKey to key", () => {
    expect(
      normalizePolymarketApiKeyCreds({
        apiKey: "key",
        secret: "secret",
        passphrase: "passphrase",
      })
    ).toEqual({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });
  });

  it("rejects error-shaped or empty credential responses before encryption", () => {
    expect(() =>
      normalizePolymarketApiKeyCreds({ error: "could not derive api key" })
    ).toThrow(
      "Polymarket CLOB API credentials response missing key, secret, or passphrase"
    );
    expect(() => normalizePolymarketApiKeyCreds({})).toThrow(
      "Polymarket CLOB API credentials response missing key, secret, or passphrase"
    );
  });
});
