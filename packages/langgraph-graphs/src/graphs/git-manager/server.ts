// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/git-manager/server`
 * Purpose: LangGraph dev server entrypoint for Git Manager graph.
 * Scope: Thin entrypoint. Does NOT import catalog (type transparency for LangGraph CLI).
 * Invariants:
 *   - LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY: Referenced by langgraph.json
 *   - HELPERS_DO_NOT_IMPORT_CATALOG: Uses makeServerGraph with explicit toolIds
 * Side-effects: process.env (via makeServerGraph)
 * Links: docs/guides/agent-development.md
 * @internal
 */

import { makeServerGraph } from "../../runtime/core/make-server-graph";
import { createGitManagerGraph, GIT_MANAGER_GRAPH_NAME } from "./graph";
import { GIT_MANAGER_TOOL_IDS } from "./tools";

export const gitManager = await makeServerGraph({
  name: GIT_MANAGER_GRAPH_NAME,
  createGraph: createGitManagerGraph,
  toolIds: GIT_MANAGER_TOOL_IDS,
});
