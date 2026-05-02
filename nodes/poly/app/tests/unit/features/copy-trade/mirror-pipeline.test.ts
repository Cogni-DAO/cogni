// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/mirror-pipeline.test`
 * Purpose: Unit tests for `runMirrorTick()` — idempotent re-run, insert-then-crash resume, kill-switch off, empty-page, SELL discrimination, and happy path.
 * Scope: Pure — no DB, no network. Uses `FakeOrderLedger` + a stub `WalletActivitySource` + a spy `placeIntent`.
 * Invariants: INSERT_BEFORE_PLACE, IDEMPOTENT_BY_CLIENT_ID, RECORD_EVERY_DECISION.
 * Note: Daily / hourly cap assertions removed. Cap enforcement moved to
 *       `authorizeIntent` (CAPS_LIVE_IN_GRANT); those tests live on the
 *       adapter component test.
 * Side-effects: none
 * Links: src/features/copy-trade/mirror-pipeline.ts, work/items/task.0318 (Phase B3)
 * @internal
 */

import {
  clientOrderIdFor,
  createRecordingMetrics,
  type Fill,
  noopLogger,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/poly-market-provider";
import { COGNI_SYSTEM_BILLING_ACCOUNT_ID, TEST_USER_ID_1 } from "@tests/_fakes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeOrderLedger } from "@/adapters/test";
import {
  MIRROR_PIPELINE_METRICS,
  type OperatorPosition,
  runMirrorTick,
} from "@/features/copy-trade/mirror-pipeline";
import type { MirrorTargetConfig } from "@/features/copy-trade/types";
import type { WalletActivitySource } from "@/features/wallet-watch";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;

const BASE_TARGET: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  created_by_user_id: TEST_USER_ID_1,
  mode: "live",
  sizing: {
    kind: "min_bet",
    max_usdc_per_trade: 5,
  },
  placement: { kind: "mirror_limit" },
};
const MARKET_CONSTRAINTS = async () => ({
  minShares: 1,
  minUsdcNotional: 1,
});

function makeFill(overrides?: Partial<Fill>): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id: "data-api:0xabc:0xasset:BUY:1713302400",
    source: "data-api",
    market_id:
      "prediction-market:polymarket:0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
    outcome: "YES",
    side: "BUY",
    price: 0.5,
    size_usdc: 10,
    observed_at: "2026-04-17T00:00:00.000Z",
    attributes: {
      asset: "12345",
      condition_id:
        "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
    },
    ...overrides,
  };
}

function makeSource(fills: Fill[]): WalletActivitySource {
  return {
    async fetchSince() {
      return { fills, newSince: Math.floor(Date.now() / 1000) };
    },
  };
}

function makeReceipt(order_id: string, cid: string): OrderReceipt {
  return {
    order_id,
    client_order_id: cid,
    status: "open",
    filled_size_usdc: 0,
    submitted_at: new Date().toISOString(),
  };
}

