// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/clob-executor.test`
 * Purpose: Unit tests for `createClobExecutor` — verifies that the injected `placeOrder` seam is the only code path called, that ok/rejected/error bucket the metric label correctly, and that structured log shape is stable.
 * Scope: Pure wrapper tests. Does not import the real adapter, does not hit the network.
 * Invariants: EXECUTOR_SEAM_IS_PLACE_ORDER_FN; BOUNDED_METRIC_RESULT.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.2)
 * @internal
 */

import {
  createRecordingMetrics,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/market-provider";
import { describe, expect, it, vi } from "vitest";

import {
  COPY_TRADE_EXECUTOR_METRICS,
  createClobExecutor,
} from "@/features/trading/clob-executor.js";

function makeRecordingLogger() {
  const lines: Array<{ level: string; fields: unknown; msg: string }> = [];
  const make = (): {
    info: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
    error: (obj: unknown, msg: string) => void;
    debug: (obj: unknown, msg: string) => void;
    child: () => ReturnType<typeof make>;
  } => ({
    info: (fields, msg) => lines.push({ level: "info", fields, msg }),
    warn: (fields, msg) => lines.push({ level: "warn", fields, msg }),
    error: (fields, msg) => lines.push({ level: "error", fields, msg }),
    debug: (fields, msg) => lines.push({ level: "debug", fields, msg }),
    child: () => make(),
  });
  return { logger: make(), lines };
}

const INTENT: OrderIntent = {
  provider: "polymarket",
  market_id: "prediction-market:polymarket:0xcondition",
  outcome: "YES",
  side: "BUY",
  size_usdc: 1,
  limit_price: 0.6,
  client_order_id: "0xabc",
  attributes: { token_id: "0xasset" },
};

const OK_RECEIPT: OrderReceipt = {
  order_id: "0xresp",
  client_order_id: "0xabc",
  status: "filled",
  filled_size_usdc: 1,
  submitted_at: "2024-04-17T00:00:00Z",
  attributes: { rawStatus: "matched" },
};

describe("createClobExecutor", () => {
  it("calls the injected placeOrder seam once with the intent", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const exec = createClobExecutor({ placeOrder, logger, metrics });

    const receipt = await exec(INTENT);

    expect(placeOrder).toHaveBeenCalledOnce();
    expect(placeOrder).toHaveBeenCalledWith(INTENT);
    expect(receipt).toEqual(OK_RECEIPT);
  });

  it("emits result=ok on happy path", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const exec = createClobExecutor({ placeOrder, logger, metrics });
    await exec(INTENT);

    const counter = metrics.emissions.find(
      (m) => m.name === COPY_TRADE_EXECUTOR_METRICS.placeTotal
    );
    expect(counter?.labels?.result).toBe("ok");
    const duration = metrics.emissions.find(
      (m) => m.name === COPY_TRADE_EXECUTOR_METRICS.placeDurationMs
    );
    expect(duration?.labels?.result).toBe("ok");
  });

  it("buckets CLOB rejections as result=rejected", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'PolymarketClobAdapter.placeOrder: CLOB rejected order (success=false, orderID="0xx", errorMsg="insufficient allowance")'
        )
      );
    const { logger, lines } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const exec = createClobExecutor({ placeOrder, logger, metrics });

    await expect(exec(INTENT)).rejects.toThrow(/CLOB rejected order/);

    const counter = metrics.emissions.find(
      (m) => m.name === COPY_TRADE_EXECUTOR_METRICS.placeTotal
    );
    expect(counter?.labels?.result).toBe("rejected");
    // error log fired
    expect(lines.some((l) => l.level === "error")).toBe(true);
  });

  it("buckets arbitrary throws as result=error (not rejected)", async () => {
    const placeOrder = vi.fn().mockRejectedValue(new Error("econnreset"));
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const exec = createClobExecutor({ placeOrder, logger, metrics });

    await expect(exec(INTENT)).rejects.toThrow(/econnreset/);

    const counter = metrics.emissions.find(
      (m) => m.name === COPY_TRADE_EXECUTOR_METRICS.placeTotal
    );
    expect(counter?.labels?.result).toBe("error");
  });

  it("logs start + ok with correlation fields on success", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const { logger, lines } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const exec = createClobExecutor({ placeOrder, logger, metrics });
    await exec(INTENT);

    const start = lines.find(
      (l) =>
        l.msg === "execute: start" &&
        (l.fields as { phase?: string }).phase === "start"
    );
    expect(start).toBeDefined();
    expect(
      (start?.fields as { client_order_id?: string })?.client_order_id
    ).toBe(INTENT.client_order_id);

    const ok = lines.find(
      (l) =>
        l.msg === "execute: ok" &&
        (l.fields as { phase?: string }).phase === "ok"
    );
    expect(ok).toBeDefined();
    expect((ok?.fields as { order_id?: string })?.order_id).toBe(
      OK_RECEIPT.order_id
    );
  });
});
