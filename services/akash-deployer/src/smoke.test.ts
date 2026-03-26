// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/smoke.test`
 * Purpose: E2E smoke tests — start server, hit every endpoint, verify responses.
 * Scope: Tests only. Does NOT contain production code.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockClusterProvider } from "./provider/mock-provider.js";
import { createDeployRoutes } from "./routes/deploy.js";
import { handleLivez, handleReadyz } from "./routes/health.js";

const DEPLOY_PATTERN = /^\/api\/v1\/deployments\/([^/]+)$/;

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const log = pino({ level: "silent" });
  const provider = new MockClusterProvider();
  const routes = createDeployRoutes(provider, log);

  const server = createServer(async (req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (path === "/livez") return handleLivez(req, res);
    if (path === "/readyz") return handleReadyz(req, res);
    if (method === "POST" && path === "/api/v1/deploy")
      return routes.deploy(req, res);
    if (method === "POST" && path === "/api/v1/preview")
      return routes.preview(req, res);

    const m = DEPLOY_PATTERN.exec(path);
    if (m) {
      if (method === "GET") return routes.getDeployment(req, res);
      if (method === "DELETE") return routes.closeDeployment(req, res);
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const SAMPLE_REQUEST = {
  name: "test-deploy",
  services: [
    {
      name: "mcp-memory",
      image: "ghcr.io/modelcontextprotocol/server-memory:latest",
      port: 3103,
      cpu: 0.25,
      memory: "256Mi",
      storage: "512Mi",
    },
    {
      name: "agent-research",
      image: "ghcr.io/cogni-dao/openclaw:latest",
      port: 8080,
      exposeGlobal: true,
      connectsTo: ["mcp-memory"],
    },
  ],
};

describe("akash-deployer service", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const result = await startTestServer();
    server = result.server;
    baseUrl = result.baseUrl;
  });

  afterAll(() => {
    server?.close();
  });

  it("GET /livez → 200", async () => {
    const res = await fetch(`${baseUrl}/livez`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("GET /readyz → 200", async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
  });

  it("POST /api/v1/preview → SDL without deploying", async () => {
    const res = await fetch(`${baseUrl}/api/v1/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SAMPLE_REQUEST),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sdl: string; services: string[] };
    expect(body.sdl).toContain("version:");
    expect(body.services).toContain("agent-research");
    expect(body.services).toContain("mcp-memory");
  });

  it("POST /api/v1/deploy → creates deployment", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SAMPLE_REQUEST),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      deploymentId: string;
      status: string;
      services: string[];
      endpoints: Record<string, string>;
    };
    expect(body.status).toBe("active");
    expect(body.deploymentId).toMatch(/^mock-/);
    expect(body.services).toContain("agent-research");
    expect(body.endpoints["agent-research"]).toBeDefined();
  });

  it("GET /api/v1/deployments/:id → retrieves deployment", async () => {
    // Deploy first
    const deployRes = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "get-test",
        services: [{ name: "svc", image: "alpine", port: 80 }],
      }),
    });
    const { deploymentId } = (await deployRes.json()) as {
      deploymentId: string;
    };

    const res = await fetch(`${baseUrl}/api/v1/deployments/${deploymentId}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deploymentId: string }).deploymentId).toBe(
      deploymentId
    );
  });

  it("DELETE /api/v1/deployments/:id → closes deployment", async () => {
    const deployRes = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "close-test",
        services: [{ name: "svc", image: "alpine", port: 80 }],
      }),
    });
    const { deploymentId } = (await deployRes.json()) as {
      deploymentId: string;
    };

    const res = await fetch(`${baseUrl}/api/v1/deployments/${deploymentId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("closed");
  });

  it("GET /api/v1/deployments/nonexistent → 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deployments/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("POST /api/v1/deploy with bad JSON → 400", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("GET /unknown → 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});
