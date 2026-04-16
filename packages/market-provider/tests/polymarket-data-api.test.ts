// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/polymarket-data-api`
 * Purpose: Unit tests for the Polymarket Data API client — leaderboard, user trades, user positions.
 * Scope: Uses an injected fetch mock + the saved fixture JSON. Does not perform live network I/O, does not mutate state.
 * Invariants: TS_ONLY_RUNTIME, CONTRACT_IS_SOT.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/research/fixtures/polymarket-leaderboard.json
 * @internal
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  PolymarketDataApiClient,
  PolymarketLeaderboardEntrySchema,
} from "../src/adapters/polymarket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEADERBOARD_FIXTURE = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../docs/research/fixtures/polymarket-leaderboard.json"
    ),
    "utf8"
  )
) as unknown[];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: async () => body,
  } as unknown as Response;
}

describe("PolymarketDataApiClient.listTopTraders", () => {
  it("parses the saved live leaderboard fixture without throwing", () => {
    const parsed = LEADERBOARD_FIXTURE.map((row) =>
      PolymarketLeaderboardEntrySchema.parse(row)
    );
    expect(parsed.length).toBeGreaterThanOrEqual(10);
    const first = parsed[0];
    if (!first) throw new Error("fixture is empty");
    expect(first.proxyWallet).toMatch(/^0x[a-f0-9]{40}$/);
    expect(typeof first.pnl).toBe("number");
    expect(typeof first.vol).toBe("number");
  });

  it("hits /v1/leaderboard with timePeriod + orderBy + limit and returns parsed entries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(LEADERBOARD_FIXTURE));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const entries = await client.listTopTraders({
      timePeriod: "DAY",
      orderBy: "PNL",
      limit: 10,
    });

    expect(entries).toHaveLength(LEADERBOARD_FIXTURE.length);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/v1/leaderboard");
    expect(call).toContain("timePeriod=DAY");
    expect(call).toContain("orderBy=PNL");
    expect(call).toContain("limit=10");
  });

  it("defaults to timePeriod=WEEK, orderBy=PNL, limit=10 when params omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    await client.listTopTraders();
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("timePeriod=WEEK");
    expect(call).toContain("orderBy=PNL");
    expect(call).toContain("limit=10");
  });

  it("throws a clear error on non-OK HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null, false, 503));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await expect(client.listTopTraders()).rejects.toThrow(/503/);
  });

  it("throws on schema mismatch (fails closed)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ rank: 1, wallet: "oops" }]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await expect(client.listTopTraders()).rejects.toThrow();
  });

  it("aborts and throws a timeout error when the upstream stalls past timeoutMs", async () => {
    // fetchImpl respects AbortSignal: rejects with an AbortError when the
    // controller fires. Without the timeout wrapper, this promise would hang
    // indefinitely — which is exactly the production failure mode that ate
    // 8-minute dashboard requests in dev.
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const client = new PolymarketDataApiClient({
      fetch: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    await expect(client.listTopTraders()).rejects.toThrow(/timeout after 20ms/);
  });
});

describe("PolymarketDataApiClient.listUserActivity", () => {
  const wallet = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";

  it("hits /trades?user=<wallet> and returns parsed trades", async () => {
    const body = [
      {
        proxyWallet: wallet,
        side: "BUY",
        asset: "48392",
        conditionId: "0xabc",
        size: 100,
        price: 0.75,
        timestamp: 1776353664,
        title: "Some market",
        outcome: "Yes",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const trades = await client.listUserActivity(wallet);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.price).toBe(0.75);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/trades?user=");
    expect(call).toContain(wallet);
  });

  it("filters by sinceTs", async () => {
    const body = [
      {
        proxyWallet: wallet,
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 0.5,
        timestamp: 1000,
      },
      {
        proxyWallet: wallet,
        side: "SELL",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 0.6,
        timestamp: 3000,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const trades = await client.listUserActivity(wallet, { sinceTs: 2000 });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.timestamp).toBe(3000);
  });

  it("rejects malformed wallet addresses", async () => {
    const fetchImpl = vi.fn();
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await expect(client.listUserActivity("not-a-wallet")).rejects.toThrow(
      /Invalid wallet/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("PolymarketDataApiClient.listUserPositions", () => {
  const wallet = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";

  it("hits /positions?user=<wallet> and returns parsed positions", async () => {
    const body = [
      {
        proxyWallet: wallet,
        asset: "x",
        conditionId: "c",
        size: 10,
        avgPrice: 0.4,
        initialValue: 4,
        currentValue: 8,
        cashPnl: 4,
        percentPnl: 100,
        realizedPnl: 0,
        curPrice: 0.8,
        redeemable: false,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const positions = await client.listUserPositions(wallet);
    expect(positions).toHaveLength(1);
    expect(positions[0]?.cashPnl).toBe(4);
  });
});
