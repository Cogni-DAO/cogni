// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/mcp/bound-tool`
 * Purpose: Adapt MCP StructuredToolInterface to BoundToolRuntime for toolRunner pipeline.
 * Scope: Maps MCP tool schema/exec to ai-core's BoundToolRuntime interface. Does NOT perform I/O directly.
 * Invariants:
 *   - TOOLS_VIA_TOOLRUNNER: MCP tools execute through toolRunner.exec()
 *   - MCP_EFFECT_EXTERNAL: All MCP tools are external_side_effect by default
 *   - MCP_REDACTION_PASSTHROUGH: MCP tool output is not redacted (tools control their own output)
 * Side-effects: IO (delegates exec to MCP server via StructuredToolInterface)
 * Links: {@link ../../inproc/types.ts}, {@link @cogni/ai-core BoundToolRuntime}
 * @internal
 */

import type {
  BoundToolRuntime,
  ToolCapabilities,
  ToolInvocationContext,
  ToolSpec,
} from "@cogni/ai-core";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Create a BoundToolRuntime from an MCP StructuredToolInterface.
 *
 * This adapter bridges MCP tools into the standard toolRunner pipeline.
 * MCP tools bypass Zod validation (they use JSON Schema natively) and
 * redaction (MCP servers control their own output).
 *
 * @param tool - LangChain StructuredToolInterface from @langchain/mcp-adapters
 * @returns BoundToolRuntime compatible with ai-core toolRunner
 */
export function mcpToolToBoundRuntime(
  tool: StructuredToolInterface
): BoundToolRuntime {
  const toolId = tool.name;

  // Build ToolSpec from MCP tool metadata
  const spec: ToolSpec = {
    name: toolId,
    description: tool.description ?? "",
    inputSchema: (tool.schema as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
    },
    effect: "external_side_effect",
    redaction: { mode: "top_level_only", allowlist: [] },
  };

  return {
    id: toolId,
    spec,
    effect: "external_side_effect",
    requiresConnection: false,
    capabilities: [],

    validateInput(rawArgs: unknown): unknown {
      // MCP tools accept JSON — LangChain adapter handles validation internally
      return rawArgs;
    },

    async exec(
      validatedArgs: unknown,
      _ctx: ToolInvocationContext,
      _capabilities: ToolCapabilities
    ): Promise<unknown> {
      // Delegate to MCP server via the LangChain adapter
      const result = await tool.invoke(
        validatedArgs as Record<string, unknown>
      );
      return result;
    },

    validateOutput(rawOutput: unknown): unknown {
      // MCP tools control their own output format
      return rawOutput;
    },

    redact(validatedOutput: unknown): unknown {
      // MCP_REDACTION_PASSTHROUGH: MCP output is returned as-is
      // MCP servers are responsible for their own output filtering
      return validatedOutput;
    },
  };
}
