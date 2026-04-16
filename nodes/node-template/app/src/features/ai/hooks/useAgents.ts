// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/hooks/useAgents`
 * Purpose: Provides React Query hook for fetching available AI agents.
 * Scope: Wraps /api/v1/ai/agents endpoint with React Query for caching and loading states. Does not implement API endpoint or catalog discovery logic.
 * Invariants: 5-minute stale time, re-fetches on window focus, P0 agent IDs align with graph IDs.
 * Side-effects: IO (fetch to API endpoint), global (React Query cache)
 * Notes: Validates response with contract schema; errors propagate to caller.
 * Links: /api/v1/ai/agents route, ai.agents.v1.contract
 * @public
 */

import type { GraphId } from "@cogni/ai-core";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { aiAgentsOperation } from "@/contracts/ai.agents.v1.contract";

export interface AgentOption {
  readonly agentId: GraphId;
  readonly graphId: GraphId;
  readonly name: string;
  readonly description: string | null;
}

export interface AgentsQueryData {
  readonly agents: readonly AgentOption[];
  readonly defaultAgentId: GraphId | null;
}

const toGraphId = (value: string): GraphId => value as GraphId;

/**
 * Fetches available AI agents for graph selection.
 *
 * @returns React Query result with agent descriptors and optional default agent
 */
export function useAgents(): UseQueryResult<AgentsQueryData, Error> {
  return useQuery({
    queryKey: ["ai-agents"],
    queryFn: async (): Promise<AgentsQueryData> => {
      const response = await fetch("/api/v1/ai/agents", {
        credentials: "same-origin",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        const message =
          error && typeof error.error === "string"
            ? error.error
            : `Failed to fetch agents: ${response.statusText}`;

        throw new Error(message);
      }

      const data = await response.json();

      const parseResult = aiAgentsOperation.output.safeParse(data);
      if (!parseResult.success) {
        throw new Error("Invalid agents data from API");
      }

      return {
        agents: parseResult.data.agents.map((agent) => ({
          ...agent,
          agentId: toGraphId(agent.agentId),
          graphId: toGraphId(agent.graphId),
        })),
        defaultAgentId: parseResult.data.defaultAgentId
          ? toGraphId(parseResult.data.defaultAgentId)
          : null,
      };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
