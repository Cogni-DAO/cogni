// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/poly-brain/server`
 * Purpose: LangGraph dev server entrypoint for poly-brain graph.
 * Scope: Thin entrypoint. Does not import catalog.
 * Invariants: LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY, HELPERS_DO_NOT_IMPORT_CATALOG.
 * Side-effects: process.env (via makeServerGraph)
 * Links: work/items/task.0230.market-data-package.md
 * @internal
 */

import { makeServerGraph } from "../../runtime/core/make-server-graph";
import { createPolyBrainGraph, POLY_BRAIN_GRAPH_NAME } from "./graph";
import { POLY_BRAIN_TOOL_IDS } from "./tools";

export const polyBrain = await makeServerGraph({
  name: POLY_BRAIN_GRAPH_NAME,
  createGraph: createPolyBrainGraph,
  toolIds: POLY_BRAIN_TOOL_IDS,
});
