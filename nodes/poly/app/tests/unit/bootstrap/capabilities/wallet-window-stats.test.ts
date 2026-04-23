// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/capabilities/wallet-window-stats`
 * Purpose: Unit tests for createWalletCapability().getWalletWindowStats — windowed stats with authoritative/estimated PnL.
 * Scope: Mocks PolymarketDataApiClient via custom fetch; tests DAY/WEEK/MONTH/ALL filtering, 10k-cap flag,
 *        authoritative vs estimated pnlKind branches. Does not hit real Polymarket endpoints.
 * Invariants: No I/O. Each test uses a unique wallet address to avoid module-level cache cross-contamination.
 * Side-effects: none
 * Links: work/items/task.0346, nodes/poly/app/src/bootstrap/capabilities/wallet.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";
import { createWalletCapability } from "@/bootstrap/capabilities/wallet";

// Each test gets a unique wallet address to avoid 60s module-level cache cross-contamination.
let walletSeq = 0;
function freshWallet(): string {
  const n = ++walletSeq;
  return `0x${n.toString(16).padStart(40, "0")}`;
}

function makeTrade(
  overrides: {
    side?: "BUY" | "SELL";
    size?: number;
    price?: number;
    timestamp?: number;
  } = {}
) {
  return {
    proxyWallet: "0x0000000000000000000000000000000000000001",
    side: overrides.side ?? "BUY",
    asset: "0xasset",
    conditionId: "0xcond",
    size: overrides.size ?? 10,
    price: overrides.price ?? 0.5,
    timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000) - 3600,
    title: "Test market",
    slug: "",
    eventSlug: "",
    icon: "",
    outcome: "Yes",
    outcomeIndex: 0,
    transactionHash: "0xhash",
  };
}

