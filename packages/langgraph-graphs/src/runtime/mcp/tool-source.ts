// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/mcp/tool-source`
 * Purpose: ToolSourcePort implementation for MCP tools.
 * Scope: Wraps loaded MCP StructuredToolInterface[] as BoundToolRuntime entries. Does NOT perform I/O.
 * Invariants:
 *   - TOOL_SOURCE_RETURNS_BOUND_TOOL: getBoundTool returns executable BoundToolRuntime
 *   - TOOL_ID_NAMESPACED: MCP tools use mcp__{server}__{tool} naming
 *   - MCP_UNTRUSTED_BY_DEFAULT: Presence in source ≠ enabled; policy allowlist gates execution
 * Side-effects: none (wraps already-loaded tools)
 * Links: {@link @cogni/ai-core ToolSourcePort}
 * @public
 */

import type {
  BoundToolRuntime,
  ToolSourcePort,
  ToolSpec,
} from "@cogni/ai-core";
import type { StructuredToolInterface } from "@langchain/core/tools";

import { mcpToolToBoundRuntime } from "./bound-tool";

/**
 * ToolSourcePort implementation for MCP tools.
 *
 * Wraps pre-loaded MCP StructuredToolInterface[] into BoundToolRuntime entries.
 * Tools are indexed by their prefixed name (e.g., "mcp__playwright__browser_navigate").
 *
 * This source can be composed with the native StaticToolSource via
 * AggregatingToolSource to provide a unified tool catalog to toolRunner.
 */
export class McpToolSource implements ToolSourcePort {
  private readonly toolMap: ReadonlyMap<string, BoundToolRuntime>;
  private readonly specs: readonly ToolSpec[];

  constructor(tools: readonly StructuredToolInterface[]) {
    const map = new Map<string, BoundToolRuntime>();
    const specs: ToolSpec[] = [];

    for (const tool of tools) {
      const runtime = mcpToolToBoundRuntime(tool);
      map.set(runtime.id, runtime);
      specs.push(runtime.spec);
    }

    this.toolMap = map;
    this.specs = specs;
  }

  getBoundTool(toolId: string): BoundToolRuntime | undefined {
    return this.toolMap.get(toolId);
  }

  listToolSpecs(): readonly ToolSpec[] {
    return this.specs;
  }

  hasToolId(toolId: string): boolean {
    return this.toolMap.has(toolId);
  }

  /** Get all tool IDs from a specific MCP server (by server name prefix). */
  getToolIdsForServer(serverName: string): readonly string[] {
    const prefix = `${serverName}__`;
    return [...this.toolMap.keys()].filter((id) => id.startsWith(prefix));
  }
}
