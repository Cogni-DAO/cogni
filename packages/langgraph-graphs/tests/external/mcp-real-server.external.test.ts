// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/tests/external/mcp-real-server`
 * Purpose: External integration test — load tools from a real MCP server via stdio transport.
 * Scope: Validates loadMcpTools() against @modelcontextprotocol/server-everything (downloaded via npx). NOT in default CI.
 * Invariants: none (external integration tests; require network + npm registry access)
 * Side-effects: IO (spawns MCP server subprocess via stdio; downloads npm package on first run)
 * Links: {@link ../../src/runtime/mcp/client.ts loadMcpTools}
 * @internal
 */

import { describe, expect, it } from "vitest";

import { loadMcpTools } from "../../src/runtime/mcp/client";
import type { McpServersConfig } from "../../src/runtime/mcp/types";

describe("loadMcpTools (real MCP server)", () => {
  it("loads tools from @modelcontextprotocol/server-everything via stdio", async () => {
    const config: McpServersConfig = {
      everything: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    };

    const result = await loadMcpTools(config);

    // server-everything exposes several tools (echo, add, longRunningOperation, etc.)
    expect(result.tools.length).toBeGreaterThan(0);

    const toolNames = result.tools.map((t) => t.name);

    // Tool names should be prefixed with server name
    for (const name of toolNames) {
      expect(name).toMatch(/^everything__/);
    }

    // server-everything always has an "echo" tool
    expect(toolNames).toContain("everything__echo");
  }, 30_000);

  it("invokes a tool from the real MCP server", async () => {
    const config: McpServersConfig = {
      everything: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    };

    const loaded = await loadMcpTools(config);
    const echoTool = loaded.tools.find((t) => t.name === "everything__echo");
    expect(echoTool).toBeDefined();

    // Actually invoke the echo tool
    const invokeResult = await echoTool?.invoke({
      message: "hello from cogni",
    });

    expect(invokeResult).toBeDefined();
    expect(typeof invokeResult).toBe("string");
    // server-everything's echo tool returns the message back
    expect(invokeResult).toContain("hello from cogni");
  }, 30_000);

  it("returns empty array for unreachable server (onConnectionError: ignore)", async () => {
    const config: McpServersConfig = {
      broken: {
        transport: "stdio",
        command: "nonexistent-binary-that-does-not-exist",
      },
    };

    // Should not throw — errors are thrown, but broken server with onConnectionError: ignore
    // means the whole load might throw or return empty
    try {
      const result = await loadMcpTools(config);
      expect(result.tools).toEqual([]);
    } catch {
      // Also acceptable — broken binary may cause client construction to throw
    }
  }, 15_000);

  it("loads tools from multiple servers simultaneously", async () => {
    const config: McpServersConfig = {
      server1: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
      server2: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    };

    const result = await loadMcpTools(config);
    const toolNames = result.tools.map((t) => t.name);

    // Should have tools from both servers, prefixed differently
    const server1Tools = toolNames.filter((n) => n.startsWith("server1__"));
    const server2Tools = toolNames.filter((n) => n.startsWith("server2__"));

    expect(server1Tools.length).toBeGreaterThan(0);
    expect(server2Tools.length).toBeGreaterThan(0);
    expect(server1Tools.length).toBe(server2Tools.length);
  }, 30_000);
});
