// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { OrderReceipt } from "@cogni/market-provider";
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

vi.mock("@cogni/market-provider/adapters/polymarket", () => {
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
    BINARY_REDEEM_INDEX_SETS: [1n, 2n] as const,
    normalizePolygonConditionId: (raw: string) =>
      (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`,
    PARENT_COLLECTION_ID_ZERO:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as const,
    POLYGON_CONDITIONAL_TOKENS:
      "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const,
    POLYGON_USDC_E: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const,
    PolymarketClobAdapter: FakePolymarketClobAdapter,
    PolymarketDataApiClient: FakePolymarketDataApiClient,
    polymarketCtfRedeemAbi: [],
  };
});

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({ writeContract })),
  createPublicClient: vi.fn(() => ({ waitForTransactionReceipt, multicall })),
  http: vi.fn(() => "transport"),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
}));

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
    withdrawUsdc: vi.fn(),
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
    writeContract.mockReset();
    waitForTransactionReceipt.mockReset();
    multicall.mockReset();
    getMarketConstraints.mockResolvedValue({ minShares: 1 });
    listOpenOrders.mockResolvedValue([]);
    waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("exitPosition sells the wallet's full share balance via market order without grant-cap authorization", async () => {
    listUserPositions
      .mockResolvedValueOnce([
        {
          asset: "token-1",
          size: 5,
          curPrice: 0.25,
          conditionId: CONDITION_ID,
          outcome: "YES",
          redeemable: false,
        },
      ])
      .mockResolvedValueOnce([]);
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
    expect(walletPort.authorizeIntent).not.toHaveBeenCalled();
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

  it("redeemResolvedPosition requires only an active tenant wallet connection, not grant authorization or trading approvals", async () => {
    listUserPositions.mockResolvedValue([
      {
        asset: "token-1",
        size: 2,
        curPrice: 1,
        conditionId: CONDITION_ID,
        outcome: "YES",
        redeemable: true,
      },
    ]);
    writeContract.mockResolvedValue("0xtxhash");
    const walletPort = makeWalletPort();
    vi.mocked(walletPort.getConnectionSummary).mockResolvedValue({
      connectionId: "connection-1",
      funderAddress: FUNDER,
      tradingApprovalsReadyAt: null,
    });

    const factory = createPolyTradeExecutorFactory({
      walletPort,
      logger: makeLogger() as never,
      metrics: makeMetrics() as never,
      host: "https://clob.polymarket.com",
      polygonRpcUrl: "https://polygon.example",
    });
    const executor = await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

    const result = await executor.redeemResolvedPosition({
      condition_id: CONDITION_ID,
    });

    expect(result).toEqual({ tx_hash: "0xtxhash" });
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(walletPort.authorizeIntent).not.toHaveBeenCalled();
  });

  // bug.0376: redeem sweep predicate is on-chain ERC1155 balance, not the
  // Data-API `redeemable` flag.
  describe("redeemAllRedeemableResolvedPositions (bug.0376 predicate)", () => {
    const CONDITION_A =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const CONDITION_B =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

    function makeFactory() {
      const walletPort = makeWalletPort();
      vi.mocked(walletPort.getConnectionSummary).mockResolvedValue({
        connectionId: "connection-1",
        funderAddress: FUNDER,
        tradingApprovalsReadyAt: null,
      });
      return {
        walletPort,
        factory: createPolyTradeExecutorFactory({
          walletPort,
          logger: makeLogger() as never,
          metrics: makeMetrics() as never,
          host: "https://clob.polymarket.com",
          polygonRpcUrl: "https://polygon.example",
        }),
      };
    }

    it("skips positions where on-chain ERC1155 balance is zero (no writeContract call)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: true,
        },
      ]);
      multicall.mockResolvedValue([{ status: "success", result: 0n }]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([]);
      expect(multicall).toHaveBeenCalledTimes(1);
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("redeems positions where balance > 0 (one writeContract per non-zero)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: true,
        },
        {
          asset: "2",
          size: 3,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          redeemable: true,
        },
      ]);
      multicall.mockResolvedValue([
        { status: "success", result: 100n },
        { status: "success", result: 0n },
      ]);
      // Sweep re-reads positions inside `redeemResolvedPosition` to look up
      // the per-condition match — return both positions for that lookup too.
      listUserPositions.mockResolvedValueOnce([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: true,
        },
        {
          asset: "2",
          size: 3,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          redeemable: true,
        },
      ]);
      writeContract.mockResolvedValue("0xredeemA");

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([
        { condition_id: CONDITION_A, tx_hash: "0xredeemA" },
      ]);
      expect(writeContract).toHaveBeenCalledTimes(1);
    });

    it("ignores Position.redeemable flag — sweep selects positions by balance, not by redeemable=true", async () => {
      // The bug being fixed: the sweep used to filter on `p.redeemable`
      // (Data-API) and submit `redeemPositions` even when the funder had
      // zero balance. The fix flips the predicate to on-chain balance and
      // drops the `redeemable` check entirely. Regression gate: a position
      // with redeemable=false MUST still be enumerated and balanceOf'd.
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: false,
        },
      ]);
      multicall.mockResolvedValue([{ status: "success", result: 0n }]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      await executor.redeemAllRedeemableResolvedPositions();

      // The sweep called multicall WITH this position (predicate inverted).
      expect(multicall).toHaveBeenCalledTimes(1);
      const call = multicall.mock.calls[0]?.[0] as
        | { contracts: Array<{ args: readonly [unknown, unknown] }> }
        | undefined;
      expect(call?.contracts).toHaveLength(1);
      expect(call?.contracts[0]?.args[1]).toBe(1n);
    });

    it("makes a single multicall regardless of position count (no per-position eth_call fan-out)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: false,
        },
        {
          asset: "2",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          redeemable: false,
        },
      ]);
      multicall.mockResolvedValue([
        { status: "success", result: 0n },
        { status: "success", result: 0n },
      ]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      await executor.redeemAllRedeemableResolvedPositions();

      expect(multicall).toHaveBeenCalledTimes(1);
      const call = multicall.mock.calls[0]?.[0] as
        | { contracts: Array<unknown> }
        | undefined;
      expect(call?.contracts).toHaveLength(2);
    });

    it("redeems every position when all balances are non-zero (in order)", async () => {
      const positionList = [
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: true,
        },
        {
          asset: "2",
          size: 3,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          redeemable: true,
        },
      ];
      // First call (sweep enumeration) + two re-fetches inside
      // redeemResolvedPosition's per-condition match.
      listUserPositions.mockResolvedValue(positionList);
      multicall.mockResolvedValue([
        { status: "success", result: 100n },
        { status: "success", result: 200n },
      ]);
      writeContract
        .mockResolvedValueOnce("0xredeemA")
        .mockResolvedValueOnce("0xredeemB");

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([
        { condition_id: CONDITION_A, tx_hash: "0xredeemA" },
        { condition_id: CONDITION_B, tx_hash: "0xredeemB" },
      ]);
      expect(writeContract).toHaveBeenCalledTimes(2);
    });

    it("skips positions where balanceOf multicall element failed; later successes still redeem", async () => {
      const positionList = [
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          redeemable: true,
        },
        {
          asset: "2",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          redeemable: true,
        },
      ];
      listUserPositions.mockResolvedValue(positionList);
      multicall.mockResolvedValue([
        { status: "failure", error: new Error("rpc down") },
        { status: "success", result: 100n },
      ]);
      writeContract.mockResolvedValue("0xredeemB");

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([
        { condition_id: CONDITION_B, tx_hash: "0xredeemB" },
      ]);
      expect(writeContract).toHaveBeenCalledTimes(1);
    });

    it("returns immediately without multicall when there are no candidate positions", async () => {
      listUserPositions.mockResolvedValue([]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([]);
      expect(multicall).not.toHaveBeenCalled();
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("dedupes by normalized conditionId — same id with/without 0x prefix collapses to one entry", async () => {
      const hex = "a".repeat(64);
      const withPrefix = `0x${hex}` as `0x${string}`;
      const withoutPrefix = hex;
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: withPrefix,
          outcome: "YES",
          redeemable: true,
        },
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: withoutPrefix,
          outcome: "YES",
          redeemable: true,
        },
      ]);
      multicall.mockResolvedValue([{ status: "success", result: 0n }]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      await executor.redeemAllRedeemableResolvedPositions();

      expect(multicall).toHaveBeenCalledTimes(1);
      const call = multicall.mock.calls[0]?.[0] as
        | { contracts: Array<unknown> }
        | undefined;
      expect(call?.contracts).toHaveLength(1);
    });
  });
});
