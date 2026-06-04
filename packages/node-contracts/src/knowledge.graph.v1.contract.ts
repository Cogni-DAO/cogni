// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/knowledge.graph.v1.contract`
 * Purpose: HTTP response contract for the knowledge graph view — the full node
 *   (entry) + edge (citation) set rendered as a 3D force graph at
 *   GET /api/v1/knowledge/graph.
 * Scope: Zod schemas and types for the wire format. No business logic, I/O, or auth.
 * Invariants:
 *   - KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION (cookie-session only, like /knowledge).
 *   - Nodes mirror a subset of the `Knowledge` domain type; edges mirror `Citation`.
 *   - Edges reference node ids; the client drops edges whose endpoints are absent.
 * Side-effects: none
 * Links: docs/spec/knowledge-syntropy.md
 * @internal
 */

import { z } from "zod";

export const KnowledgeGraphNodeSchema = z.object({
  id: z.string(),
  domain: z.string(),
  title: z.string(),
  entryType: z.string(),
  confidencePct: z.number().int().nullable(),
  sourceType: z.string(),
});
export type KnowledgeGraphNode = z.infer<typeof KnowledgeGraphNodeSchema>;

export const KnowledgeGraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  citationType: z.string(),
});
export type KnowledgeGraphEdge = z.infer<typeof KnowledgeGraphEdgeSchema>;

export const KnowledgeGraphResponseSchema = z.object({
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
  domains: z.array(z.string()),
});
export type KnowledgeGraphResponse = z.infer<
  typeof KnowledgeGraphResponseSchema
>;
