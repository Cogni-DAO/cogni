// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/crew-orchestrator/state`
 * Purpose: State annotations for the crew orchestrator graph.
 * Scope: State schema definitions. Does NOT contain graph logic.
 * Invariants: LANGGRAPH_ANNOTATION_PATTERN
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

/** Resolved MCP server for deployment */
export interface ResolvedMcpServer {
  name: string;
  image: string;
  port: number;
  requiredEnv: string[];
  oauthScopes: string[];
}

/** Resolved agent for deployment */
export interface ResolvedAgent {
  name: string;
  image: string;
  soulMd?: string;
  mcpConnections: string[];
}

/** Overall crew plan */
export interface CrewPlan {
  name: string;
  mission: string;
  mcpServers: ResolvedMcpServer[];
  agents: ResolvedAgent[];
  estimatedCostPerBlock: string;
  sdlYaml?: string;
}

/** Auth requirement that needs user interaction */
export interface AuthRequirement {
  mcpServerName: string;
  envVar: string;
  oauthScopes?: string[];
  provided: boolean;
}

export const CrewOrchestratorStateAnnotation = Annotation.Root({
  /** Conversation messages */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  /** Parsed crew plan from user description */
  crewPlan: Annotation<CrewPlan | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** Authentication requirements collected */
  authRequirements: Annotation<AuthRequirement[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** User-provided auth credentials (env var name -> value) */
  providedCredentials: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),

  /** Deployment ID after successful deploy */
  deploymentId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  /** Current phase of the orchestration */
  phase: Annotation<
    | "planning"
    | "auth_collection"
    | "deploying"
    | "monitoring"
    | "complete"
    | "error"
  >({
    reducer: (_prev, next) => next,
    default: () => "planning" as const,
  }),

  /** Error message if something went wrong */
  error: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type CrewOrchestratorState =
  typeof CrewOrchestratorStateAnnotation.State;
