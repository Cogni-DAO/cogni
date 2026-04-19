// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/mirror-coordinator.test`
 * Purpose: Unit tests for `runOnce()` — covers the 5 Phase 1 scenarios: idempotent re-run, insert-then-crash resume, kill-switch off, empty-tx propagation, and cap-hit branches.
 * Scope: Pure — no DB, no network. Uses `FakeOrderLedger` + a stub `WalletActivitySource` + a spy `placeIntent`.
 * Invariants: INSERT_BEFORE_PLACE, IDEMPOTENT_BY_CLIENT_ID, RECORD_EVERY_DECISION.
 * Side-effects: none
 * Links: src/features/copy-trade/mirror-coordinator.ts, docs/spec/poly-copy-trade-phase1.md
 * @internal
 */

import {
  clientOrderIdFor,
  createRecordingMetrics,
  type Fill,
  noopLogger,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/market-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrderLedger } from "@/adapters/test";
import {
  MIRROR_COORDINATOR_METRICS,
  runOnce,
} from "@/features/copy-trade/mirror-coordinator";
import type { TargetConfig } from "@/features/copy-trade/types";
import type { WalletActivitySource } from "@/features/wallet-watch";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;

const BASE_TARGET: TargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  mode: "live",
  mirror_usdc: 5,
  max_daily_usdc: 50,
  max_fills_per_hour: 10,
  enabled: true, // runtime kill-switch comes from ledger snapshot
};

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

describe("mirror-coordinator.runOnce — idempotent re-run", () => {
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
          attributes: { size_usdc: 5 },
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runOnce({
      source: makeSource([fill]),
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
    const skipDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "already_placed"
    );
    expect(skipDec).toBeDefined();
    const skipMetric = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === MIRROR_COORDINATOR_METRICS.decisionsTotal &&
        e.labels.outcome === "skipped" &&
        e.labels.reason === "already_placed"
    );
    expect(skipMetric).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — insert-then-crash resume: first tick inserts pending then the
// placeIntent throws; the row stays. On the second tick, the same fill is
// re-observed and `decide()` returns `already_placed` — no double placement.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-coordinator.runOnce — crash resume", () => {
  it("insert-then-crash leaves a pending row; next tick skips as already_placed", async () => {
    const fill = makeFill();
    const ledger = new FakeOrderLedger();
    let cursor: number | undefined;
    const metrics = createRecordingMetrics();

    // Tick 1 — placeIntent explodes
    const placeIntent1 = vi.fn(async () => {
      throw new Error("CLOB rejected order: synthetic test failure");
    });
    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent: placeIntent1,
      target: BASE_TARGET,
      getCursor: () => cursor,
      setCursor: (n) => {
        cursor = n;
      },
      logger: noopLogger,
      metrics,
    });
    expect(placeIntent1).toHaveBeenCalledTimes(1);
    // Pending row now exists with error status
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.status).toBe("error");

    // Tick 2 — same fill re-observed. placeIntent MUST NOT fire.
    const placeIntent2 = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent: placeIntent2,
      target: BASE_TARGET,
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
// Scenario C — kill-switch off: ledger.enabled=false triggers
// decide→skip/kill_switch_off for every fill. No placements, no pending rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-coordinator.runOnce — kill-switch off", () => {
  it("skips every fill and does not insert pending when enabled=false", async () => {
    const fill = makeFill();
    const ledger = new FakeOrderLedger({ enabled: false });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();

    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(ledger.rows).toHaveLength(0);
    const killSwitchDec = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "kill_switch_off"
    );
    expect(killSwitchDec).toBeDefined();
  });

  it("also fails closed when the ledger snapshot throws", async () => {
    const fill = makeFill();
    // FakeOrderLedger.failConfigRead mirrors the Drizzle adapter's
    // fail-closed contract — snapshot returns enabled=false on DB error.
    const ledger = new FakeOrderLedger({ failConfigRead: true });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    expect(placeIntent).not.toHaveBeenCalled();
    expect(ledger.rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — empty page: source returns no fills; coordinator is a no-op
// except for cursor advance. No decisions, no placements.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-coordinator.runOnce — empty source page", () => {
  it("returns cleanly and advances cursor even with zero fills", async () => {
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();
    let cursor: number | undefined;

    await runOnce({
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
// Scenario E — cap-hit branches: fill #1 places, fill #2 tips the daily cap.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-coordinator.runOnce — cap-hit", () => {
  it("places first fill, skips second with daily_cap_hit when mirror_usdc would exceed cap", async () => {
    const target: TargetConfig = {
      ...BASE_TARGET,
      mirror_usdc: 6,
      max_daily_usdc: 10, // first fill: 0 + 6 <= 10 OK; second: 6 + 6 > 10 SKIP
    };
    const fill1 = makeFill({ fill_id: "data-api:0xtx1:0xasset:BUY:1001" });
    const fill2 = makeFill({ fill_id: "data-api:0xtx2:0xasset:BUY:1002" });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn(
      async (i: OrderIntent): Promise<OrderReceipt> =>
        makeReceipt("0xorder", i.client_order_id)
    );
    const metrics = createRecordingMetrics();

    await runOnce({
      source: makeSource([fill1, fill2]),
      ledger,
      placeIntent,
      target,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics,
    });

    expect(placeIntent).toHaveBeenCalledTimes(1);
    const capHit = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "daily_cap_hit"
    );
    expect(capHit).toBeDefined();
    expect(capHit?.fill_id).toBe(fill2.fill_id);
    const placed = ledger.decisions.find((d) => d.outcome === "placed");
    expect(placed?.fill_id).toBe(fill1.fill_id);
  });

  it("skips on rate_cap_hit once fills_last_hour >= max_fills_per_hour", async () => {
    const target: TargetConfig = { ...BASE_TARGET, max_fills_per_hour: 1 };
    const fill1 = makeFill({ fill_id: "data-api:0xtx1:0xasset:BUY:1001" });
    const fill2 = makeFill({ fill_id: "data-api:0xtx2:0xasset:BUY:1002" });
    const ledger = new FakeOrderLedger();
    const placeIntent = vi.fn(
      async (i: OrderIntent): Promise<OrderReceipt> =>
        makeReceipt("0xorder", i.client_order_id)
    );

    await runOnce({
      source: makeSource([fill1, fill2]),
      ledger,
      placeIntent,
      target,
      getCursor: () => undefined,
      setCursor: () => {},
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    expect(placeIntent).toHaveBeenCalledTimes(1);
    const rateCap = ledger.decisions.find(
      (d) => d.outcome === "skipped" && d.reason === "rate_cap_hit"
    );
    expect(rateCap).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path — one fill → one placement, decisions ledger records `placed`.
// ─────────────────────────────────────────────────────────────────────────────

describe("mirror-coordinator.runOnce — happy path", () => {
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

    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
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
    await runOnce({
      source: makeSource([fill]),
      ledger,
      placeIntent,
      target: BASE_TARGET,
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
