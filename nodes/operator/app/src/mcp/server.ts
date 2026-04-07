// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@mcp/server`
 * Purpose: Internal MCP Streamable HTTP server exposing core__ tools to Codex executor.
 * Scope: Real MCP protocol endpoint on a separate port. Delegates tool execution to toolRunner.
 * Invariants:
 *   - TOOLS_VIA_TOOLRUNNER: delegates to toolRunner.exec(), never calls implementations directly
 *   - NO_DEFAULT_EXECUTABLE_CATALOG: uses ToolSourcePort from container, not raw TOOL_CATALOG
 *   - DENY_BY_DEFAULT: creates toolRunner with graph-scoped policy from run scope
 *   - GRAPH_SCOPED_TOOLS: tools/list returns only toolIds from the run's graph manifest
 *   - EPHEMERAL_TOKEN: auth via per-run bearer token from run-scope-store
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
import { TOOL_CATALOG } from "@cogni/ai-tools";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { type RunScope, resolveRunToken } from "./run-scope-store";

// biome-ignore lint/suspicious/noConsole: MCP server starts before Pino is available
const logInfo = (msg: string) => console.log(`[mcp-tool-bridge] ${msg}`);
// biome-ignore lint/suspicious/noConsole: MCP server starts before Pino is available
const logError = (msg: string) => console.error(`[mcp-tool-bridge] ${msg}`);
// biome-ignore lint/suspicious/noConsole: MCP server starts before Pino is available
const logWarn = (msg: string) => console.warn(`[mcp-tool-bridge] ${msg}`);

// ── Lazy deps (set after container init) ────────────────────────────────────

let toolSource: ToolSourcePort | undefined;
let httpServer: ReturnType<typeof createServer> | undefined;

/**
 * Set dependencies from bootstrap container (lazy wiring).
 * Called from bootstrap/container.ts after container is built.
 * Bridges dep-cruiser gap: instrumentation starts HTTP server, bootstrap provides deps.
 */
export function setMcpDeps(deps: { toolSource: ToolSourcePort }): void {
  toolSource = deps.toolSource;
  logInfo(
    `deps wired — ${deps.toolSource.listToolSpecs().length} tools available`
  );
}

/**
 * Check if the MCP bridge is ready to handle tool calls.
 * Used by CodexLlmAdapter for fail-closed check before spawning Codex.
 */
export function isMcpBridgeReady(): boolean {
  return httpServer !== undefined && toolSource !== undefined;
}

/**
 * Start the MCP Streamable HTTP server on the given port.
 * Called from instrumentation.ts register() — once per process.
 *
 * The server binds to 127.0.0.1 (localhost only, same trust boundary).
 * Tools are not registered until setMcpDeps() is called from bootstrap.
 *
 * @param port - Port to listen on (default: 3001, via MCP_TOOL_BRIDGE_PORT env)
 */
export function startMcpHttpServer(port = 3001): void {
  // Per-session transport map (MCP sessions are long-lived per Codex run)
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      // Only handle /mcp path
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      // Extract bearer token from Authorization header
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

      // Resolve scope from token
      const scope = resolveRunToken(token);
      if (!scope) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired run token" }));
        return;
      }

      // Set req.auth for StreamableHTTPServerTransport (per SDK API)
      // The transport reads req.auth and propagates it as extra.authInfo to handlers
      (req as IncomingMessage & { auth?: unknown }).auth = {
        token,
        clientId: "codex",
        scopes: [],
        extra: { runScope: scope },
      };

      // Check for existing session
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "DELETE" && sessionId) {
        // Session teardown
        const transport = sessions.get(sessionId);
        if (transport) {
          await transport.close();
          sessions.delete(sessionId);
        }
        res.writeHead(200);
        res.end();
        return;
      }

      // For POST/GET: reuse existing session transport or create new one
      let transport: StreamableHTTPServerTransport;
      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else {
        // Create new session — new McpServer + transport per session
        // This avoids the "connect() called multiple times on singleton" problem
        const mcpServer = createMcpServerForScope(scope);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, transport);
          },
        });
        // Cast: StreamableHTTPServerTransport satisfies Transport but exactOptionalPropertyTypes
        // causes TS2379 on the onclose property. Runtime-safe cast.
        await mcpServer.server.connect(
          transport as Parameters<typeof mcpServer.server.connect>[0]
        );
      }

      await transport.handleRequest(req, res);
    }
  );

  httpServer.listen(port, "127.0.0.1", () => {
    logInfo(`listening on 127.0.0.1:${port}/mcp`);
  });

  httpServer.on("error", (err) => {
    logError(`failed to start: ${err.message}`);
    httpServer = undefined;
  });
}

/**
 * Create an McpServer scoped to a specific run.
 * Tools are registered from ToolSourcePort (not raw TOOL_CATALOG).
 * Each tool callback resolves scope from extra.authInfo.
 */
function createMcpServerForScope(initialScope: RunScope): McpServer {
  const server = new McpServer({
    name: "cogni-tools",
    version: "1.0.0",
  });

  if (!toolSource) {
    logWarn("createMcpServer called before deps wired — no tools registered");
    return server;
  }

  const specs = toolSource.listToolSpecs();
  // Only register tools that are in the initial scope's allowed set
  const scopedSpecs = specs.filter((s) =>
    initialScope.toolIds.includes(s.name)
  );

  for (const spec of scopedSpecs) {
    // Get Zod shape from TOOL_CATALOG (for MCP SDK registration).
    // TOOL_CATALOG is read-only here — execution goes through ToolSourcePort.
    // MCP SDK's tool() expects ZodRawShapeCompat (Record<string, ZodType>), which is
    // the .shape of a ZodObject, not the ZodType itself.
    const catalogEntry = TOOL_CATALOG[spec.name];
    const zodType = catalogEntry?.contract.inputSchema;
    const zodShape =
      zodType && "shape" in zodType
        ? (zodType as { shape: Record<string, unknown> }).shape
        : undefined;

    // Use tool() with Zod schema — MCP SDK converts to JSON Schema internally
    const cb = async (
      args: Record<string, unknown>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ) => {
      // Resolve scope from bearer token via extra.authInfo (set by HTTP handler on req.auth)
      const authInfo = extra.authInfo;
      const scope = authInfo?.extra?.runScope as RunScope | undefined;

      if (!scope) {
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

      if (!toolSource) {
        return {
          content: [
            { type: "text" as const, text: "Error: tool source not available" },
          ],
          isError: true,
        };
      }

      // Create a scoped toolRunner per call — no shared state
      const toolRunner = createToolRunner(toolSource, () => {}, {
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

    // Register with Zod schema — all TOOL_CATALOG entries have inputSchema
    if (zodShape) {
      server.tool(spec.name, spec.description, zodShape, cb);
    } else {
      // Fallback: no schema, register as zero-arg tool (shouldn't happen for catalog tools)
      logWarn(
        `No Zod schema for tool ${spec.name} — registering without input validation`
      );
      server.tool(spec.name, spec.description, (_extra) => cb({}, _extra));
    }
  }

  return server;
}

/**
 * Stop the MCP HTTP server (for graceful shutdown).
 */
export function stopMcpHttpServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = undefined;
    logInfo("stopped");
  }
}
