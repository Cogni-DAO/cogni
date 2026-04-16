// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/langgraph/poly-catalog`
 * Purpose: Merged LangGraph catalog for the poly node — generic graphs plus poly-specific graphs.
 * Scope: Re-exports a single merged catalog for the in-proc provider, the dev provider,
 *        the discovery provider, and the bootstrap factory to consume. Does not execute graphs,
 *        does not wire tools, does not manage lifecycle.
 * Invariants:
 *   - CATALOG_SINGLE_SOURCE_OF_TRUTH: one merged catalog value, imported everywhere that used to
 *     import LANGGRAPH_CATALOG on the poly node.
 *   - LANGGRAPH_WINS_ON_COLLISION: if a graphName exists in both, POLY_LANGGRAPH_CATALOG overrides,
 *     because poly-specific entries are intentional customizations of the generic catalog.
 * Side-effects: none (static data)
 * Links: LANGGRAPH_AI.md, GRAPH_EXECUTION.md
 * @internal
 */

import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import { POLY_LANGGRAPH_CATALOG } from "@cogni/poly-graphs";

/**
 * Merged catalog used by every consumer in `nodes/poly/app/.../langgraph/`.
 * POLY_LANGGRAPH_CATALOG entries win on graphName collision.
 *
 * Shape is identical to LANGGRAPH_CATALOG so every call site can swap
 * `LANGGRAPH_CATALOG` → `POLY_MERGED_CATALOG` with no other change.
 */
export const POLY_MERGED_CATALOG = {
  ...LANGGRAPH_CATALOG,
  ...POLY_LANGGRAPH_CATALOG,
} as const;
