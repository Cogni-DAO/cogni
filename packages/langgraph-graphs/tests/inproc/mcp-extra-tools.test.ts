// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/tests/inproc/mcp-tool-source`
 * Purpose: Verify McpToolSource wraps MCP tools as BoundToolRuntime for toolRunner pipeline.
 * Scope: Tests McpToolSource + McpBoundToolRuntime. Does NOT test MCP connectivity.
 * Invariants:
 *   - TOOLS_VIA_TOOLRUNNER: MCP tools execute through BoundToolRuntime.exec()
 *   - TOOL_SOURCE_RETURNS_BOUND_TOOL: getBoundTool returns executable runtime
 * Side-effects: none (all mocked)
 * Links: {@link ../../src/runtime/mcp/tool-source.ts McpToolSource}
 * @internal
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mcpToolToBoundRuntime } from "../../src/runtime/mcp/bound-tool";
import { McpToolSource } from "../../src/runtime/mcp/tool-source";

describe("McpToolSource", () => {
  function makeFakeTool(name: string, description: string) {
    return new DynamicStructuredTool({
      name,
      description,
      schema: z.object({ input: z.string() }),
      func: async (args) => `result: ${args.input}`,
    });
  }

  it("getBoundTool returns BoundToolRuntime for loaded tool", () => {
    const tool = makeFakeTool("grafana__get_dashboard", "Get dashboard");
    const source = new McpToolSource([tool]);

    const runtime = source.getBoundTool("grafana__get_dashboard");
    expect(runtime).toBeDefined();
    expect(runtime?.id).toBe("grafana__get_dashboard");
    expect(runtime?.effect).toBe("external_side_effect");
    expect(runtime?.requiresConnection).toBe(false);
  });

  it("getBoundTool returns undefined for unknown tool", () => {
    const source = new McpToolSource([]);
    expect(source.getBoundTool("nonexistent")).toBeUndefined();
  });

  it("listToolSpecs returns specs for all loaded tools", () => {
    const tools = [
      makeFakeTool("server__tool_a", "Tool A"),
      makeFakeTool("server__tool_b", "Tool B"),
    ];
    const source = new McpToolSource(tools);

    const specs = source.listToolSpecs();
    expect(specs).toHaveLength(2);
    expect(specs[0].name).toBe("server__tool_a");
    expect(specs[1].name).toBe("server__tool_b");
  });

  it("hasToolId returns true for loaded tools", () => {
    const tool = makeFakeTool("playwright__navigate", "Navigate");
    const source = new McpToolSource([tool]);

    expect(source.hasToolId("playwright__navigate")).toBe(true);
    expect(source.hasToolId("nonexistent")).toBe(false);
  });

  it("getToolIdsForServer filters by server prefix", () => {
    const tools = [
      makeFakeTool("grafana__get_dashboard", "Dashboard"),
      makeFakeTool("grafana__query_loki", "Loki query"),
      makeFakeTool("playwright__navigate", "Navigate"),
    ];
    const source = new McpToolSource(tools);

    const grafanaTools = source.getToolIdsForServer("grafana");
    expect(grafanaTools).toHaveLength(2);
    expect(grafanaTools).toContain("grafana__get_dashboard");
    expect(grafanaTools).toContain("grafana__query_loki");

    const playwrightTools = source.getToolIdsForServer("playwright");
    expect(playwrightTools).toHaveLength(1);
    expect(playwrightTools).toContain("playwright__navigate");
  });
});

describe("McpBoundToolRuntime", () => {
  it("exec delegates to StructuredToolInterface.invoke()", async () => {
    const tool = new DynamicStructuredTool({
      name: "test__echo",
      description: "Echo input",
      schema: z.object({ message: z.string() }),
      func: async (args) => `echo: ${args.message}`,
    });

    const runtime = mcpToolToBoundRuntime(tool);

    const result = await runtime.exec(
      { message: "hello" },
      { runId: "run-1", toolCallId: "tc-1" },
      {}
    );

    expect(result).toBe("echo: hello");
  });

  it("validates input as passthrough", () => {
    const tool = new DynamicStructuredTool({
      name: "test__tool",
      description: "Test",
      schema: z.object({}),
      func: async () => "ok",
    });

    const runtime = mcpToolToBoundRuntime(tool);
    const input = { foo: "bar" };
    expect(runtime.validateInput(input)).toBe(input);
  });

  it("redacts output as passthrough", () => {
    const tool = new DynamicStructuredTool({
      name: "test__tool",
      description: "Test",
      schema: z.object({}),
      func: async () => "ok",
    });

    const runtime = mcpToolToBoundRuntime(tool);
    const output = { sensitive: "data" };
    expect(runtime.redact(output)).toBe(output);
  });

  it("spec has correct effect and schema", () => {
    const tool = new DynamicStructuredTool({
      name: "mcp__server__my_tool",
      description: "A useful tool",
      schema: z.object({ query: z.string() }),
      func: async () => "result",
    });

    const runtime = mcpToolToBoundRuntime(tool);

    expect(runtime.spec.name).toBe("mcp__server__my_tool");
    expect(runtime.spec.description).toBe("A useful tool");
    expect(runtime.spec.effect).toBe("external_side_effect");
  });
});
