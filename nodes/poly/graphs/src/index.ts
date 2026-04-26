export {
  createPolyBrainGraph,
  createPolyResearchGraph,
  POLY_BRAIN_GRAPH_NAME,
  POLY_BRAIN_TOOL_IDS,
  POLY_RESEARCH_GRAPH_NAME,
  POLY_RESEARCH_TOOL_IDS,
} from "./graphs";

import type { CreateGraphFn } from "@cogni/langgraph-graphs";
import {
  createPolyBrainGraph,
  createPolyResearchGraph,
  POLY_BRAIN_GRAPH_NAME,
  POLY_BRAIN_TOOL_IDS,
  POLY_RESEARCH_GRAPH_NAME,
  POLY_RESEARCH_TOOL_IDS,
} from "./graphs";

interface CatalogEntry {
  readonly displayName: string;
  readonly description: string;
  readonly toolIds: readonly string[];
  readonly graphFactory: CreateGraphFn;
}

export const POLY_LANGGRAPH_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  [POLY_BRAIN_GRAPH_NAME]: {
    displayName: "Poly Brain",
    description:
      "Prediction market analyst with live market data and web research",
    toolIds: POLY_BRAIN_TOOL_IDS,
    graphFactory: createPolyBrainGraph,
  },
  [POLY_RESEARCH_GRAPH_NAME]: {
    displayName: "Poly Research",
    description:
      "Patient wallet-research analyst — profiles proxy-wallets via Polymarket Data-API and returns a structured PolyResearchReport",
    toolIds: POLY_RESEARCH_TOOL_IDS,
    graphFactory: createPolyResearchGraph,
  },
} as const;
