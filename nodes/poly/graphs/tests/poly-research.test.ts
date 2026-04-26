// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/tests/poly-research`
 * Purpose: Unit tests for the poly-research graph factory — tool bundle + output schema + factory (task.0386).
 * Scope: Pure — does not invoke the LLM, does not hit the network. Full agent→tool→report flow is validated at deploy via the Validation block.
 * Invariants: SINGLE_CONTRACT_SOURCE, GRAPH_PEER_NOT_NESTED.
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @internal
 */

import {
  MARKET_LIST_NAME,
  POLY_DATA_ACTIVITY_NAME,
  POLY_DATA_HELP_NAME,
  POLY_DATA_HOLDERS_NAME,
  POLY_DATA_POSITIONS_NAME,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  POLY_DATA_TRADES_MARKET_NAME,
  POLY_DATA_VALUE_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
} from "@cogni/ai-tools";
import { describe, expect, it } from "vitest";

import {
  createPolyResearchGraph,
  POLY_LANGGRAPH_CATALOG,
  POLY_RESEARCH_GRAPH_NAME,
  POLY_RESEARCH_TOOL_IDS,
} from "../src/index";
import { PolyResearchReportSchema } from "../src/graphs/poly-research/output-schema";

describe("poly-research graph — tool bundle (POLY_RESEARCH_TOOL_IDS)", () => {
  it("includes all 7 core__poly_data_* tools (traded-events purged — endpoint 404)", () => {
    const ids = new Set<string>(POLY_RESEARCH_TOOL_IDS);
    expect(ids.has(POLY_DATA_HELP_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_POSITIONS_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_ACTIVITY_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_VALUE_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_HOLDERS_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_TRADES_MARKET_NAME)).toBe(true);
    expect(ids.has(POLY_DATA_RESOLVE_USERNAME_NAME)).toBe(true);
  });

  it("includes the leaderboard + market-list + web-search tools", () => {
    const ids = new Set<string>(POLY_RESEARCH_TOOL_IDS);
    expect(ids.has(WALLET_TOP_TRADERS_NAME)).toBe(true);
    expect(ids.has(MARKET_LIST_NAME)).toBe(true);
    expect(ids.has(WEB_SEARCH_NAME)).toBe(true);
  });

  it("has no duplicate tool IDs", () => {
    const ids = POLY_RESEARCH_TOOL_IDS as readonly string[];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("poly-research graph — catalog registration", () => {
  it("is registered as a peer graph (not a subgraph of poly-brain)", () => {
    expect(POLY_LANGGRAPH_CATALOG[POLY_RESEARCH_GRAPH_NAME]).toBeDefined();
    expect(POLY_RESEARCH_GRAPH_NAME).toBe("poly-research");
    // Peer, not nested: poly-brain entry is also present and distinct.
    expect(Object.keys(POLY_LANGGRAPH_CATALOG)).toContain("poly-brain");
    expect(Object.keys(POLY_LANGGRAPH_CATALOG)).toContain("poly-research");
  });

  it("catalog entry uses POLY_RESEARCH_TOOL_IDS", () => {
    const entry = POLY_LANGGRAPH_CATALOG[POLY_RESEARCH_GRAPH_NAME];
    expect(entry?.toolIds).toEqual(POLY_RESEARCH_TOOL_IDS);
  });
});

describe("poly-research graph — factory", () => {
  it("returns a graph object exposing .invoke()", () => {
    // createReactAgent returns a runnable; we don't actually invoke the LLM
    // here. We just smoke-test that the factory composes without throwing.
    const fakeLlm = {
      invoke: async () => ({ content: "" }),
      withStructuredOutput: () => ({ invoke: async () => ({}) }),
    } as unknown as Parameters<typeof createPolyResearchGraph>[0]["llm"];
    const graph = createPolyResearchGraph({ llm: fakeLlm, tools: [] });
    expect(typeof graph.invoke).toBe("function");
  });
});

describe("poly-research output — PolyResearchReportSchema", () => {
  it("parses a well-formed report", () => {
    const report = {
      query: "top sports wallets with >60% win rate",
      methodology:
        "Harvested /holders across 40 NBA markets, cheap-filtered with /value, profiled with /positions + /activity.",
      candidates: [
        {
          proxyWallet: "0x9f2fe025f84839ca81dd8e0338892605702d2ca8",
          userName: "alice",
          rank: 1,
          confidence: "high",
          stats: {
            totalPnl: 12345.67,
            winRate: 0.72,
            sampleSize: 42,
            categoryFocus: ["sports"],
          },
          reasoning:
            "72% win rate across 42 resolved NBA markets; positive PnL in 4 of 4 monthly cohorts; not in top-500 leaderboard.",
          evidenceUrls: [
            "https://polymarket.com/profile/0x9f2fe025f84839ca81dd8e0338892605702d2ca8",
          ],
        },
      ],
      caveats: [
        "Sample size below 50 markets for 2 candidates.",
        "/holders harvest capped at 40 markets this run due to rate limit.",
      ],
      recommendation: "monitor" as const,
    };
    expect(() => PolyResearchReportSchema.parse(report)).not.toThrow();
  });

  it("accepts null winRate when sampleSize is small", () => {
    const report = {
      query: "niche crypto wallets",
      methodology: "Seed+holders discovery.",
      candidates: [
        {
          proxyWallet: "0xabcdef0123456789abcdef0123456789abcdef01",
          userName: null,
          rank: 1,
          confidence: "low" as const,
          stats: { totalPnl: 500, winRate: null, sampleSize: 2 },
          reasoning: "Too few resolved markets to judge.",
          evidenceUrls: [],
        },
      ],
      caveats: ["Sample size is very small."],
      recommendation: null,
    };
    expect(() => PolyResearchReportSchema.parse(report)).not.toThrow();
  });

  it("rejects out-of-range winRate", () => {
    const report = {
      query: "x",
      methodology: "y",
      candidates: [
        {
          proxyWallet: "0xabcdef0123456789abcdef0123456789abcdef01",
          userName: null,
          rank: 1,
          confidence: "high" as const,
          stats: { totalPnl: 1, winRate: 1.5, sampleSize: 10 },
          reasoning: "bad",
          evidenceUrls: [],
        },
      ],
      caveats: [],
      recommendation: null,
    };
    expect(() => PolyResearchReportSchema.parse(report)).toThrow();
  });
});
