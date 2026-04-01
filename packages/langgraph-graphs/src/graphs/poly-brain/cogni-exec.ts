// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/poly-brain/cogni-exec`
 * Purpose: Cogni executor entrypoint for poly-brain graph.
 * Scope: Thin entrypoint. Does not import catalog or read env.
 * Invariants: HELPERS_DO_NOT_IMPORT_CATALOG, NO_CROSSING_THE_STREAMS.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { makeCogniGraph } from "../../runtime/cogni/make-cogni-graph";
import { createPolyBrainGraph, POLY_BRAIN_GRAPH_NAME } from "./graph";
import { POLY_BRAIN_TOOL_IDS } from "./tools";

export const polyBrainGraph = makeCogniGraph({
  name: POLY_BRAIN_GRAPH_NAME,
  createGraph: createPolyBrainGraph,
  toolIds: POLY_BRAIN_TOOL_IDS,
});
