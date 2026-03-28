// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/tests/inproc/mcp-real-server`
 * Purpose: Integration test — load tools from a real MCP server via stdio transport.
 * Scope: Validates loadMcpTools() against @modelcontextprotocol/server-everything. Does NOT test bootstrap wiring.
 * Invariants: none (integration tests)
 * Side-effects: IO (spawns MCP server subprocess via stdio)
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

    const tools = await loadMcpTools(config);

    // server-everything exposes several tools (echo, add, longRunningOperation, etc.)
    expect(tools.length).toBeGreaterThan(0);

    const toolNames = tools.map((t) => t.name);

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

    const tools = await loadMcpTools(config);
    const echoTool = tools.find((t) => t.name === "everything__echo");
    expect(echoTool).toBeDefined();

    // Actually invoke the echo tool
    const result = await echoTool?.invoke({ message: "hello from cogni" });

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    // server-everything's echo tool returns the message back
    expect(result).toContain("hello from cogni");
  }, 30_000);

  it("returns empty array for unreachable server (onConnectionError: ignore)", async () => {
    const config: McpServersConfig = {
      broken: {
        transport: "stdio",
        command: "nonexistent-binary-that-does-not-exist",
      },
    };

    // Should not throw, should return empty tools
    const tools = await loadMcpTools(config);
    expect(tools).toEqual([]);
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

    const tools = await loadMcpTools(config);
    const toolNames = tools.map((t) => t.name);

    // Should have tools from both servers, prefixed differently
    const server1Tools = toolNames.filter((n) => n.startsWith("server1__"));
    const server2Tools = toolNames.filter((n) => n.startsWith("server2__"));

    expect(server1Tools.length).toBeGreaterThan(0);
    expect(server2Tools.length).toBeGreaterThan(0);
    expect(server1Tools.length).toBe(server2Tools.length);
  }, 30_000);
});
