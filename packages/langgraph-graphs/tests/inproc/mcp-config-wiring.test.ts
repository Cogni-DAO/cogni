// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
/**
 * Module: `@cogni/langgraph-graphs/tests/inproc/mcp-config-wiring`
 * Purpose: Verify MCP config parsing: env interpolation, disabled filtering, transport inference.
 * Scope: Tests parseMcpConfigFromEnv() and interpolateEnvVars(). Does NOT test MCP connectivity.
 * Invariants: none (unit tests)
 * Side-effects: none (reads temp files, no network)
 * Links: {@link ../../src/runtime/mcp/client.ts parseMcpConfigFromEnv}
 * @internal
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  interpolateEnvVars,
  parseMcpConfigFromEnv,
} from "../../src/runtime/mcp/client";

/** Build "${VAR}" placeholder strings without triggering biome noTemplateCurlyInString */
const v = (name: string) => "$" + `{${name}}`;

describe("interpolateEnvVars", () => {
  it("replaces env var placeholders with env value", () => {
    const result = interpolateEnvVars(`Bearer ${v("TOKEN")}`, {
      TOKEN: "abc123",
    });
    expect(result).toBe("Bearer abc123");
  });

  it("replaces multiple vars in one string", () => {
    const result = interpolateEnvVars(
      `${v("PROTO")}://${v("HOST")}:${v("PORT")}`,
      {
        PROTO: "http",
        HOST: "localhost",
        PORT: "3000",
      }
    );
    expect(result).toBe("http://localhost:3000");
  });

  it("replaces unset vars with empty string", () => {
    const result = interpolateEnvVars(v("MISSING_VAR"), {});
    expect(result).toBe("");
  });

  it("leaves strings without placeholders unchanged", () => {
    expect(interpolateEnvVars("plain string", {})).toBe("plain string");
  });
});

describe("parseMcpConfigFromEnv (config file)", () => {
  function writeTempConfig(content: object): string {
    const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    const path = join(dir, "mcp.servers.json");
    writeFileSync(path, JSON.stringify(content));
    return path;
  }

  it("reads mcpServers from config file and interpolates env vars", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        grafana: {
          transport: "http",
          url: v("MCP_GRAFANA_URL"),
          headers: { Authorization: `Bearer ${v("GRAFANA_TOKEN")}` },
        },
      },
    });

    const config = parseMcpConfigFromEnv({
      MCP_CONFIG_PATH: configPath,
      MCP_GRAFANA_URL: "http://localhost:3001",
      GRAFANA_TOKEN: "glsa_test_token_123",
    });

    expect(config).toHaveProperty("grafana");
    expect(config.grafana.transport).toBe("http");
    expect((config.grafana as { url: string }).url).toBe(
      "http://localhost:3001"
    );
    expect(
      (config.grafana as { headers: Record<string, string> }).headers
        .Authorization
    ).toBe("Bearer glsa_test_token_123");
  });

  it("filters out disabled servers", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        enabled: {
          transport: "http",
          url: "http://localhost:3000",
        },
        disabled_server: {
          transport: "stdio",
          command: "echo",
          disabled: true,
        },
      },
    });

    const config = parseMcpConfigFromEnv({ MCP_CONFIG_PATH: configPath });

    expect(config).toHaveProperty("enabled");
    expect(config).not.toHaveProperty("disabled_server");
  });

  it("infers stdio transport from command field", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        myserver: {
          command: "npx",
          args: ["-y", "some-server"],
        },
      },
    });

    const config = parseMcpConfigFromEnv({ MCP_CONFIG_PATH: configPath });

    expect(config.myserver.transport).toBe("stdio");
    expect((config.myserver as { command: string }).command).toBe("npx");
  });

  it("infers http transport from url field", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        remote: {
          url: "https://example.com/mcp",
        },
      },
    });

    const config = parseMcpConfigFromEnv({ MCP_CONFIG_PATH: configPath });

    expect(config.remote.transport).toBe("http");
    expect((config.remote as { url: string }).url).toBe(
      "https://example.com/mcp"
    );
  });

  it("MCP_SERVERS takes priority over MCP_CONFIG_PATH", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        fromfile: { transport: "http", url: "https://file.example" },
      },
    });

    const config = parseMcpConfigFromEnv({
      MCP_SERVERS: JSON.stringify({
        fromenv: { transport: "http", url: "https://env.example" },
      }),
      MCP_CONFIG_PATH: configPath,
    });

    expect(config).not.toHaveProperty("fromfile");
    expect(config).toHaveProperty("fromenv");
  });

  it("returns empty config when no env vars set", () => {
    const config = parseMcpConfigFromEnv({});
    expect(config).toEqual({});
  });

  it("interpolates env vars in args and nested env fields", () => {
    const configPath = writeTempConfig({
      mcpServers: {
        custom: {
          transport: "stdio",
          command: "docker",
          args: ["run", "--rm", "-e", `API_KEY=${v("MY_KEY")}`, "myimage"],
          env: { SECRET: v("MY_SECRET") },
        },
      },
    });

    const config = parseMcpConfigFromEnv({
      MCP_CONFIG_PATH: configPath,
      MY_KEY: "k3y",
      MY_SECRET: "s3cret",
    });

    const custom = config.custom as {
      args: string[];
      env: Record<string, string>;
    };
    expect(custom.args[3]).toBe("API_KEY=k3y");
    expect(custom.env.SECRET).toBe("s3cret");
  });

  it("matches the committed config/mcp.servers.json shape", () => {
    // This test validates against the actual committed config file format.
    // Grafana MCP uses stdio transport (Docker subprocess) with auth via
    // GRAFANA_SERVICE_ACCOUNT_TOKEN env var passed to the container.
    const configPath = writeTempConfig({
      mcpServers: {
        grafana: {
          transport: "stdio",
          command: "docker",
          args: [
            "run",
            "--rm",
            "--init",
            "-i",
            "--network",
            "cogni-edge",
            "-e",
            `GRAFANA_URL=${v("GRAFANA_URL")}`,
            "-e",
            `GRAFANA_SERVICE_ACCOUNT_TOKEN=${v("GRAFANA_SERVICE_ACCOUNT_TOKEN")}`,
            "mcp/grafana",
            "-t",
            "stdio",
          ],
          disabled: false,
        },
        everything: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
          disabled: true,
        },
      },
    });

    const config = parseMcpConfigFromEnv({
      MCP_CONFIG_PATH: configPath,
      GRAFANA_URL: "http://grafana:3000",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_prod_token",
    });

    // Grafana is enabled with interpolated args
    expect(config).toHaveProperty("grafana");
    expect(config.grafana.transport).toBe("stdio");
    const grafanaArgs = (config.grafana as { args: string[] }).args;
    expect(grafanaArgs).toContain("GRAFANA_URL=http://grafana:3000");
    expect(grafanaArgs).toContain(
      "GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_prod_token"
    );

    // Everything is disabled
    expect(config).not.toHaveProperty("everything");

    // Only grafana should be present
    expect(Object.keys(config)).toEqual(["grafana"]);
  });
});
