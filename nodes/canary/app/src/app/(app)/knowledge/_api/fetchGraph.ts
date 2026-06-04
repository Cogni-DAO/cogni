// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/knowledge/_api/fetchGraph`
 * Purpose: Client-side fetch wrapper for the knowledge graph (nodes + citation edges).
 * Scope: Calls GET /api/v1/knowledge/graph with same-origin credentials. Returns typed response or throws.
 * Invariants: Cookie-session only — never sends a Bearer header (per KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION).
 * Side-effects: IO
 * @internal
 */

import type { KnowledgeGraphResponse } from "@cogni/node-contracts";

export async function fetchGraph(): Promise<KnowledgeGraphResponse> {
  const response = await fetch("/api/v1/knowledge/graph", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Failed to fetch knowledge graph",
    }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<KnowledgeGraphResponse>;
}
