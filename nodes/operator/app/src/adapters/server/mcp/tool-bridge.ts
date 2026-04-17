// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/mcp/tool-bridge`
 * Purpose: MCP Streamable HTTP transport adapter — exposes core__ tools to Codex executor.
 * Scope: Server transport adapter. Does NOT define tools or import @cogni/ai-tools.
 * Invariants:
 *   - TOOLS_VIA_TOOLRUNNER: delegates to toolRunner.exec()
 *   - NO_DEFAULT_EXECUTABLE_CATALOG: uses ToolSourcePort, not raw TOOL_CATALOG
 *   - DENY_BY_DEFAULT: graph-scoped policy from run scope
 *   - GRAPH_SCOPED_TOOLS: tools/list filtered to run's toolIds
 *   - EPHEMERAL_TOKEN: bearer token auth via run-scope-store
 *   - AUTH_MODEL_SEPARATION: bearer token for scope, MCP session ID for protocol
 *   - NO_SHARED_MUTABLE_CONTEXT: auth propagated per-request via req.auth
 * Side-effects: IO (HTTP server, tool execution)
 * Links: bug.0300, spec.tool-use #1
 * @internal
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createToolRunner, type ToolSourcePort } from "@cogni/ai-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { type RunScope, resolveRunToken } from "./run-scope-store";

// biome-ignore lint/suspicious/noConsole: bridge starts before Pino is available
const logInfo = (msg: string) => console.log(`[mcp-tool-bridge] ${msg}`);
// biome-ignore lint/suspicious/noConsole: bridge starts before Pino is available
const logError = (msg: string) => console.error(`[mcp-tool-bridge] ${msg}`);
// biome-ignore lint/suspicious/noConsole: bridge starts before Pino is available
const logWarn = (msg: string) => console.warn(`[mcp-tool-bridge] ${msg}`);

/**
 * Dependencies for the MCP tool bridge.
 * Provided by bootstrap at container init time.
 */
export interface McpToolBridgeDeps {
  /** Runtime-bound tool source (from container, per NO_DEFAULT_EXECUTABLE_CATALOG) */
  readonly toolSource: ToolSourcePort;
  /**
   * Zod schemas for MCP SDK tool registration (keyed by tool ID).
   * MCP SDK requires Zod for input validation — these are extracted from
   * TOOL_CATALOG in bootstrap and passed here. The bridge never imports
   * @cogni/ai-tools directly.
   */
  readonly zodSchemas: ReadonlyMap<string, Record<string, unknown>>;
}

// ── Module state ────────────────────────────────────────────────────────────

let deps: McpToolBridgeDeps | undefined;
let httpServer: ReturnType<typeof createServer> | undefined;

/**
 * Check if the MCP bridge is ready to handle tool calls.
 * Used by CodexLlmAdapter for fail-closed check.
 */
export function isMcpBridgeReady(): boolean {
  return httpServer !== undefined && deps !== undefined;
}

/**
 * Start the MCP Streamable HTTP tool bridge.
 * Called from bootstrap/container.ts after container is built.
 *
 * @param bridgeDeps - Tool source + Zod schemas from composition root
 * @param port - Port to listen on (default: 1729, via MCP_TOOL_BRIDGE_PORT env)
 */
export function startMcpToolBridge(
  bridgeDeps: McpToolBridgeDeps,
  port = 1729
): void {
  deps = bridgeDeps;

  const sessions = new Map<string, StreamableHTTPServerTransport>();

  httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const mcpSessionHeader = req.headers["mcp-session-id"] as
        | string
        | undefined;
      logInfo(
        `REQUEST: ${req.method} ${req.url} auth=${!!req.headers.authorization} session=${mcpSessionHeader ?? "none"}`
      );
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      // Extract + validate bearer token
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : undefined;

      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Missing Authorization: Bearer <token>" })
        );
        return;
      }

      const scope = resolveRunToken(token);
      if (!scope) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired run token" }));
        return;
      }

      // Set req.auth for StreamableHTTPServerTransport (per SDK API)
      (req as IncomingMessage & { auth?: unknown }).auth = {
        token,
        clientId: "codex",
        scopes: [],
        extra: { runScope: scope },
      };

      // Session management
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "DELETE" && sessionId) {
        const transport = sessions.get(sessionId);
        logInfo(
          `DELETE session=${sessionId} found=${!!transport} activeSessions=${sessions.size}`
        );
        if (transport) {
          await transport.close();
          sessions.delete(sessionId);
        }
        res.writeHead(200);
        res.end();
        return;
      }

      let transport: StreamableHTTPServerTransport;
      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else {
        const mcpServer = createMcpServerForScope(scope);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
          },
        });
        await mcpServer.server.connect(
          transport as Parameters<typeof mcpServer.server.connect>[0]
        );
      }

      await transport.handleRequest(req, res);
    }
  );

  httpServer.listen(port, "127.0.0.1", () => {
    logInfo(
      `listening on 127.0.0.1:${port}/mcp (${bridgeDeps.toolSource.listToolSpecs().length} tools)`
    );
  });

  httpServer.on("error", (err) => {
    logError(`failed to start: ${err.message}`);
    httpServer = undefined;
  });
}

/**
 * Create an McpServer scoped to a specific run.
 * Tools registered from ToolSourcePort + Zod schemas.
 */
function createMcpServerForScope(initialScope: RunScope): McpServer {
  const server = new McpServer({
    name: "cogni-tools",
    version: "1.0.0",
  });

  if (!deps) {
    logWarn("createMcpServer called before deps wired");
    return server;
  }

  const specs = deps.toolSource.listToolSpecs();
  const scopedSpecs = specs.filter((s) =>
    initialScope.toolIds.includes(s.name)
  );

  for (const spec of scopedSpecs) {
    const zodShape = deps.zodSchemas.get(spec.name);

    const cb = async (
      args: Record<string, unknown>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => {
      const authInfo = extra.authInfo;
      const scope = authInfo?.extra?.runScope as RunScope | undefined;

      if (!scope || !deps) {
        return {
          content: [
            { type: "text" as const, text: "Error: missing run scope" },
          ],
          isError: true,
        };
      }

      if (!scope.toolIds.includes(spec.name)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Tool '${spec.name}' not in graph manifest`,
            },
          ],
          isError: true,
        };
      }

      const toolRunner = createToolRunner(deps.toolSource, () => {}, {
        policy: {
          allowedTools: [...scope.toolIds],
          decide: (_ctx, name) =>
            scope.toolIds.includes(name) ? "allow" : "deny",
        },
        ctx: { runId: scope.runId },
      });

      const result = await toolRunner.exec(spec.name, args);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.ok ? result.value : result),
          },
        ],
        isError: !result.ok,
      };
    };

    if (zodShape) {
      server.tool(spec.name, spec.description, zodShape, cb);
    } else {
      logWarn(`No Zod schema for ${spec.name}`);
      server.tool(spec.name, spec.description, (_extra) => cb({}, _extra));
    }
  }

  return server;
}

/**
 * Stop the MCP HTTP server (graceful shutdown).
 */
export function stopMcpToolBridge(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = undefined;
    logInfo("stopped");
  }
}