function cidFor(fill: Fill, target_id = TARGET_ID): `0x${string}` {
  return clientOrderIdFor(target_id, fill.fill_id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — idempotent re-run: a fill already in the ledger produces zero
// re-placements and the decision is `skipped/already_placed`.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-pipeline.runMirrorTick — idempotent re-run", () => {
  it("skips a fill whose client_order_id is already in the ledger", async () => {
    const fill = makeFill();
    const cid = cidFor(fill);
    const ledger = new FakeOrderLedger({
      initial: [
        {
          target_id: TARGET_ID,
          fill_id: fill.fill_id,
          observed_at: new Date(fill.observed_at),
          client_order_id: cid,
          order_id: "0xpreviouslyplaced",
          status: "open",
          position_lifecycle: null,
          attributes: { size_usdc: 5 },
          created_at: new Date(),
          updated_at: new Date(),
          synced_at: null,
          billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
        },
      ],
    });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "already_placed"
    );
    expect(skipDec).toBeDefined();
    const skipMetric = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === MIRROR_PIPELINE_METRICS.decisionsTotal &&
        e.labels.outcome === "skipped" &&
        e.labels.reason === "already_placed"
    );
    expect(skipMetric).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — insert-then-crash resume.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-pipeline.runMirrorTick — crash resume", () => {
  it("insert-then-crash leaves a pending row; next tick skips as already_placed", async () => {
    const fill = makeFill();
    const ledger = new FakeOrderLedger();
    let cursor: number | undefined;
    const metrics = createRecordingMetrics();

    const placeIntent1 = vi.fn(async () => {
      throw new Error("CLOB rejected order: synthetic test failure");
    });
    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent: placeIntent1,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });
    expect(placeIntent1).toHaveBeenCalledTimes(1);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.status).toBe("error");

    const placeIntent2 = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent: placeIntent2,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });
    expect(placeIntent2).not.toHaveBeenCalled();
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "already_placed"
    );
    expect(skipDec).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — empty page.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-pipeline.runMirrorTick — empty source page", () => {
  it("returns cleanly and advances cursor even with zero fills", async () => {
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runMirrorTick({
      source: {
        async fetchSince() {
          return { fills: [], newSince: 9_999 };
        },
      },
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(ledger.decisions).toHaveLength(0);
    expect(cursor).toBe(9_999);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario F — SELL fill discrimination: close vs short.
// ─────────────────────────────────────────────────────────────────────────────

function makeSellFill(overrides?: Partial<Fill>): Fill {
  return makeFill({
    fill_id: "data-api:0xabc:0xasset:SELL:1713302500",
    side: "SELL",
    ...overrides,
  });
}

function makePosition(asset: string, size: number): OperatorPosition {
  return { asset, size };
}

describe("mirror-pipeline.runMirrorTick — SELL fill: no position → skip", () => {
  it("skips with sell_without_position when operator holds no position for the asset", async () => {
    const fill = makeSellFill({ attributes: { asset: "12345" } });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const closePosition =
      vi.fn<
        (p: {
          tokenId: string;
          max_size_usdc: number;
          limit_price: number;
          client_order_id: `0x${string}`;
        }) => Promise<OrderReceipt>
      >();
    const getOperatorPositions = vi
      .fn<() => Promise<OperatorPosition[]>>()
      .mockResolvedValue([]);

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
      closePosition,
      getOperatorPositions,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(closePosition).not.toHaveBeenCalled();
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "sell_without_position"
    );
    expect(skipDec).toBeDefined();
    expect(skipDec?.fill_id).toBe(fill.fill_id);
  });

  it("skips with sell_without_position when position exists but size=0", async () => {
    const fill = makeSellFill({ attributes: { asset: "12345" } });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const closePosition =
      vi.fn<
        (p: {
          tokenId: string;
          max_size_usdc: number;
          limit_price: number;
          client_order_id: `0x${string}`;
        }) => Promise<OrderReceipt>
      >();
    const getOperatorPositions = vi
      .fn<() => Promise<OperatorPosition[]>>()
      .mockResolvedValue([makePosition("12345", 0)]);

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
      closePosition,
      getOperatorPositions,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(closePosition).not.toHaveBeenCalled();
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "sell_without_position"
    );
    expect(skipDec).toBeDefined();
  });
});

describe("mirror-pipeline.runMirrorTick — SELL fill: has position → closePosition called", () => {
  it("calls closePosition with matching token_id and max_size_usdc=sizing ceiling, records placed/sell_closed_position", async () => {
    const TOKEN = "12345";
    const fill = makeSellFill({ attributes: { asset: TOKEN }, price: 0.75 });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const cid = cidFor(fill);
    const closeReceipt: OrderReceipt = makeReceipt("0xcloseorder", cid);
    const closePosition = vi
      .fn<
        (p: {
          tokenId: string;
          max_size_usdc: number;
          limit_price: number;
          client_order_id: `0x${string}`;
        }) => Promise<OrderReceipt>
      >()
      .mockResolvedValue(closeReceipt);
    const getOperatorPositions = vi
      .fn<() => Promise<OperatorPosition[]>>()
      .mockResolvedValue([makePosition(TOKEN, 10)]);

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
      closePosition,
      getOperatorPositions,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(closePosition).toHaveBeenCalledTimes(1);
    const callArgs = closePosition.mock.calls[0]?.[0];
    expect(callArgs?.tokenId).toBe(TOKEN);
    expect(callArgs?.max_size_usdc).toBe(BASE_TARGET.sizing.max_usdc_per_trade);
    expect(callArgs?.limit_price).toBe(fill.price);
    expect(callArgs?.client_order_id).toBe(cid);

    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.order_id).toBe("0xcloseorder");

    const placedDec = ledger.decisions.find((d) => d.outcome === "placed");
    expect(placedDec).toBeDefined();
    expect(placedDec?.reason).toBe("sell_closed_position");
    expect(placedDec?.receipt).toMatchObject({ order_id: "0xcloseorder" });
  });
});

describe("mirror-pipeline.runMirrorTick — SELL fill: deps absent → degrade to skip", () => {
  it("skips sell_without_position when closePosition dep is absent", async () => {
    const fill = makeSellFill({ attributes: { asset: "12345" } });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(ledger.rows).toHaveLength(0);
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "sell_without_position"
    );
    expect(skipDec).toBeDefined();
  });
});

