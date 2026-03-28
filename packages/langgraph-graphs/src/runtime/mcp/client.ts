// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/mcp/client`
 * Purpose: Create LangChain tools from external MCP servers.
 * Scope: Spike — bypasses ToolRunner pipeline. Does NOT handle policy, billing, or redaction.
 * Invariants:
 *   - SPIKE_ONLY: This does NOT flow through ToolRunner (no policy, no billing, no redaction)
 *   - MCP tools are prefixed with server name to avoid collisions
 *   - Connection errors are logged and skipped (don't break the agent)
 *   - ENV_INTERPOLATION: ${VAR} in config values are replaced with process.env[VAR]
 * Side-effects: IO (connects to MCP servers, spawns subprocesses for stdio transport)
 * Links: {@link ../types.ts McpServersConfig}
 * @internal
 */

import { readFileSync } from "node:fs";

import type { StructuredToolInterface } from "@langchain/core/tools";

import type { McpServerConfig, McpServersConfig } from "./types";

/**
 * Load tools from configured MCP servers.
 *
 * Returns LangChain StructuredToolInterface[] ready to merge with
 * existing tools in createReactAgent.
 *
 * Spike: tools bypass our ToolRunner pipeline entirely.
 * Path B (proj.agentic-interop) will create McpToolSource implementing ToolSourcePort.
 *
 * @param config - Map of server name → transport config
 * @returns LangChain tools from all reachable MCP servers
 */
export async function loadMcpTools(
  config: McpServersConfig
): Promise<StructuredToolInterface[]> {
  if (Object.keys(config).length === 0) {
    return [];
  }

  // Dynamic import to avoid loading MCP deps when not configured
  const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");

  // Convert our config to @langchain/mcp-adapters Connection format.
  // We build plain objects matching the Connection schema then cast,
  // because the Zod-inferred Connection type is hard to construct incrementally.
  const connections: Record<string, unknown> = {};

  for (const [name, serverConfig] of Object.entries(config)) {
    switch (serverConfig.transport) {
      case "stdio":
        connections[name] = {
          transport: "stdio" as const,
          command: serverConfig.command,
          args: serverConfig.args ? [...serverConfig.args] : [],
          ...(serverConfig.env && { env: { ...serverConfig.env } }),
        };
        break;
      case "http":
        connections[name] = {
          transport: "http" as const,
          url: serverConfig.url,
          ...(serverConfig.headers && {
            headers: { ...serverConfig.headers },
          }),
        };
        break;
      case "sse":
        connections[name] = {
          transport: "sse" as const,
          url: serverConfig.url,
          ...(serverConfig.headers && {
            headers: { ...serverConfig.headers },
          }),
        };
        break;
    }
  }

  // Zod-inferred ClientConfig type is hard to construct incrementally from our types
  const clientConfig = {
    mcpServers: connections,
    prefixToolNameWithServerName: true,
    onConnectionError: "ignore",
  };
  // biome-ignore lint/suspicious/noExplicitAny: cast needed — our config objects match the Zod schema at runtime
  const client = new MultiServerMCPClient(clientConfig as any);

  try {
    const tools = await client.getTools();
    // Note: we do NOT close the client here — tools need active connections
    // to execute. The client will be GC'd when the tools are no longer referenced.
    // For production (Path B), we'd manage client lifecycle explicitly.
    return tools as StructuredToolInterface[];
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
    console.error("[mcp-client] Failed to load MCP tools:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Environment variable interpolation
// ---------------------------------------------------------------------------

/**
 * Replace `${VAR_NAME}` placeholders in a string with values from process.env.
 * Unresolved vars are replaced with empty string (logs a warning).
 */
export function interpolateEnvVars(
  value: string,
  // biome-ignore lint/style/noProcessEnv: MCP config reads env vars by design
  env: Record<string, string | undefined> = process.env
): string {
  return value.replace(/\$\{([^}]+)}/g, (_match, varName: string) => {
    const resolved = env[varName];
    if (resolved === undefined) {
      // biome-ignore lint/suspicious/noConsole: warning for missing env vars
      console.warn(
        `[mcp-config] Environment variable \${${varName}} is not set`
      );
      return "";
    }
    return resolved;
  });
}

/**
 * Deep-interpolate all string values in a JSON-like structure.
 */
function interpolateDeep<T>(
  obj: T,
  env: Record<string, string | undefined>
): T {
  if (typeof obj === "string") return interpolateEnvVars(obj, env) as T;
  if (Array.isArray(obj)) return obj.map((v) => interpolateDeep(v, env)) as T;
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = interpolateDeep(v, env);
    }
    return result as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

/**
 * Raw server entry as it appears in mcp.servers.json (pre-interpolation).
 * Includes `disabled` flag that gets filtered out during parsing.
 */
interface RawServerEntry {
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Parse MCP server config from environment.
 *
 * Priority:
 * 1. `MCP_SERVERS` env var — raw JSON (emergency override, already interpolated)
 * 2. `MCP_CONFIG_PATH` env var — path to mcp.servers.json (primary)
 *
 * The config file format (mcp.servers.json):
 * ```json
 * {
 *   "mcpServers": {
 *     "grafana": {
 *       "transport": "http",
 *       "url": "${MCP_GRAFANA_URL}",
 *       "headers": { "Authorization": "Bearer ${GRAFANA_TOKEN}" },
 *       "disabled": false
 *     }
 *   }
 * }
 * ```
 *
 * - `${VAR}` placeholders are replaced with process.env values
 * - Servers with `disabled: true` are skipped
 * - Transport is inferred from `command` (stdio) or `url` (http) if not specified
 *
 * @param env - Environment to read from (defaults to process.env, injectable for tests)
 * @returns Parsed config with env vars interpolated, disabled servers filtered
 */
export function parseMcpConfigFromEnv(
  // biome-ignore lint/style/noProcessEnv: MCP config reads env vars by design
  env: Record<string, string | undefined> = process.env
): McpServersConfig {
  // Priority 1: Direct JSON config (emergency override, no interpolation)
  const serversJson = env.MCP_SERVERS;
  if (serversJson) {
    try {
      return JSON.parse(serversJson) as McpServersConfig;
    } catch {
      // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
      console.error("[mcp-config] Failed to parse MCP_SERVERS env var as JSON");
      return {};
    }
  }

  // Priority 2: Config file with env interpolation
  const configPath = env.MCP_CONFIG_PATH;
  if (configPath) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      const servers: Record<string, RawServerEntry> = raw.mcpServers ?? raw;

      const config: Record<string, McpServerConfig> = {};
      for (const [name, rawServer] of Object.entries(servers)) {
        // Skip disabled servers
        if (rawServer.disabled) continue;

        // Interpolate env vars in all string values
        const server = interpolateDeep(rawServer, env);

        // Determine transport
        const transport =
          server.transport ??
          (server.command ? "stdio" : server.url ? "http" : undefined);

        if (transport === "stdio" && server.command) {
          config[name] = {
            transport: "stdio" as const,
            command: server.command,
            args: server.args,
            env: server.env,
          };
        } else if (
          (transport === "http" || transport === "sse") &&
          server.url
        ) {
          config[name] = {
            transport: transport as "http" | "sse",
            url: server.url,
            headers: server.headers,
          };
        }
      }
      return config;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: error logging for spike diagnostics
      console.error(
        `[mcp-config] Failed to read MCP config from ${configPath}:`,
        error
      );
      return {};
    }
  }

  return {};
}
