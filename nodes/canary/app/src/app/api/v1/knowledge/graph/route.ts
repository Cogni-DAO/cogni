// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/graph/route`
 * Purpose: GET /api/v1/knowledge/graph — full node (entry) + edge (citation) set
 *   for the 3D knowledge graph view. Reads every domain's entries plus the
 *   complete citations table via container.knowledgeStorePort.
 * Scope: Cookie-session only (Bearer agents rejected 403, like /knowledge). One
 *   listAllCitations() read, not an N+1 per-node citation scan.
 * Invariants: VALIDATE_IO, AUTH_VIA_GETSESSIONUSER, KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION,
 *   EDGE_ENDPOINTS_EXIST (edges whose endpoints aren't in the node set are dropped).
 * Side-effects: IO (HTTP response, Doltgres reads via container port)
 * Links: docs/spec/knowledge-syntropy.md
 * @public
 */

import {
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
  KnowledgeGraphResponseSchema,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "knowledge.graph",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    // Mirror /api/v1/knowledge: Bearer agents must not browse the knowledge
    // plane in v0 (KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION).
    const authz = request.headers.get("authorization") ?? "";
    if (authz.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json(
        { error: "knowledge graph requires a session cookie (v0)" },
        { status: 403 }
      );
    }

    const port = getContainer().knowledgeStorePort;
    if (!port) {
      return NextResponse.json(
        { error: "knowledge store not configured" },
        { status: 503 }
      );
    }

    const domains = await port.listDomains();
    const nodes: KnowledgeGraphNode[] = [];
    const nodeIds = new Set<string>();
    for (const domain of domains) {
      const rows = await port.listKnowledge(domain, { limit: 10_000 });
      for (const r of rows) {
        nodeIds.add(r.id);
        nodes.push({
          id: r.id,
          domain: r.domain,
          title: r.title,
          entryType: r.entryType ?? "finding",
          confidencePct: r.confidencePct ?? null,
          sourceType: r.sourceType,
        });
      }
    }

    // Single full-table read; drop edges whose endpoints aren't in the node set
    // (deprecated/cross-domain dangling refs) so the client never renders a
    // floating edge.
    const allCitations = await port.listAllCitations();
    const edges: KnowledgeGraphEdge[] = [];
    for (const c of allCitations) {
      if (!nodeIds.has(c.citingId) || !nodeIds.has(c.citedId)) continue;
      edges.push({
        id: c.id,
        source: c.citingId,
        target: c.citedId,
        citationType: c.citationType,
      });
    }

    ctx.log.info(
      { nodes: nodes.length, edges: edges.length, domains: domains.length },
      "knowledge.graph_success"
    );

    return NextResponse.json(
      KnowledgeGraphResponseSchema.parse({ nodes, edges, domains })
    );
  }
);
