// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/mcp/route`
 * Purpose: Next.js API route for internal MCP tool bridge (Codex executor ↔ core__ tools).
 * Scope: HTTP transport layer only. Delegates to mcp/server.ts for tool execution.
 * Invariants:
 *   - INTERNAL_ONLY: This endpoint is localhost-only (same trust boundary as Codex subprocess)
 *   - EPHEMERAL_TOKEN: Bearer token from Authorization header resolves run scope
 *   - STREAMABLE_HTTP: Uses MCP Streamable HTTP transport (not SSE)
 * Side-effects: IO (HTTP request handling)
 * Links: bug.0300, @modelcontextprotocol/sdk
 * @internal
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { NextResponse } from "next/server";

import { getContainer } from "@/bootstrap/container";
import { makeLogger } from "@/shared/observability";
import { createCogniMcpServer } from "@/mcp/server";
import { resolveRunToken } from "@/mcp/run-scope-store";

const log = makeLogger({ component: "mcp-route" });

// Lazy-initialized MCP server (created once, reused across requests)
let mcpServer: ReturnType<typeof createCogniMcpServer> | undefined;

function getOrCreateMcpServer() {
  if (!mcpServer) {
    const container = getContainer();
    mcpServer = createCogniMcpServer({
      toolSource: container.toolSource,
    });
  }
  return mcpServer;
}

/**
 * Handle MCP Streamable HTTP POST requests.
 *
 * The bearer token in the Authorization header is used to:
 * 1. Authenticate the request (must be a valid run token)
 * 2. Scope tool listing and execution to the graph's tool manifest
 *
 * Codex SDK sends MCP requests as POST with JSON-RPC body.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // Extract bearer token
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    if (!token) {
      return NextResponse.json(
        { error: "Missing Authorization header" },
        { status: 401 }
      );
    }

    // Validate token
    const scope = resolveRunToken(token);
    if (!scope) {
      return NextResponse.json(
        { error: "Invalid or expired run token" },
        { status: 401 }
      );
    }

    const server = getOrCreateMcpServer();

    // Create a per-request transport.
    // Pass the token as sessionId so the MCP server can resolve scope in tool handlers.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => token,
    });

    // Connect server to transport for this request
    await server.connect(transport);

    // Handle the request body through the transport
    const body = await request.text();
    const response = await transport.handleRequest(
      JSON.parse(body),
      new URL(request.url)
    );

    // The transport returns the MCP response
    if (response) {
      return NextResponse.json(response);
    }

    return NextResponse.json(
      { error: "No response from MCP server" },
      { status: 500 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, "MCP route error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET handler — MCP protocol requires this for session initialization.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    { error: "MCP Streamable HTTP requires POST" },
    { status: 405 }
  );
}
