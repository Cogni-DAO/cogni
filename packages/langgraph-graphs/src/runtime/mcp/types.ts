// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/mcp/types`
 * Purpose: Type definitions for MCP client configuration.
 * Scope: Config shapes for connecting to external MCP servers. Does NOT perform I/O.
 * Invariants:
 *   - MCP_UNTRUSTED_BY_DEFAULT: MCP tools require explicit policy enablement
 *   - Config is transport-agnostic (stdio, http, sse)
 * Side-effects: none
 * Links: {@link ./client.ts loadMcpTools}
 * @public
 */

/**
 * Stdio transport config — runs a local process.
 * Matches .mcp.json format used by Claude Code.
 */
export interface McpStdioServerConfig {
  readonly transport: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * HTTP (streamable) transport config — connects to remote server.
 * Auto-falls back to SSE if server doesn't support streamable HTTP.
 */
export interface McpHttpServerConfig {
  readonly transport: "http";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * SSE transport config — legacy, for servers that only support SSE.
 */
export interface McpSseServerConfig {
  readonly transport: "sse";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Union of all MCP server transport configs.
 */
export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSseServerConfig;

/**
 * Map of server name → config.
 * Server names are used as tool namespaces (e.g., "grafana" → tools prefixed accordingly).
 */
export type McpServersConfig = Readonly<Record<string, McpServerConfig>>;
