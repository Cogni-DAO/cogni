// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/public/x402/models`
 * Purpose: Public discovery endpoint — lists available models and graphs with x402 payment terms.
 * Scope: Free (no payment required). Returns OpenAI-compatible model list enriched with graph
 *   metadata and x402 payment requirements. Enables autonomous agent discovery.
 * Invariants:
 *   - PUBLIC_NAMESPACE: Under /api/v1/public/* — no auth required
 *   - OpenAI /v1/models format compatibility (object: "list", data: [...])
 *   - Graph catalog sourced from @cogni/langgraph-graphs (CATALOG_SINGLE_SOURCE_OF_TRUTH)
 * Side-effects: none (read-only, cacheable)
 * Links: A2A agent-card.json (/.well-known/agent-card.json), @cogni/langgraph-graphs/catalog
 * @public
 */

import { NextResponse } from "next/server";
import {
  LANGGRAPH_CATALOG,
  LANGGRAPH_PROVIDER_ID,
} from "@cogni/langgraph-graphs";

import { wrapPublicRoute } from "@/bootstrap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Prototype: hardcoded from repo-spec (task.0120 makes dynamic)
const RECEIVING_ADDRESS = "0xdCCa8D85603C2CC47dc6974a790dF846f8695056";

interface ModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  // Extensions (additive, won't break OpenAI SDK)
  cogni_type: "graph" | "model";
  cogni_description: string;
  cogni_graph_id?: string;
  cogni_x402?: {
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string;
    payTo: string;
    endpoint: string;
  };
}

export const GET = wrapPublicRoute(
  {
    routeId: "x402.models",
    cacheTtlSeconds: 300, // 5 min cache — graph catalog changes rarely
    staleWhileRevalidateSeconds: 600,
  },
  async () => {
    const created = Math.floor(Date.now() / 1000);

    // Build model list from the graph catalog
    const data: ModelEntry[] = Object.entries(LANGGRAPH_CATALOG).map(
      ([name, entry]) => ({
        id: `${LANGGRAPH_PROVIDER_ID}:${name}`,
        object: "model" as const,
        created,
        owned_by: "cogni-node",
        cogni_type: "graph" as const,
        cogni_description: entry.description,
        cogni_graph_id: `${LANGGRAPH_PROVIDER_ID}:${name}`,
        cogni_x402: {
          scheme: "exact",
          network: "eip155:8453",
          asset: "USDC",
          maxAmountRequired: "100000",
          payTo: RECEIVING_ADDRESS,
          endpoint: "/api/v1/public/x402/chat/completions",
        },
      })
    );

    // OpenAI /v1/models compatible format
    return NextResponse.json({
      object: "list",
      data,
    });
  }
);
