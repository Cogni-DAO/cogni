// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/git-manager/cogni-exec`
 * Purpose: Cogni executor entrypoint for Git Manager graph.
 * Scope: Thin entrypoint. Does NOT import catalog or read env.
 * Invariants:
 *   - HELPERS_DO_NOT_IMPORT_CATALOG: Uses makeCogniGraph with explicit toolIds
 *   - NO_CROSSING_THE_STREAMS: Never imports initChatModel or reads env
 * Side-effects: none
 * Links: docs/guides/agent-development.md
 * @public
 */

import { makeCogniGraph } from "../../runtime/cogni/make-cogni-graph";
import { createGitManagerGraph, GIT_MANAGER_GRAPH_NAME } from "./graph";
import { GIT_MANAGER_TOOL_IDS } from "./tools";

export const gitManagerGraph = makeCogniGraph({
  name: GIT_MANAGER_GRAPH_NAME,
  createGraph: createGitManagerGraph,
  toolIds: GIT_MANAGER_TOOL_IDS,
});
