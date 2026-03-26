// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/routes/deploy`
 * Purpose: HTTP handlers for workload deployment.
 * Scope: Route handlers — delegates to MockClusterProvider. Does NOT contain business logic.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { deployRequestSchema } from "../provider/cluster-provider.js";
import type { MockClusterProvider } from "../provider/mock-provider.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createDeployRoutes(provider: MockClusterProvider, log: Logger) {
  return {
    async deploy(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const request = deployRequestSchema.parse(parsed);

        log.info(
          { name: request.name, serviceCount: request.services.length },
          "Deploying"
        );
        const deployment = await provider.deploy(request);
        log.info({ deploymentId: deployment.deploymentId }, "Active");

        json(res, 201, deployment);
      } catch (err) {
        log.error({ err }, "Deploy failed");
        if (err instanceof SyntaxError) {
          json(res, 400, { error: "Invalid JSON" });
        } else if (err instanceof Error && err.name === "ZodError") {
          json(res, 400, { error: "Invalid request", details: err.message });
        } else {
          json(res, 500, {
            error: err instanceof Error ? err.message : "Unknown",
          });
        }
      }
    },

    async preview(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const request = deployRequestSchema.parse(parsed);
        const { generateSdl } = await import("../sdl/sdl-generator.js");
        const sdl = generateSdl(request.services);

        json(res, 200, {
          name: request.name,
          services: request.services.map((s) => s.name),
          sdl,
        });
      } catch (err) {
        log.error({ err }, "Preview failed");
        json(res, 400, {
          error: err instanceof Error ? err.message : "Invalid request",
        });
      }
    },

    async getDeployment(
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );
      const match = /\/([^/]+)$/.exec(url.pathname);
      if (!match?.[1]) {
        json(res, 400, { error: "Missing deployment ID" });
        return;
      }

      const info = await provider.getDeployment(match[1]);
      if (!info) {
        json(res, 404, { error: "Not found" });
        return;
      }
      json(res, 200, info);
    },

    async closeDeployment(
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );
      const match = /\/([^/]+)$/.exec(url.pathname);
      if (!match?.[1]) {
        json(res, 400, { error: "Missing deployment ID" });
        return;
      }

      const info = await provider.closeDeployment(match[1]);
      if (!info) {
        json(res, 404, { error: "Not found" });
        return;
      }
      log.info({ deploymentId: match[1] }, "Closed");
      json(res, 200, info);
    },
  };
}
