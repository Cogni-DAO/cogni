// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-data-help`
 * Purpose: AI tool — static meta-tool describing the `core__poly_data_*` family.
 * Scope: Pure static meta-tool. Returns endpoint catalog + discovery strategy + gotchas. Does not perform IO, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, NO_IO, NO_LANGCHAIN_IMPORT.
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

const PolyDataHelpTopicSchema = z.enum(["endpoints", "strategy", "gotchas"]);

export const PolyDataHelpInputSchema = z.object({
  topic: PolyDataHelpTopicSchema.optional().describe(
    "Narrow the response to one section; omit for the full help bundle."
  ),
});
export type PolyDataHelpInput = z.infer<typeof PolyDataHelpInputSchema>;

const EndpointEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  params: z.array(z.string()),
  notes: z.string(),
});

export const PolyDataHelpOutputSchema = z.object({
  endpoints: z.array(EndpointEntrySchema),
  discoveryStrategy: z.string(),
  gotchas: z.array(z.string()),
});
export type PolyDataHelpOutput = z.infer<typeof PolyDataHelpOutputSchema>;
export type PolyDataHelpRedacted = PolyDataHelpOutput;

export const POLY_DATA_HELP_NAME = "core__poly_data_help" as const;

const ENDPOINTS: PolyDataHelpOutput["endpoints"] = [
  {
    name: "core__poly_data_positions",
    path: "GET /positions",
    params: ["user", "market?", "sizeThreshold?", "limit?", "offset?"],
    notes:
      "Open positions for a proxy-wallet. Empty when `user` is the signing EOA, not the Safe.",
  },
  {
    name: "core__poly_data_activity",
    path: "GET /activity",
    params: ["user", "type?", "side?", "start?", "end?", "limit?", "offset?"],
    notes:
      "Lifecycle events (TRADE/SPLIT/MERGE/REDEEM/...). Distinct from /trades.",
  },
  {
    name: "core__poly_data_value",
    path: "GET /value",
    params: ["user", "market?"],
    notes:
      "Cheap USDC-value probe. Use as pre-filter before /positions and /activity.",
  },
  {
    name: "core__poly_data_holders",
    path: "GET /holders",
    params: ["market", "limit?"],
    notes:
      "Current shareholders of a market (conditionId). Core hidden-gem wallet-discovery primitive.",
  },
  {
    name: "core__poly_data_trades_market",
    path: "GET /trades",
    params: ["market", "takerOnly?", "limit?", "offset?"],
    notes:
      "Market-level trade stream — exposes taker + maker addresses for counterparty harvesting.",
  },
  {
    name: "core__poly_data_resolve_username",
    path: "Gamma GET /public-search?profile=true",
    params: ["query", "limit?"],
    notes:
      "Handle → proxy-wallet resolver. Different host (gamma-api.polymarket.com).",
  },
  {
    name: "core__wallet_top_traders",
    path: "GET /v1/leaderboard",
    params: ["timePeriod", "orderBy?", "limit?"],
    notes:
      "Global leaderboard. Capped at offset=1000 — leaderboard-only discovery misses hidden gems.",
  },
];

const DISCOVERY_STRATEGY = [
  "1) Seed by category via core__market_list / Gamma events tag.",
  "2) Harvest /holders on 50–200 markets in the category; union wallets; count cross-market appearances.",
  "3) Also harvest /trades (market-level) on high-volume markets for counterparty lists.",
  "4) Cheap-filter with /value?user=<wallet> to drop sub-$1k wallets.",
  "5) Profile survivors: /positions (unrealized) + /activity (realized-PnL reconstruction).",
  "6) Rank by consistency: ≥N resolved markets, win-rate ≥60%, positive PnL across ≥3 events.",
  "7) Cross-check against /leaderboard (offset 0..1000) — if absent, genuine hidden gem.",
].join("\n");

const GOTCHAS: string[] = [
  "USER_PARAM_IS_PROXY_WALLET — always pass the Safe proxy, NOT the signing EOA. Empty /positions is almost always this.",
  "Data API is Cloudflare-throttled ~60 rpm per IP. Throttled silently (no 429). Keep /holders harvesting ≤200 markets per run.",
  "/leaderboard is capped at offset=1000 — that's why holders-based discovery exists.",
  "/public-search (handle resolver) is on gamma-api.polymarket.com, a different host from data-api.polymarket.com.",
  "`market` parameter is a conditionId (hex), NOT the slug and NOT the CTF tokenId.",
  "Realized PnL is reconstructed from /activity — /positions only exposes unrealized PnL on open positions.",
];

const HELP_PAYLOAD: PolyDataHelpOutput = {
  endpoints: ENDPOINTS,
  discoveryStrategy: DISCOVERY_STRATEGY,
  gotchas: GOTCHAS,
};

export const polyDataHelpContract: ToolContract<
  typeof POLY_DATA_HELP_NAME,
  PolyDataHelpInput,
  PolyDataHelpOutput,
  PolyDataHelpRedacted
> = {
  name: POLY_DATA_HELP_NAME,
  description:
    "Static meta-tool describing the `core__poly_data_*` tool family: endpoint catalog, " +
    "recommended discovery sequence, and known gotchas. Call this FIRST before starting a " +
    "wallet-research run — it encodes the reason each tool exists and how they compose. " +
    "Pure; no IO, no rate-limit cost.",
  effect: "read_only",
  inputSchema: PolyDataHelpInputSchema,
  outputSchema: PolyDataHelpOutputSchema,
  redact: (out) => out,
  allowlist: ["endpoints", "discoveryStrategy", "gotchas"] as const,
};

export const polyDataHelpImplementation: ToolImplementation<
  PolyDataHelpInput,
  PolyDataHelpOutput
> = {
  execute: async (input) => {
    if (input.topic === "endpoints") {
      return {
        endpoints: HELP_PAYLOAD.endpoints,
        discoveryStrategy: "",
        gotchas: [],
      };
    }
    if (input.topic === "strategy") {
      return {
        endpoints: [],
        discoveryStrategy: HELP_PAYLOAD.discoveryStrategy,
        gotchas: [],
      };
    }
    if (input.topic === "gotchas") {
      return {
        endpoints: [],
        discoveryStrategy: "",
        gotchas: HELP_PAYLOAD.gotchas,
      };
    }
    return HELP_PAYLOAD;
  },
};

export const polyDataHelpBoundTool: BoundTool<
  typeof POLY_DATA_HELP_NAME,
  PolyDataHelpInput,
  PolyDataHelpOutput,
  PolyDataHelpRedacted
> = {
  contract: polyDataHelpContract,
  implementation: polyDataHelpImplementation,
};
