// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/poly-data-tools`
 * Purpose: Unit tests for the 8 `core__poly_data_*` wallet-research tools (task.0386).
 * Scope: Contract shape + schemas + capability delegation + stubs + help static data. Does not hit the Data API, does not perform network IO.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, REDACTION_ALLOWLIST, USER_PARAM_IS_PROXY_WALLET, PAGINATION_CONSISTENT.
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import type { PolyDataCapability } from "../src/capabilities/poly-data";
import {
  createPolyDataActivityImplementation,
  POLY_DATA_ACTIVITY_NAME,
  polyDataActivityContract,
} from "../src/tools/poly-data-activity";
import {
  POLY_DATA_HELP_NAME,
  polyDataHelpContract,
  polyDataHelpImplementation,
} from "../src/tools/poly-data-help";
import {
  createPolyDataHoldersImplementation,
  POLY_DATA_HOLDERS_NAME,
  polyDataHoldersContract,
} from "../src/tools/poly-data-holders";
import {
  createPolyDataPositionsImplementation,
  POLY_DATA_POSITIONS_NAME,
  polyDataPositionsContract,
} from "../src/tools/poly-data-positions";
import {
  createPolyDataResolveUsernameImplementation,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  polyDataResolveUsernameContract,
} from "../src/tools/poly-data-resolve-username";
import {
  createPolyDataTradesMarketImplementation,
  POLY_DATA_TRADES_MARKET_NAME,
  polyDataTradesMarketContract,
} from "../src/tools/poly-data-trades-market";
import {
  createPolyDataValueImplementation,
  POLY_DATA_VALUE_NAME,
  polyDataValueContract,
} from "../src/tools/poly-data-value";

const PROXY_WALLET = "0x9f2fe025f84839ca81dd8e0338892605702d2ca8";
const EOA = "0x0000000000000000000000000000000000000001"; // valid-looking address

function mkCapability(
  overrides: Partial<PolyDataCapability> = {}
): PolyDataCapability {
  return {
    getPositions: vi.fn(async () => ({
      user: PROXY_WALLET,
      positions: [],
      count: 0,
      hasMore: false,
    })),
    listActivity: vi.fn(async () => ({
      user: PROXY_WALLET,
      events: [],
      count: 0,
      hasMore: false,
    })),
    getValue: vi.fn(async () => ({
      user: PROXY_WALLET,
      valueUsdc: 0,
      computedAt: new Date(0).toISOString(),
    })),
    getHolders: vi.fn(async () => ({
      market: "0xabc",
      holders: [],
      count: 0,
    })),
    listMarketTrades: vi.fn(async () => ({
      market: "0xabc",
      trades: [],
      count: 0,
      hasMore: false,
    })),
    resolveUsername: vi.fn(async () => ({
      profiles: [],
      count: 0,
    })),
    ...overrides,
  };
}

describe("poly-data tools — shared invariants", () => {
  const allContracts = [
    polyDataPositionsContract,
    polyDataActivityContract,
    polyDataValueContract,
    polyDataHoldersContract,
    polyDataTradesMarketContract,
    polyDataResolveUsernameContract,
    polyDataHelpContract,
  ];

  it("every tool ID is namespaced `core__poly_data_*`", () => {
    for (const c of allContracts) {
      expect(c.name.startsWith("core__poly_data_")).toBe(true);
    }
  });

  it("every tool declares `effect: read_only`", () => {
    for (const c of allContracts) {
      expect(c.effect).toBe("read_only");
    }
  });

  it("every tool has a non-empty allowlist", () => {
    for (const c of allContracts) {
      expect(c.allowlist.length).toBeGreaterThan(0);
    }
  });

  it("every tool has a descriptive >40-char prompt", () => {
    for (const c of allContracts) {
      expect(c.description.length).toBeGreaterThan(40);
    }
  });

  it("tool IDs match the exported NAME consts", () => {
    expect(polyDataPositionsContract.name).toBe(POLY_DATA_POSITIONS_NAME);
    expect(polyDataActivityContract.name).toBe(POLY_DATA_ACTIVITY_NAME);
    expect(polyDataValueContract.name).toBe(POLY_DATA_VALUE_NAME);
    expect(polyDataHoldersContract.name).toBe(POLY_DATA_HOLDERS_NAME);
    expect(polyDataTradesMarketContract.name).toBe(
      POLY_DATA_TRADES_MARKET_NAME
    );
    expect(polyDataResolveUsernameContract.name).toBe(
      POLY_DATA_RESOLVE_USERNAME_NAME
    );
    expect(polyDataHelpContract.name).toBe(POLY_DATA_HELP_NAME);
  });

  it("user-param tools document the proxy-vs-EOA gotcha", () => {
    const userTools = [
      polyDataPositionsContract,
      polyDataActivityContract,
      polyDataValueContract,
    ];
    for (const c of userTools) {
      expect(c.description).toMatch(/proxy-wallet|EOA/);
    }
  });
});

