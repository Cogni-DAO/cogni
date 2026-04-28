// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/wallet-top-traders`
 * Purpose: Unit tests for the core__wallet_top_traders tool — contract, input/output schemas, implementation factory.
 * Scope: Shape + behavior of the tool contract and factory. Does not perform network I/O, does not render UI, does not test the wallet capability implementation.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_TYPED, REDACTION_REQUIRED.
 * Side-effects: none
 * Links: src/tools/wallet-top-traders.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import {
  createWalletTopTradersImplementation,
  WALLET_TOP_TRADERS_NAME,
  type WalletCapability,
  type WalletTopTradersOutput,
  walletTopTradersBoundTool,
  walletTopTradersContract,
  walletTopTradersStubImplementation,
} from "../src/tools/wallet-top-traders";

describe("core__wallet_top_traders contract", () => {
  it("has the namespaced tool ID", () => {
    expect(walletTopTradersContract.name).toBe("core__wallet_top_traders");
    expect(WALLET_TOP_TRADERS_NAME).toBe("core__wallet_top_traders");
  });

  it("declares read_only effect", () => {
    expect(walletTopTradersContract.effect).toBe("read_only");
  });

  it("has a non-empty allowlist covering the output keys", () => {
    expect(walletTopTradersContract.allowlist).toContain("traders");
    expect(walletTopTradersContract.allowlist).toContain("timePeriod");
    expect(walletTopTradersContract.allowlist).toContain("orderBy");
    expect(walletTopTradersContract.allowlist).toContain("totalCount");
  });

  it("has a descriptive prompt string for the LLM", () => {
    expect(walletTopTradersContract.description.length).toBeGreaterThan(40);
  });

  describe("inputSchema", () => {
    it("accepts an empty object (all fields optional)", () => {
      expect(walletTopTradersContract.inputSchema.parse({})).toEqual({});
    });

    it("accepts valid enum values", () => {
      const parsed = walletTopTradersContract.inputSchema.parse({
        timePeriod: "DAY",
        orderBy: "VOL",
        limit: 25,
      });
      expect(parsed.timePeriod).toBe("DAY");
      expect(parsed.orderBy).toBe("VOL");
      expect(parsed.limit).toBe(25);
    });

    it("rejects invalid timePeriod", () => {
      expect(() =>
        walletTopTradersContract.inputSchema.parse({ timePeriod: "YEAR" })
      ).toThrow();
    });

    it("rejects limit out of range", () => {
      expect(() =>
        walletTopTradersContract.inputSchema.parse({ limit: 999 })
      ).toThrow();
      expect(() =>
        walletTopTradersContract.inputSchema.parse({ limit: 0 })
      ).toThrow();
    });
  });

  describe("outputSchema", () => {
    it("accepts a valid output", () => {
      const out: WalletTopTradersOutput = {
        traders: [
          {
            rank: 1,
            proxyWallet: "0xabc",
            userName: "alice",
            volumeUsdc: 100,
            pnlUsdc: 50,
            roiPct: 50,
            numTrades: 10,
            numTradesCapped: false,
            verified: false,
          },
        ],
        timePeriod: "WEEK",
        orderBy: "PNL",
        totalCount: 1,
      };
      expect(() =>
        walletTopTradersContract.outputSchema.parse(out)
      ).not.toThrow();
    });

    it("accepts null roiPct (when volume is 0)", () => {
      const out = {
        traders: [
          {
            rank: 1,
            proxyWallet: "0xabc",
            userName: "alice",
            volumeUsdc: 0,
            pnlUsdc: 100,
            roiPct: null,
            numTrades: 5,
            numTradesCapped: false,
            verified: false,
          },
        ],
        timePeriod: "ALL" as const,
        orderBy: "PNL" as const,
        totalCount: 1,
      };
      expect(() =>
        walletTopTradersContract.outputSchema.parse(out)
      ).not.toThrow();
    });
  });

  describe("redact", () => {
    it("is identity — wallet addresses + usernames are public by design", () => {
      const out: WalletTopTradersOutput = {
        traders: [],
        timePeriod: "DAY",
        orderBy: "PNL",
        totalCount: 0,
      };
      expect(walletTopTradersContract.redact(out)).toEqual(out);
    });
  });
});

describe("createWalletTopTradersImplementation", () => {
  it("delegates to the capability with defaults when input is empty", async () => {
    const mock: WalletCapability = {
      listTopTraders: vi.fn(async () => ({
        traders: [],
        timePeriod: "WEEK",
        orderBy: "PNL",
        totalCount: 0,
      })),
    };
    const impl = createWalletTopTradersImplementation({
      walletCapability: mock,
    });
    await impl.execute({});
    expect(mock.listTopTraders).toHaveBeenCalledWith({
      timePeriod: "WEEK",
      orderBy: "PNL",
      limit: 10,
    });
  });

  it("forwards explicit input", async () => {
    const mock: WalletCapability = {
      listTopTraders: vi.fn(async () => ({
        traders: [],
        timePeriod: "DAY",
        orderBy: "VOL",
        totalCount: 0,
      })),
    };
    const impl = createWalletTopTradersImplementation({
      walletCapability: mock,
    });
    await impl.execute({ timePeriod: "DAY", orderBy: "VOL", limit: 5 });
    expect(mock.listTopTraders).toHaveBeenCalledWith({
      timePeriod: "DAY",
      orderBy: "VOL",
      limit: 5,
    });
  });
});

describe("walletTopTradersBoundTool", () => {
  it("has contract + stub implementation", () => {
    expect(walletTopTradersBoundTool.contract).toBe(walletTopTradersContract);
    expect(walletTopTradersBoundTool.implementation).toBe(
      walletTopTradersStubImplementation
    );
  });

  it("stub returns empty traders array", async () => {
    const result = await walletTopTradersStubImplementation.execute({});
    expect(result.traders).toEqual([]);
    expect(result.totalCount).toBe(0);
  });
});
