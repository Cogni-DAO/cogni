// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/tests/polymarket-data-api`
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
  PolyDataApiValidationError,
  PolymarketDataApiClient,
  PolymarketLeaderboardEntrySchema,
} from "../src/adapters/polymarket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LEADERBOARD_FIXTURE = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../../../docs/research/fixtures/polymarket-leaderboard.json"
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
  it("parses the saved leaderboard fixture without throwing", () => {
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

  it("excludes the boundary timestamp from sinceTs (strict >, not >=) — bug.0426", async () => {
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
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 0.5,
        timestamp: 1001,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const trades = await client.listUserActivity(wallet, { sinceTs: 1000 });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.timestamp).toBe(1001);
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

  it("forwards sizeThreshold + offset when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await client.listUserPositions(wallet, {
      sizeThreshold: 100,
      limit: 25,
      offset: 50,
    });
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("sizeThreshold=100");
    expect(call).toContain("limit=25");
    expect(call).toContain("offset=50");
  });
});

describe("PolymarketDataApiClient.listAllUserPositions", () => {
  const wallet = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";

  function makePosition(asset: string) {
    return {
      proxyWallet: wallet,
      asset,
      conditionId: `c-${asset}`,
      size: 1,
      avgPrice: 0.5,
      initialValue: 0.5,
      currentValue: 0.5,
      cashPnl: 0,
      percentPnl: 0,
      realizedPnl: 0,
      curPrice: 0.5,
      redeemable: false,
    };
  }

  it("walks pages until a short page is returned and concatenates rows", async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => makePosition(`a${i}`));
    const tailPage = Array.from({ length: 17 }, (_, i) => makePosition(`b${i}`));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(tailPage));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const all = await client.listAllUserPositions(wallet);

    expect(all).toHaveLength(517);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = fetchImpl.mock.calls[0]?.[0] as string;
    const secondUrl = fetchImpl.mock.calls[1]?.[0] as string;
    expect(firstUrl).toContain("limit=500");
    expect(firstUrl).toContain("offset=0");
    expect(secondUrl).toContain("limit=500");
    expect(secondUrl).toContain("offset=500");
  });

  it("stops at the first page when fewer than PAGE_SIZE rows are returned", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([makePosition("only")]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });

    const all = await client.listAllUserPositions(wallet);

    expect(all).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns [] when the wallet holds no positions", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    expect(await client.listAllUserPositions(wallet)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("forwards baseParams (sizeThreshold) on every page", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse([]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await client.listAllUserPositions(wallet, { sizeThreshold: 5 });
    const url = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url).toContain("sizeThreshold=5");
    expect(url).toContain("limit=500");
    expect(url).toContain("offset=0");
  });
});