describe("core__poly_data_positions", () => {
  it("rejects non-hex `user` before capability is called", () => {
    expect(() =>
      polyDataPositionsContract.inputSchema.parse({ user: "not-a-wallet" })
    ).toThrow();
  });

  it("delegates to capability with defaults (limit=50, offset=0)", async () => {
    const cap = mkCapability();
    const impl = createPolyDataPositionsImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ user: PROXY_WALLET });
    expect(cap.getPositions).toHaveBeenCalledWith({
      user: PROXY_WALLET,
      limit: 50,
      offset: 0,
    });
  });

  it("forwards sizeThreshold + market when supplied", async () => {
    const cap = mkCapability();
    const impl = createPolyDataPositionsImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({
      user: PROXY_WALLET,
      market: "0xMARKET",
      sizeThreshold: 500,
      limit: 10,
      offset: 20,
    });
    expect(cap.getPositions).toHaveBeenCalledWith({
      user: PROXY_WALLET,
      market: "0xMARKET",
      sizeThreshold: 500,
      limit: 10,
      offset: 20,
    });
  });
});

describe("core__poly_data_activity", () => {
  it("rejects invalid `type` enum", () => {
    expect(() =>
      polyDataActivityContract.inputSchema.parse({
        user: PROXY_WALLET,
        type: "NOPE",
      })
    ).toThrow();
  });

  it("delegates with default limit=100 and no extraneous keys", async () => {
    const cap = mkCapability();
    const impl = createPolyDataActivityImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ user: EOA });
    expect(cap.listActivity).toHaveBeenCalledWith({
      user: EOA,
      limit: 100,
      offset: 0,
    });
  });
});

describe("core__poly_data_value", () => {
  it("delegates with optional market forwarded", async () => {
    const cap = mkCapability();
    const impl = createPolyDataValueImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ user: PROXY_WALLET, market: "0xAAA" });
    expect(cap.getValue).toHaveBeenCalledWith({
      user: PROXY_WALLET,
      market: "0xAAA",
    });
  });
});

describe("core__poly_data_holders", () => {
  it("rejects empty market", () => {
    expect(() =>
      polyDataHoldersContract.inputSchema.parse({ market: "" })
    ).toThrow();
  });

  it("delegates with default limit=20", async () => {
    const cap = mkCapability();
    const impl = createPolyDataHoldersImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ market: "0xCONDITION" });
    expect(cap.getHolders).toHaveBeenCalledWith({
      market: "0xCONDITION",
      limit: 20,
    });
  });
});

describe("core__poly_data_trades_market", () => {
  it("delegates with defaults takerOnly=false, limit=100, offset=0", async () => {
    const cap = mkCapability();
    const impl = createPolyDataTradesMarketImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ market: "0xCONDITION" });
    expect(cap.listMarketTrades).toHaveBeenCalledWith({
      market: "0xCONDITION",
      takerOnly: false,
      limit: 100,
      offset: 0,
    });
  });
});

describe("core__poly_data_resolve_username", () => {
  it("rejects query shorter than 2 chars", () => {
    expect(() =>
      polyDataResolveUsernameContract.inputSchema.parse({ query: "a" })
    ).toThrow();
  });

  it("delegates with default limit=5", async () => {
    const cap = mkCapability();
    const impl = createPolyDataResolveUsernameImplementation({
      polyDataCapability: cap,
    });
    await impl.execute({ query: "alice" });
    expect(cap.resolveUsername).toHaveBeenCalledWith({
      query: "alice",
      limit: 5,
    });
  });
});

describe("core__poly_data_help — NO_IO", () => {
  it("returns a full help bundle when no topic is supplied", async () => {
    const result = await polyDataHelpImplementation.execute({});
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.discoveryStrategy.length).toBeGreaterThan(0);
    expect(result.gotchas.length).toBeGreaterThan(0);
    // Output must parse against its own schema.
    expect(() => polyDataHelpContract.outputSchema.parse(result)).not.toThrow();
  });

  it("narrows response when `topic` is set", async () => {
    const endpointsOnly = await polyDataHelpImplementation.execute({
      topic: "endpoints",
    });
    expect(endpointsOnly.endpoints.length).toBeGreaterThan(0);
    expect(endpointsOnly.discoveryStrategy).toBe("");
    expect(endpointsOnly.gotchas).toEqual([]);

    const strategyOnly = await polyDataHelpImplementation.execute({
      topic: "strategy",
    });
    expect(strategyOnly.endpoints).toEqual([]);
    expect(strategyOnly.discoveryStrategy.length).toBeGreaterThan(0);

    const gotchasOnly = await polyDataHelpImplementation.execute({
      topic: "gotchas",
    });
    expect(gotchasOnly.endpoints).toEqual([]);
    expect(gotchasOnly.gotchas.length).toBeGreaterThan(0);
  });

  it("surfaces the proxy-wallet gotcha", async () => {
    const result = await polyDataHelpImplementation.execute({
      topic: "gotchas",
    });
    expect(result.gotchas.join("\n")).toMatch(/proxy|PROXY|Safe/);
  });
});
