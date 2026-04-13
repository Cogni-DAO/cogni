// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs`
 * Purpose: Barrel export for graph factories and shared types.
 * Scope: Graph creation functions and type definitions. Does NOT include runners (those live in src/).
 * Invariants:
 *   - Graphs are pure factories — no side effects, no env reads
 *   - All LangChain graph creation code lives here
 *   - Shared types prevent per-graph interface duplication
 * Side-effects: none
 * Links: LANGGRAPH_AI.md, AGENT_DEVELOPMENT_GUIDE.md
 * @public
 */

// Brain graph (code-aware assistant with repo access)
export { BRAIN_GRAPH_NAME, createBrainGraph } from "./brain/graph";
export type { CreateCrewOrchestratorOptions } from "./crew-orchestrator/graph";
// Crew Orchestrator graph (Akash deployment of MCP + agent crews)
export {
  CREW_ORCHESTRATOR_GRAPH_NAME,
  createCrewOrchestratorGraph,
} from "./crew-orchestrator/graph";
export type { CrewOrchestratorToolDeps } from "./crew-orchestrator/tools";
// Poet graph (poetic AI assistant)
export { createPoetGraph, POET_GRAPH_NAME } from "./poet/graph";
// Ponderer graph (philosophical thinker)
export { createPondererGraph, PONDERER_GRAPH_NAME } from "./ponderer/graph";
// PR Review graph (single-call structured output, no tools)
export { createPrReviewGraph, PR_REVIEW_GRAPH_NAME } from "./pr-review/graph";
export { buildReviewUserMessage } from "./pr-review/prompts";
// Research graph (deep research with web search)
export { createResearchGraph, RESEARCH_GRAPH_NAME } from "./research/graph";
// Shared graph types
export type {
  CreateReactAgentGraphOptions,
  GraphInvokeOptions,
  InvokableGraph,
  MessageGraphInput,
  MessageGraphOutput,
} from "./types";
