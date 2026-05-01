// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/mirror-pipeline-already-resting.test`
 * Purpose: A second BUY fill on a market with an already-open mirror order
 *   skips with `reason='already_resting'` and never calls `placeIntent`.
 *   Covers the `hasOpenForMarket` fast-path gate AND the `AlreadyRestingError`
 *   DB-backstop conversion path. task.5001.
 * Side-effects: none
 * Links: src/features/copy-trade/mirror-pipeline.ts, work/items/task.5001
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
import { describe, expect, it, vi } from "vitest";
import { FakeOrderLedger } from "@/adapters/test";
import { runMirrorTick } from "@/features/copy-trade/mirror-pipeline";
import type { MirrorTargetConfig } from "@/features/copy-trade/types";
import {
  AlreadyRestingError,
  type LedgerRow,
  type OrderLedger,
  PositionCapReachedError,
} from "@/features/trading";
import type { WalletActivitySource } from "@/features/wallet-watch";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;
const MARKET_ID =
  "prediction-market:polymarket:0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374";

const MARKET_CONSTRAINTS = async () => ({
  minShares: 1,
  minUsdcNotional: 1,
  tickSize: 0.01,
});

const TARGET: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  created_by_user_id: TEST_USER_ID_1,
  mode: "live",
  sizing: { kind: "min_bet", max_usdc_per_trade: 5 },
  placement: { kind: "mirror_limit" },
};

function makeFill(fill_id: string, overrides?: Partial<Fill>): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id,
    source: "data-api",
    market_id: MARKET_ID,
    outcome: "YES",
    side: "BUY",
    price: 0.5,
    size_usdc: 1,
    observed_at: "2026-04-17T00:00:00.000Z",
    attributes: { asset: "12345" },
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

function makeOpenRow(fillId: string): LedgerRow {
  const now = new Date();
  return {
    target_id: TARGET_ID,
    fill_id: fillId,
    observed_at: now,
    client_order_id: clientOrderIdFor(TARGET_ID, fillId),
    order_id: "0xprior-order",
    status: "open",
    position_lifecycle: null,
    attributes: { market_id: MARKET_ID },
    synced_at: null,
    created_at: now,
    updated_at: now,
    billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  };
}

describe("runMirrorTick — already_resting", () => {
  it("hasOpenForMarket fast-path skips placement when prior open row exists", async () => {
    const ledger = new FakeOrderLedger({
      initial: [makeOpenRow("data-api:0xprior:0xasset:BUY:1713300000")],
    });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runMirrorTick({
      source: makeSource([makeFill("data-api:0xnew:0xasset:BUY:1713301000")]),
      ledger,
      placeIntent,
      target: TARGET,
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
      (d) => d.outcome === "skipped" && d.reason === "already_resting"
    );
    expect(skipDec).toBeDefined();
    const skipMetric = metrics.emissions.find(
      (e) =>
        e.name === "poly_mirror_decisions_total" &&
        e.labels?.outcome === "skipped" &&
        e.labels?.reason === "already_resting" &&
        e.labels?.placement === "limit"
    );
    expect(skipMetric).toBeDefined();
  });

  it("DB AlreadyRestingError thrown by insertPending also converts to skip/already_resting", async () => {
    // Stub a ledger whose `hasOpenForMarket` lies (returns false) so the
    // pipeline reaches `insertPending`, which then throws — proves the DB
    // backstop conversion path.
    const baseLedger = new FakeOrderLedger({});
    const ledger: OrderLedger = {
      ...baseLedger,
      hasOpenForMarket: async () => false,
      insertPending: async () => {
        throw new AlreadyRestingError(
          COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          TARGET_ID,
          MARKET_ID
        );
      },
      // bind methods that need `this`
      snapshotState: baseLedger.snapshotState.bind(baseLedger),
      cumulativeIntentForMarket:
        baseLedger.cumulativeIntentForMarket.bind(baseLedger),
      recordDecision: baseLedger.recordDecision.bind(baseLedger),
    };
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runMirrorTick({
      source: makeSource([makeFill("data-api:0xnew:0xasset:BUY:1713301000")]),
      ledger,
      placeIntent,
      target: TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    const skipDec = baseLedger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "already_resting"
    );
    expect(skipDec).toBeDefined();
  });

  it("DB PositionCapReachedError thrown by insertPending converts to skip/position_cap_reached", async () => {
    const baseLedger = new FakeOrderLedger({});
    const ledger: OrderLedger = {
      ...baseLedger,
      hasOpenForMarket: async () => false,
      insertPending: async () => {
        throw new PositionCapReachedError(
          COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          MARKET_ID,
          4,
          2,
          5
        );
      },
      snapshotState: baseLedger.snapshotState.bind(baseLedger),
      cumulativeIntentForMarket:
        baseLedger.cumulativeIntentForMarket.bind(baseLedger),
      recordDecision: baseLedger.recordDecision.bind(baseLedger),
    };
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runMirrorTick({
      source: makeSource([makeFill("data-api:0xnew:0xasset:BUY:1713301000")]),
      ledger,
      placeIntent,
      target: TARGET,
      getMarketConstraints: MARKET_CONSTRAINTS,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    const skipDec = baseLedger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "position_cap_reached"
    );
    expect(skipDec?.intent).toMatchObject({
      current_intent_usdc: 4,
      proposed_intent_usdc: 2,
      max_intent_usdc: 5,
    });
    const skipMetric = metrics.emissions.find(
      (e) =>
        e.name === "poly_mirror_decisions_total" &&
        e.labels?.outcome === "skipped" &&
        e.labels?.reason === "position_cap_reached" &&
        e.labels?.placement === "limit"
    );
    expect(skipMetric).toBeDefined();
  });
});
