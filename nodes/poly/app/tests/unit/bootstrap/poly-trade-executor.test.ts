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
  parseAbi: vi.fn(() => []),
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137 },
}));

import {
  _resetRedeemCooldownForTests,
  _resetSweepMutexForTests,
  createPolyTradeExecutorFactory,
} from "@/bootstrap/capabilities/poly-trade-executor";

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
    // bug.0384: module-scope cooldown + mutex must reset between tests
    // to prevent state leakage from one redeem call into the next.
    _resetRedeemCooldownForTests();
    _resetSweepMutexForTests();
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
        asset: "1",
        size: 2,
        curPrice: 1,
        conditionId: CONDITION_ID,
        outcome: "YES",
        outcomeIndex: 0,
        redeemable: true,
      },
    ]);
    // bug.0383 precheck: balance>0 AND payoutNumerator>0 → ok to redeem
    multicall.mockResolvedValue([
      { status: "success", result: 100n },
      { status: "success", result: 1n },
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
  // Data-API `redeemable` flag. bug.0383 adds a paired `payoutNumerators`
  // read and gates submission on it (skips losing-outcome no-ops). Each
  // candidate produces 2 multicall entries: [balanceOf, payoutNumerators].
  describe("redeemAllRedeemableResolvedPositions (bug.0376 + bug.0383 predicate)", () => {
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
          outcomeIndex: 0,
          redeemable: true,
        },
      ]);
      multicall.mockResolvedValue([
        { status: "success", result: 0n }, // balanceOf
        { status: "success", result: 1n }, // payoutNumerators (would-win)
      ]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([]);
      expect(multicall).toHaveBeenCalledTimes(1);
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("skips positions where payoutNumerator is zero (losing outcome) — bug.0383 gate", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 50,
          curPrice: 0,
          conditionId: CONDITION_A,
          outcome: "NO",
          outcomeIndex: 1,
          redeemable: true,
        },
      ]);
      multicall.mockResolvedValue([
        { status: "success", result: 50n }, // balanceOf > 0
        { status: "success", result: 0n }, // payoutNumerators[heldIdx] = 0 (losing)
      ]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([]);
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("skips positions where Data-API outcomeIndex is missing (bug.0383 fail-loud)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          // outcomeIndex intentionally absent — schema is now optional
          redeemable: true,
        },
      ]);
      // Predicate's missing-outcome guard fires before the read could matter,
      // but the multicall still runs for layout simplicity (placeholder idx=0).
      multicall.mockResolvedValue([
        { status: "success", result: 100n },
        { status: "success", result: 1n },
      ]);

      const { factory } = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);
      const result = await executor.redeemAllRedeemableResolvedPositions();

      expect(result).toEqual([]);
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("redeems positions where balance>0 AND payoutNumerator>0 (one writeContract per winner)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
        },
        {
          asset: "2",
          size: 3,
          curPrice: 0,
          conditionId: CONDITION_B,
          outcome: "NO",
          outcomeIndex: 1,
          redeemable: true,
        },
      ]);
      // 2N layout: [bal_A, num_A, bal_B, num_B]
      multicall.mockResolvedValue([
        { status: "success", result: 100n }, // A: balance > 0
        { status: "success", result: 1n }, // A: winner
        { status: "success", result: 50n }, // B: balance > 0
        { status: "success", result: 0n }, // B: loser → skip
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

    it("ignores Position.redeemable flag — sweep selects by chain truth, not Data-API", async () => {
      // bug.0376 regression gate: a position with redeemable=false MUST still
      // be enumerated and on-chain-checked. bug.0383 extends this with the
      // payoutNumerators gate.
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          outcomeIndex: 0,
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
        | { contracts: Array<{ functionName: string }> }
        | undefined;
      // 2N layout per candidate: balanceOf + payoutNumerators
      expect(call?.contracts).toHaveLength(2);
      expect(call?.contracts[0]?.functionName).toBe("balanceOf");
      expect(call?.contracts[1]?.functionName).toBe("payoutNumerators");
    });

    it("makes a single multicall regardless of position count (no per-position fan-out)", async () => {
      listUserPositions.mockResolvedValue([
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: false,
        },
        {
          asset: "2",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          outcomeIndex: 1,
          redeemable: false,
        },
      ]);
      multicall.mockResolvedValue([
        { status: "success", result: 0n },
        { status: "success", result: 0n },
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
      expect(call?.contracts).toHaveLength(4); // 2N
    });

    it("redeems every position when all balances are non-zero AND all winners (in order)", async () => {
      const positionList = [
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
        },
        {
          asset: "2",
          size: 3,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "NO",
          outcomeIndex: 1,
          redeemable: true,
        },
      ];
      listUserPositions.mockResolvedValue(positionList);
      // Sweep multicall (2N) + per-redeem precheck multicall (single 2)
      // Sweep enumerates 2 positions, sees both as winners, then for each
      // condition the manual route's precheck ALSO does its own 2-call
      // multicall before writeContract.
      multicall
        .mockResolvedValueOnce([
          { status: "success", result: 100n },
          { status: "success", result: 1n },
          { status: "success", result: 200n },
          { status: "success", result: 1n },
        ])
        .mockResolvedValueOnce([
          { status: "success", result: 100n },
          { status: "success", result: 1n },
        ])
        .mockResolvedValueOnce([
          { status: "success", result: 200n },
          { status: "success", result: 1n },
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

    it("skips positions where multicall element failed (read_failed); later successes still redeem", async () => {
      const positionList = [
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_A,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
        },
        {
          asset: "2",
          size: 1,
          curPrice: 1,
          conditionId: CONDITION_B,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
        },
      ];
      listUserPositions.mockResolvedValue(positionList);
      multicall
        .mockResolvedValueOnce([
          { status: "failure", error: new Error("rpc down") }, // bal_A failed
          { status: "success", result: 1n },
          { status: "success", result: 100n }, // bal_B ok
          { status: "success", result: 1n },
        ])
        // precheck inside redeemResolvedPosition for B
        .mockResolvedValueOnce([
          { status: "success", result: 100n },
          { status: "success", result: 1n },
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
          outcomeIndex: 0,
          redeemable: true,
        },
        {
          asset: "1",
          size: 1,
          curPrice: 1,
          conditionId: withoutPrefix,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
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
      expect(call?.contracts).toHaveLength(2); // one candidate × 2N
    });
  });

  // bug.0384 race regression: per-condition cooldown + sweep mutex.
  describe("redeemAllRedeemableResolvedPositions race guards (bug.0384)", () => {
    const CONDITION_W =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;

    function makeFactory() {
      const walletPort = makeWalletPort();
      vi.mocked(walletPort.getConnectionSummary).mockResolvedValue({
        connectionId: "connection-1",
        funderAddress: FUNDER,
        tradingApprovalsReadyAt: null,
      });
      return createPolyTradeExecutorFactory({
        walletPort,
        logger: makeLogger() as never,
        metrics: makeMetrics() as never,
        host: "https://clob.polymarket.com",
        polygonRpcUrl: "https://polygon.example",
      });
    }

    function winnerPositions() {
      return [
        {
          asset: "1",
          size: 5,
          curPrice: 1,
          conditionId: CONDITION_W,
          outcome: "YES",
          outcomeIndex: 0,
          redeemable: true,
        },
      ];
    }

    function winnerMulticall() {
      // 2N: balanceOf=100 (winner held), payoutNumerators=1 (winner)
      return [
        { status: "success", result: 100n },
        { status: "success", result: 1n },
      ];
    }

    it("cooldown: second sweep within 60s does not re-fire writeContract on the same condition", async () => {
      // Tick A: sweep finds winner, fires writeContract once, marks pending.
      // Tick B: same chain state (multicall still says balance>0 because
      // tx A hasn't mined). Cooldown short-circuits the candidate.
      listUserPositions.mockResolvedValue(winnerPositions());
      multicall.mockResolvedValue(winnerMulticall());
      writeContract.mockResolvedValue("0xtxA");

      const factory = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

      const a = await executor.redeemAllRedeemableResolvedPositions();
      expect(a).toEqual([{ condition_id: CONDITION_W, tx_hash: "0xtxA" }]);
      expect(writeContract).toHaveBeenCalledTimes(1);

      // Re-mock multicall (sweep B reads same pre-burn balance) — would
      // race-fire pre-bug.0384. Cooldown must skip.
      multicall.mockResolvedValue(winnerMulticall());
      const b = await executor.redeemAllRedeemableResolvedPositions();

      expect(b).toEqual([]); // no new redeem
      expect(writeContract).toHaveBeenCalledTimes(1); // still just one
    });

    it("cooldown lifts after 60s: same condition can fire again once expired", async () => {
      vi.useFakeTimers();
      try {
        listUserPositions.mockResolvedValue(winnerPositions());
        multicall.mockResolvedValue(winnerMulticall());
        writeContract.mockResolvedValue("0xtxA");

        const factory = makeFactory();
        const executor =
          await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

        await executor.redeemAllRedeemableResolvedPositions();
        expect(writeContract).toHaveBeenCalledTimes(1);

        // Advance past 60s cooldown window.
        vi.advanceTimersByTime(61_000);

        multicall.mockResolvedValue(winnerMulticall());
        writeContract.mockResolvedValue("0xtxC");
        const c = await executor.redeemAllRedeemableResolvedPositions();

        expect(c).toEqual([{ condition_id: CONDITION_W, tx_hash: "0xtxC" }]);
        expect(writeContract).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("mutex: concurrent sweep calls do not double-fire — second call short-circuits", async () => {
      // Two sweeps started before the first writeContract completes.
      // Without the mutex, both would compute the same predicate and both
      // would call writeContract. With the mutex, the second returns [].
      listUserPositions.mockResolvedValue(winnerPositions());
      multicall.mockResolvedValue(winnerMulticall());
      // Block the first writeContract until we release it manually so we
      // can definitively start a second sweep mid-way through the first.
      let releaseWrite!: (h: string) => void;
      const writePromise = new Promise<string>((res) => {
        releaseWrite = res;
      });
      writeContract.mockReturnValue(writePromise);

      const factory = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

      const sweepA = executor.redeemAllRedeemableResolvedPositions();
      // Yield once so sweepA's redeem path hits the awaited writeContract.
      await Promise.resolve();
      await Promise.resolve();
      const sweepB = executor.redeemAllRedeemableResolvedPositions();
      const b = await sweepB;
      // sweepB must have short-circuited via the mutex BEFORE doing any
      // multicall reads or writeContract calls.
      expect(b).toEqual([]);

      // Now let sweepA finish.
      releaseWrite("0xtxA");
      const a = await sweepA;
      expect(a).toEqual([{ condition_id: CONDITION_W, tx_hash: "0xtxA" }]);
      expect(writeContract).toHaveBeenCalledTimes(1);
    });

    it("manual redeemResolvedPosition rejects with pending_redeem after a recent sweep redeem", async () => {
      // Sweep fires for the winner → cooldown set.
      listUserPositions.mockResolvedValue(winnerPositions());
      multicall.mockResolvedValue(winnerMulticall());
      writeContract.mockResolvedValue("0xtxA");

      const factory = makeFactory();
      const executor =
        await factory.getPolyTradeExecutorFor(BILLING_ACCOUNT_ID);

      await executor.redeemAllRedeemableResolvedPositions();
      expect(writeContract).toHaveBeenCalledTimes(1);

      // Manual redeem on the same condition immediately after must reject.
      multicall.mockResolvedValue(winnerMulticall());
      await expect(
        executor.redeemResolvedPosition({ condition_id: CONDITION_W })
      ).rejects.toThrow(/redeem already pending/);
      expect(writeContract).toHaveBeenCalledTimes(1); // no new write
    });
  });
});
