// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/smoke.test`
 * Purpose: E2E smoke tests — full deploy lifecycle via HTTP.
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
import { createDeployRoutes } from "./routes/deploy.js";
import { handleLivez, handleReadyz } from "./routes/health.js";
import { MockContainerRuntime } from "./runtime/mock.adapter.js";

const DEPLOYMENT_PATTERN = /^\/api\/v1\/deployments\/([^/]+)$/;

async function startTestServer(): Promise<{ server: Server; baseUrl: string }> {
  const log = pino({ level: "silent" });
  const runtime = new MockContainerRuntime();
  const routes = createDeployRoutes(runtime, log);

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
    if (method === "GET" && path === "/api/v1/workloads")
      return routes.listWorkloads(req, res);

    const m = DEPLOYMENT_PATTERN.exec(path);
    if (m) {
      if (method === "GET") return routes.getDeployment(req, res);
      if (method === "DELETE") return routes.stopDeployment(req, res);
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

const TWO_WORKLOADS = {
  name: "test-deployment",
  workloads: [
    {
      name: "mcp-github",
      image: "ghcr.io/modelcontextprotocol/server-github:latest",
      ports: [{ container: 3101, expose: false }],
    },
    {
      name: "agent-research",
      image: "ghcr.io/cogni-dao/openclaw:latest",
      ports: [{ container: 8080, expose: true }],
      connectsTo: ["mcp-github"],
    },
  ],
};

describe("akash-deployer smoke tests", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const r = await startTestServer();
    server = r.server;
    baseUrl = r.baseUrl;
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

  it("POST /api/v1/deploy → deploys workloads", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(TWO_WORKLOADS),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      deploymentId: string;
      status: string;
      workloads: unknown[];
    };
    expect(body.status).toBe("active");
    expect(body.deploymentId).toMatch(/^deploy-/);
    expect(body.workloads).toHaveLength(2);
  });

  it("GET /api/v1/deployments/:id → retrieves deployment", async () => {
    const deployRes = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "get-test",
        workloads: [
          { name: "svc", image: "alpine", ports: [{ container: 80 }] },
        ],
      }),
    });
    const { deploymentId } = (await deployRes.json()) as {
      deploymentId: string;
    };

    const res = await fetch(`${baseUrl}/api/v1/deployments/${deploymentId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deploymentId: string;
      workloads: Array<{ status: string }>;
    };
    expect(body.deploymentId).toBe(deploymentId);
    expect(body.workloads[0]?.status).toBe("running");
  });

  it("DELETE /api/v1/deployments/:id → stops workloads", async () => {
    const deployRes = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "stop-test",
        workloads: [
          { name: "svc", image: "alpine", ports: [{ container: 80 }] },
        ],
      }),
    });
    const { deploymentId } = (await deployRes.json()) as {
      deploymentId: string;
    };

    const res = await fetch(`${baseUrl}/api/v1/deployments/${deploymentId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/workloads → lists all workloads", async () => {
    const res = await fetch(`${baseUrl}/api/v1/workloads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workloads: unknown[] };
    expect(body.workloads.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/deployments/bogus → 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deployments/bogus`);
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