function makePosition(
  overrides: { cashPnl?: number; realizedPnl?: number } = {}
) {
  return {
    proxyWallet: "0x0000000000000000000000000000000000000001",
    asset: "0xasset",
    conditionId: "0xcond",
    size: 100,
    avgPrice: 0.4,
    initialValue: 40,
    currentValue: 50,
    cashPnl: overrides.cashPnl ?? 10,
    percentPnl: 25,
    totalBought: 40,
    realizedPnl: overrides.realizedPnl ?? 5,
    percentRealizedPnl: 12.5,
    curPrice: 0.5,
    redeemable: false,
    mergeable: false,
    title: "Test market",
    slug: "",
    icon: "",
    eventId: "",
    eventSlug: "",
    outcome: "Yes",
    outcomeIndex: 0,
    oppositeOutcome: "No",
    oppositeAsset: "0xopposite",
    endDate: "",
    negativeRisk: false,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status = 500): Response {
  return {
    ok: false,
    status,
    statusText: "Server Error",
    json: async () => ({}),
  } as unknown as Response;
}

describe("getWalletWindowStats", () => {
  it("DAY window: filters trades to last 24h and computes volume + numTrades", async () => {
    const wallet = freshWallet();
    const now = Math.floor(Date.now() / 1000);
    const recentTrade = makeTrade({
      timestamp: now - 3_600,
      size: 10,
      price: 0.5,
    });
    const oldTrade = makeTrade({ timestamp: now - 90_000 }); // >1 day ago

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([recentTrade, oldTrade]));
      if (url.includes("/positions"))
        return Promise.resolve(
          jsonResponse([makePosition({ cashPnl: 3, realizedPnl: 2 })])
        );
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "DAY",
    });

    // oldTrade is filtered out by sinceTs
    expect(result.numTrades).toBe(1);
    expect(result.volumeUsdc).toBeCloseTo(5); // 10 * 0.5
    expect(result.pnlKind).toBe("authoritative");
    expect(result.pnlUsdc).toBeCloseTo(5); // 3 + 2
    expect(result.numTradesCapped).toBe(false);
  });

  it("WEEK window: includes trades up to 7 days ago, excludes older", async () => {
    const wallet = freshWallet();
    const now = Math.floor(Date.now() / 1000);
    const inWindow = makeTrade({ timestamp: now - 5 * 86_400 }); // 5 days ago
    const outOfWindow = makeTrade({ timestamp: now - 8 * 86_400 }); // 8 days ago

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([inWindow, outOfWindow]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });

    expect(result.numTrades).toBe(1);
    expect(result.timePeriod).toBe("WEEK");
  });

  it("MONTH window: includes trades up to 30 days ago, excludes older", async () => {
    const wallet = freshWallet();
    const now = Math.floor(Date.now() / 1000);
    const inWindow = makeTrade({ timestamp: now - 25 * 86_400 }); // 25 days ago
    const outOfWindow = makeTrade({ timestamp: now - 35 * 86_400 }); // 35 days ago

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([inWindow, outOfWindow]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "MONTH",
    });

    expect(result.numTrades).toBe(1);
    expect(result.timePeriod).toBe("MONTH");
  });

  it("ALL window: includes all trades (no sinceTs filter)", async () => {
    const wallet = freshWallet();
    const now = Math.floor(Date.now() / 1000);
    const ancient = makeTrade({ timestamp: now - 365 * 86_400 }); // 1 year ago
    const recent = makeTrade({ timestamp: now - 3_600 });

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([ancient, recent]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "ALL",
    });

    expect(result.numTrades).toBe(2);
    expect(result.timePeriod).toBe("ALL");
  });

  it("numTradesCapped=true when trade count equals the 10k fetch limit", async () => {
    const wallet = freshWallet();
    const trades = Array.from({ length: 10_000 }, (_, i) =>
      makeTrade({ timestamp: Math.floor(Date.now() / 1000) - i })
    );

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades")) return Promise.resolve(jsonResponse(trades));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });

    expect(result.numTradesCapped).toBe(true);
    expect(result.numTrades).toBe(10_000);
  });

  it("pnlKind=authoritative when positions API succeeds", async () => {
    const wallet = freshWallet();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([makeTrade()]));
      if (url.includes("/positions"))
        return Promise.resolve(
          jsonResponse([makePosition({ cashPnl: 7, realizedPnl: 3 })])
        );
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });

    expect(result.pnlKind).toBe("authoritative");
    expect(result.pnlUsdc).toBeCloseTo(10); // 7 + 3
  });

  it("pnlKind=estimated when positions API returns HTTP error", async () => {
    const wallet = freshWallet();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/positions"))
        return Promise.resolve(errorResponse(500));
      // 1 BUY trade at size=10, price=0.5 → cashflow = -5
      if (url.includes("/trades"))
        return Promise.resolve(
          jsonResponse([makeTrade({ side: "BUY", size: 10, price: 0.5 })])
        );
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });

    expect(result.pnlKind).toBe("estimated");
    expect(result.pnlUsdc).toBeCloseTo(-5); // BUY = negative cashflow
  });

  it("roiPct=null when volumeUsdc is zero (no trades)", async () => {
    const wallet = freshWallet();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades")) return Promise.resolve(jsonResponse([]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "DAY",
    });

    expect(result.roiPct).toBeNull();
    expect(result.volumeUsdc).toBe(0);
    expect(result.numTrades).toBe(0);
  });

  it("proxyWallet is normalized to lowercase", async () => {
    const upperWallet = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades")) return Promise.resolve(jsonResponse([]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });
    const result = await cap.getWalletWindowStats({
      address: upperWallet,
      timePeriod: "WEEK",
    });

    expect(result.proxyWallet).toBe(upperWallet.toLowerCase());
  });

  it("cache hit: second call for same address+period does not invoke fetch again", async () => {
    const wallet = freshWallet();
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trades"))
        return Promise.resolve(jsonResponse([makeTrade()]));
      if (url.includes("/positions")) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });

    const cap = createWalletCapability({
      baseUrl: "https://test.example",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const first = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });
    const callCountAfterFirst = mockFetch.mock.calls.length;

    const second = await cap.getWalletWindowStats({
      address: wallet,
      timePeriod: "WEEK",
    });

    // fetch must not have been called again — result came from cache
    expect(mockFetch.mock.calls.length).toBe(callCountAfterFirst);
    expect(second.numTrades).toBe(first.numTrades);
    expect(second.computedAt).toBe(first.computedAt);
  });
});