describe("mirror-pipeline.runMirrorTick — BUY fill smoke", () => {
  it("BUY fill routes through placeIntent unchanged when SELL deps are present", async () => {
    const fill = makeFill();
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn(
      async (i: OrderIntent): Promise<OrderReceipt> =>
        makeReceipt("0xbuyorder", i.client_order_id)
    );
    const closePosition =
      vi.fn<
        (p: {
          tokenId: string;
          max_size_usdc: number;
          limit_price: number;
          client_order_id: `0x${string}`;
        }) => Promise<OrderReceipt>
      >();
    const getOperatorPositions = vi
      .fn<() => Promise<OperatorPosition[]>>()
      .mockResolvedValue([]);

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
      closePosition,
      getOperatorPositions,
    });

    expect(placeIntent).toHaveBeenCalledTimes(1);
    expect(closePosition).not.toHaveBeenCalled();
    expect(getOperatorPositions).not.toHaveBeenCalled();
    const placedDec = ledger.decisions.find((d) => d.outcome === "placed");
    expect(placedDec).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path — one fill → one placement, decisions ledger records `placed`.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-pipeline.runMirrorTick — happy path", () => {
  let ledger: FakeOrderLedger;
  let placeIntent: ReturnType<
    typeof vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>
  >;

  beforeEach(() => {
    ledger = new FakeOrderLedger();
    placeIntent = vi.fn(
      async (i: OrderIntent): Promise<OrderReceipt> =>
        makeReceipt("0xorderabc", i.client_order_id)
    );
  });

  it("inserts pending before placing, then marks order_id on receipt", async () => {
    const fill = makeFill();
    const metrics = createRecordingMetrics();

    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).toHaveBeenCalledTimes(1);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.order_id).toBe("0xorderabc");
    expect(ledger.rows[0]?.status).toBe("open");
    const placedDec = ledger.decisions.find((d) => d.outcome === "placed");
    expect(placedDec).toBeDefined();
    expect(placedDec?.receipt).toMatchObject({ order_id: "0xorderabc" });
  });

  it("client_order_id is deterministic from (target_id, fill_id)", async () => {
    const fill = makeFill();
    await runMirrorTick({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    const expectedCid = clientOrderIdFor(TARGET_ID, fill.fill_id);
    expect(ledger.rows[0]?.client_order_id).toBe(expectedCid);
    expect(placeIntent.mock.calls[0]?.[0].client_order_id).toBe(expectedCid);
  });
});
