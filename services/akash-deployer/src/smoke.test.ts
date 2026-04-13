// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/smoke.test`
 * Purpose: E2E smoke tests — full group deploy lifecycle via HTTP.
 * Scope: Tests only. Does NOT contain production code.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MockContainerRuntime } from "@cogni/container-runtime/adapters/mock";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeployRoutes } from "./routes/deploy.js";
import { handleLivez, handleReadyz } from "./routes/health.js";

const GROUP_PATTERN = /^\/api\/v1\/groups\/([^/]+)$/;

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
    if (method === "GET" && path === "/api/v1/groups")
      return routes.listGroups(req, res);

    const m = GROUP_PATTERN.exec(path);
    if (m) {
      if (method === "GET") return routes.getGroup(req, res);
      if (method === "DELETE") return routes.destroyGroup(req, res);
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

  it("POST /api/v1/deploy → creates group with workloads", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-group",
        workloads: [
          {
            name: "mcp-github",
            image: "mcp/github:latest",
            ports: [{ container: 3101 }],
          },
          {
            name: "agent",
            image: "openclaw:latest",
            ports: [{ container: 8080, expose: true }],
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      groupId: string;
      status: string;
      workloads: unknown[];
    };
    expect(body.groupId).toMatch(/^grp-/);
    expect(body.status).toBe("active");
    expect(body.workloads).toHaveLength(2);
  });

  it("GET /api/v1/groups/:id → retrieves group", async () => {
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
    const { groupId } = (await deployRes.json()) as { groupId: string };

    const res = await fetch(`${baseUrl}/api/v1/groups/${groupId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groupId: string;
      workloads: Array<{ status: string }>;
    };
    expect(body.groupId).toBe(groupId);
    expect(body.workloads[0]?.status).toBe("running");
  });

  it("DELETE /api/v1/groups/:id → destroys group", async () => {
    const deployRes = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "destroy-test",
        workloads: [
          { name: "svc", image: "alpine", ports: [{ container: 80 }] },
        ],
      }),
    });
    const { groupId } = (await deployRes.json()) as { groupId: string };

    const res = await fetch(`${baseUrl}/api/v1/groups/${groupId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("stopped");
  });

  it("GET /api/v1/groups → lists all groups", async () => {
    const res = await fetch(`${baseUrl}/api/v1/groups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[] };
    expect(body.groups.length).toBeGreaterThan(0);
  });

  it("workloads in a group get internal endpoints", async () => {
    const res = await fetch(`${baseUrl}/api/v1/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "internal-net",
        workloads: [
          { name: "db", image: "postgres:16", ports: [{ container: 5432 }] },
          {
            name: "app",
            image: "myapp:latest",
            ports: [{ container: 3000, expose: true }],
          },
        ],
      }),
    });
    const body = (await res.json()) as {
      workloads: Array<{ name: string; endpoints: Record<string, string> }>;
    };
    const db = body.workloads.find((w) => w.name === "db");
    expect(db?.endpoints.internal).toBe("http://db:5432");
  });

  it("GET /api/v1/groups/bogus → 404", async () => {
    const res = await fetch(`${baseUrl}/api/v1/groups/bogus`);
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
});