describe("PolymarketDataApiClient.listActivity", () => {
  const wallet = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";

  it("hits /activity with type/side/start/end/limit/offset and parses the response", async () => {
    const body = [
      {
        proxyWallet: wallet,
        type: "TRADE",
        side: "BUY",
        timestamp: 1776000000,
        size: 10,
        price: 0.5,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const events = await client.listActivity(wallet, {
      type: "TRADE",
      side: "BUY",
      start: 1770000000,
      end: 1780000000,
      limit: 50,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/activity?user=");
    expect(call).toContain("type=TRADE");
    expect(call).toContain("side=BUY");
    expect(call).toContain("start=1770000000");
    expect(call).toContain("end=1780000000");
    expect(call).toContain("limit=50");
  });

  it("throws on schema mismatch (fails closed)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ totally: "wrong" }]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await expect(client.listActivity(wallet)).rejects.toThrow();
  });

  it("rejects malformed wallet addresses", async () => {
    const fetchImpl = vi.fn();
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    await expect(client.listActivity("not-a-wallet")).rejects.toThrow(
      /Invalid wallet/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("PolymarketDataApiClient.getValue", () => {
  const wallet = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";

  it("returns the first `{ user, value }` entry from /value", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ user: wallet, value: 123.45 }]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const result = await client.getValue(wallet, { market: "0xabc" });
    expect(result.user).toBe(wallet);
    expect(result.value).toBeCloseTo(123.45);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/value?user=");
    expect(call).toContain("market=0xabc");
  });

  it("returns zero when the endpoint yields an empty array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const result = await client.getValue(wallet);
    expect(result.value).toBe(0);
  });
});

describe("PolymarketDataApiClient.getHolders", () => {
  it("hits /holders?market=<id>&limit and returns parsed holders", async () => {
    const body = [
      {
        proxyWallet: "0xAAA",
        outcomeIndex: 0,
        outcome: "Yes",
        amount: 500,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const holders = await client.getHolders("0xCONDITION", { limit: 10 });
    expect(holders).toHaveLength(1);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/holders?market=0xCONDITION");
    expect(call).toContain("limit=10");
  });

  it("throws on empty market", async () => {
    const client = new PolymarketDataApiClient({ fetch: vi.fn() });
    await expect(client.getHolders("")).rejects.toThrow(/market/);
  });
});

describe("PolymarketDataApiClient.listMarketTrades", () => {
  it("hits /trades?market=<id> (no user) and sets takerOnly", async () => {
    const body = [
      {
        proxyWallet: "0xTAKER",
        makerAddress: "0xMAKER",
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 10,
        price: 0.5,
        timestamp: 1776000000,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const trades = await client.listMarketTrades("0xCONDITION", {
      takerOnly: true,
      limit: 50,
      offset: 0,
    });
    expect(trades).toHaveLength(1);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/trades?market=0xCONDITION");
    expect(call).toContain("takerOnly=true");
    expect(call).not.toContain("user=");
  });
});

describe("PolymarketDataApiClient.resolveUsername", () => {
  it("hits Gamma /public-search with profile=true and returns profiles[]", async () => {
    const body = {
      profiles: [
        {
          name: "alice",
          proxyWallet: "0xABC",
          displayUsername: "alice",
        },
      ],
      events: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const client = new PolymarketDataApiClient({ fetch: fetchImpl });
    const profiles = await client.resolveUsername("alice", { limit: 5 });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.proxyWallet).toBe("0xABC");
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("gamma-api.polymarket.com");
    expect(call).toContain("/public-search");
    expect(call).toContain("q=alice");
    expect(call).toContain("profile=true");
    expect(call).toContain("limit=5");
  });

  it("uses a custom gammaBaseUrl when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ profiles: [] }));
    const client = new PolymarketDataApiClient({
      fetch: fetchImpl,
      gammaBaseUrl: "http://fake-gamma.test",
    });
    await client.resolveUsername("bob");
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("fake-gamma.test");
  });

  it("rejects queries shorter than 2 chars", async () => {
    const client = new PolymarketDataApiClient({ fetch: vi.fn() });
    await expect(client.resolveUsername("a")).rejects.toThrow(/≥2/);
  });
});

describe("PolymarketDataApiClient Zod envelope", () => {
  const wallet = "0x1234567890abcdef1234567890abcdef12345678";

  it("throws PolyDataApiValidationError with endpoint + issues when /activity response is malformed", async () => {
    // Missing required `proxyWallet` on the event — should fail the envelope parse.
    const malformed = [{ type: "TRADE", timestamp: 1700000000 }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(malformed));
    const client = new PolymarketDataApiClient({
      fetch: fetchImpl,
      baseUrl: "http://fake.test",
    });
    await expect(client.listActivity(wallet)).rejects.toBeInstanceOf(
      PolyDataApiValidationError
    );
    try {
      await client.listActivity(wallet);
    } catch (err) {
      expect(err).toBeInstanceOf(PolyDataApiValidationError);
      const typed = err as PolyDataApiValidationError;
      expect(typed.code).toBe("VALIDATION_FAILED");
      expect(typed.endpoint).toBe("/activity");
      expect(typed.issues.length).toBeGreaterThan(0);
    }
  });

  it("throws PolyDataApiValidationError when /holders returns a non-array", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not an array" }));
    const client = new PolymarketDataApiClient({
      fetch: fetchImpl,
      baseUrl: "http://fake.test",
    });
    await expect(
      client.getHolders("0xabc", { limit: 10 })
    ).rejects.toBeInstanceOf(PolyDataApiValidationError);
  });
});
