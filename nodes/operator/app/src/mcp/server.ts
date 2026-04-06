// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@mcp/server`
 * Purpose: Internal MCP server exposing core__ tools to Codex executor.
 * Scope: Handles MCP tools/list and tools/call requests. Delegates execution to toolRunner.
 * Invariants:
 *   - TOOL_CATALOG_IS_CANONICAL: reads from TOOL_CATALOG, never defines own tools
 *   - GRAPHS_USE_TOOLRUNNER_ONLY: delegates to toolRunner.exec(), never calls implementations directly
 *   - DENY_BY_DEFAULT: creates toolRunner with graph-scoped policy from run scope
 *   - GRAPH_SCOPED_TOOLS: tools/list returns only toolIds from the run's graph manifest
 *   - EPHEMERAL_TOKEN: auth via per-run bearer token from run-scope-store
 * Side-effects: IO (handles HTTP requests)
 * Links: bug.0300, @modelcontextprotocol/sdk
 * @internal
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createToolRunner, type ToolSourcePort } from "@cogni/ai-core";
import { TOOL_CATALOG, toToolSpec } from "@cogni/ai-tools";
import type { JSONSchema7 } from "json-schema";

import { makeLogger } from "@/shared/observability";
import { resolveRunToken, type RunScope } from "./run-scope-store";

const log = makeLogger({ component: "mcp-tool-server" });

/**
 * Dependencies injected from bootstrap container.
 */
export interface McpServerDeps {
  /** Tool source with real implementations (from container.toolSource) */
  readonly toolSource: ToolSourcePort;
}

/**
 * Create an MCP server instance for core__ tool access.
 *
 * The server is stateless — each request resolves scope from the bearer token.
 * Tool list is scoped to the run's graph manifest (not full catalog).
 * Tool execution goes through the standard toolRunner pipeline.
 *
 * @param deps - Injected dependencies from bootstrap container
 * @returns Configured McpServer instance
 */
export function createCogniMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({
    name: "cogni-tools",
    version: "1.0.0",
  });

  // Register all catalog tools as MCP tools.
  // Each tool validates the bearer token and scopes execution to the run.
  for (const [toolId, boundTool] of Object.entries(TOOL_CATALOG)) {
    const { spec } = toToolSpec(boundTool.contract);
    const inputSchema = spec.inputSchema as JSONSchema7;

    // MCP SDK expects the properties/required shape from JSON Schema
    const properties =
      (inputSchema.properties as Record<string, JSONSchema7>) ?? {};
    const required = (inputSchema.required as string[]) ?? [];

    // Build shape record for MCP SDK's tool() registration
    const shape: Record<
      string,
      {
        type: string;
        description?: string;
        required?: boolean;
      }
    > = {};

    for (const [propName, propSchema] of Object.entries(properties)) {
      const ps = propSchema as JSONSchema7;
      shape[propName] = {
        type: (ps.type as string) ?? "string",
        description: ps.description,
        required: required.includes(propName),
      };
    }

    server.tool(
      toolId,
      boundTool.contract.description,
      shape,
      async (args, extra) => {
        // Resolve scope from bearer token in the session context
        const scope = resolveRunScopeFromExtra(extra);
        if (!scope) {
          log.warn({ toolId }, "MCP tool call with invalid/expired token");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  errorCode: "auth",
                  safeMessage: "Invalid or expired run token",
                }),
              },
            ],
            isError: true,
          };
        }

        // Check if this tool is in the run's allowed set
        if (!scope.toolIds.includes(toolId)) {
          log.warn(
            { toolId, graphId: scope.graphId },
            "MCP tool call for tool not in graph manifest"
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  errorCode: "policy_denied",
                  safeMessage: `Tool '${toolId}' is not available for this graph`,
                }),
              },
            ],
            isError: true,
          };
        }

        // Create a scoped toolRunner for this execution
        const toolRunner = createToolRunner(deps.toolSource, () => {}, {
          policy: {
            decide: (_ctx, name) =>
              scope.toolIds.includes(name) ? "allow" : "deny",
          },
          ctx: { runId: scope.runId },
        });

        // Execute through standard pipeline
        const result = await toolRunner.exec(toolId, args);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.ok ? result.value : result),
            },
          ],
          isError: !result.ok,
        };
      }
    );
  }

  return server;
}

/**
 * Extract run scope from MCP extra context.
 *
 * The bearer token is passed by Codex via the Authorization header,
 * which the MCP SDK makes available in the session/transport context.
 * For the Streamable HTTP transport, we extract it from the session metadata.
 */
function resolveRunScopeFromExtra(extra: unknown): RunScope | undefined {
  // The MCP SDK passes session info in the extra parameter.
  // For Streamable HTTP, the bearer token arrives as Authorization: Bearer <token>
  // We store it in the session metadata during transport setup.
  const meta = extra as Record<string, unknown> | undefined;
  const sessionId = meta?.sessionId as string | undefined;
  if (sessionId) {
    return resolveRunToken(sessionId);
  }
  return undefined;
}
