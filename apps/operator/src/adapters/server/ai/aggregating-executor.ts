// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/aggregating-executor`
 * Purpose: Routes graph execution to appropriate provider by graphId namespace.
 * Scope: Implements GraphExecutorPort for unified graph access. Routes by graphId prefix via Map lookup. Does NOT contain graph orchestration logic.
 * Invariants:
 *   - ROUTING_BY_NAMESPACE_ONLY: Routes graphId.split(":")[0] → Map<string, GraphExecutorPort>
 *   - UNIFIED_GRAPH_EXECUTOR: All graphs flow through GraphExecutorPort
 *   - GRAPH_ID_NAMESPACED: graphId format is ${providerId}:${graphName}
 * Side-effects: none (delegates to providers)
 * Notes: Discovery (listAgents) is in AggregatingAgentCatalog, not here.
 * Links: GRAPH_EXECUTION.md
 * @public
 */

import type { Logger } from "pino";

import type {
  AiExecutionErrorCode,
  ExecutionContext,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import { makeLogger } from "@/shared/observability";

/**
 * Namespace-based graph router that delegates to providers by graphId prefix.
 *
 * Implements GraphExecutorPort for unified graph access.
 * App uses only this router; no facade-level graph conditionals.
 *
 * Per ROUTING_BY_NAMESPACE_ONLY: parses graphId.split(":")[0] once,
 * looks up provider in Map<string, GraphExecutorPort>. No per-provider routing logic.
 *
 * Note: Discovery (listing agents) is in AggregatingAgentCatalog.
 */
export class NamespaceGraphRouter implements GraphExecutorPort {
  private readonly log: Logger;
  private readonly providers: ReadonlyMap<string, GraphExecutorPort>;

  /**
   * Create namespace router with given provider map.
   *
   * @param providers - Map of namespace → GraphExecutorPort
   */
  constructor(providers: ReadonlyMap<string, GraphExecutorPort>) {
    this.providers = providers;
    this.log = makeLogger({ component: "NamespaceGraphRouter" });

    this.log.debug(
      {
        providerCount: providers.size,
        namespaces: [...providers.keys()],
      },
      "NamespaceGraphRouter initialized"
    );
  }

  /**
   * Execute a graph run by routing to appropriate provider.
   *
   * Routing strategy:
   * 1. Parse namespace from graphId (split on first ":")
   * 2. Look up provider in Map
   * 3. Delegate to provider.runGraph()
   *
   * Per UNIFIED_GRAPH_EXECUTOR: all execution flows through this method.
   * Per ROUTING_BY_NAMESPACE_ONLY: deterministic Map lookup, no per-provider logic.
   */
  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const { runId, graphId } = req;

    this.log.debug({ runId, graphId }, "NamespaceGraphRouter.runGraph routing");

    // Parse namespace from graphId (e.g., "langgraph:poet" → "langgraph")
    const colonIndex = graphId.indexOf(":");
    if (colonIndex === -1) {
      this.log.error(
        { runId, graphId },
        "Invalid graphId format: missing namespace separator"
      );
      return this.createErrorResult(
        runId,
        ctx?.requestId ?? req.runId,
        "internal"
      );
    }

    const namespace = graphId.slice(0, colonIndex);
    const provider = this.providers.get(namespace);

    if (provider) {
      this.log.debug({ runId, graphId, namespace }, "Routing to provider");
      return provider.runGraph(req, ctx);
    }

    // No provider found - server configuration issue
    this.log.error(
      {
        runId,
        graphId,
        namespace,
        availableNamespaces: [...this.providers.keys()],
      },
      "No provider found for namespace"
    );
    return this.createErrorResult(
      runId,
      ctx?.requestId ?? req.runId,
      "internal"
    );
  }

  /**
   * Create error result with typed code.
   */
  private createErrorResult(
    runId: string,
    requestId: string,
    code: AiExecutionErrorCode
  ): GraphRunResult {
    return {
      stream: this.createErrorStream(code),
      final: Promise.resolve({
        ok: false,
        runId,
        requestId,
        error: code,
      }),
    };
  }

  /**
   * Create an error stream that yields error event then done.
   */
  private async *createErrorStream(
    code: AiExecutionErrorCode
  ): AsyncIterable<import("@/types/ai-events").AiEvent> {
    yield { type: "error", error: code };
    yield { type: "done" };
  }
}
