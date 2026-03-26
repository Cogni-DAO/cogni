// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/main`
 * Purpose: HTTP server entrypoint for the Akash deployer service.
 * Scope: Server bootstrap — wires config, provider, routes. Does NOT contain business logic.
 * Invariants:
 *   - HEALTH_FIRST: /livez and /readyz always available.
 *   - GRACEFUL_SHUTDOWN: SIGTERM triggers clean disconnect.
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 */

import crypto from "node:crypto";
import { createServer } from "node:http";
import pino from "pino";
import { loadConfig } from "./config/env.js";
import { MockClusterProvider } from "./provider/mock-provider.js";
import { createDeployRoutes } from "./routes/deploy.js";
import { handleLivez, handleReadyz } from "./routes/health.js";

const config = loadConfig();

const pinoOpts: pino.LoggerOptions = { level: config.LOG_LEVEL };
if (process.env.NODE_ENV !== "production") {
  pinoOpts.transport = { target: "pino/file", options: { destination: 1 } };
}
const log = pino(pinoOpts);

const provider = new MockClusterProvider();
const routes = createDeployRoutes(provider, log);

function verifyToken(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const DEPLOYMENT_ID_PATTERN = /^\/api\/v1\/deployments\/([^/]+)$/;

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  );
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (path === "/livez") return handleLivez(req, res);
  if (path === "/readyz") return handleReadyz(req, res);

  // Auth
  if (path.startsWith("/api/") && config.INTERNAL_OPS_TOKEN) {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (!verifyToken(token, config.INTERNAL_OPS_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  // Routes
  if (method === "POST" && path === "/api/v1/deploy")
    return routes.deploy(req, res);
  if (method === "POST" && path === "/api/v1/preview")
    return routes.preview(req, res);

  const idMatch = DEPLOYMENT_ID_PATTERN.exec(path);
  if (idMatch) {
    if (method === "GET") return routes.getDeployment(req, res);
    if (method === "DELETE") return routes.closeDeployment(req, res);
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(config.PORT, config.HOST, () => {
  log.info({ port: config.PORT, host: config.HOST }, "Akash deployer started");
});

const shutdown = () => {
  log.info("Shutting down...");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
