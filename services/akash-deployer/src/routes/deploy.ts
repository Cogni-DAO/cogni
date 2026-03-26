// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/routes/deploy`
 * Purpose: HTTP handlers for workload deployment via ContainerRuntimePort.
 * Scope: Route handlers — delegates to runtime adapter. Does NOT contain business logic.
 * Invariants: none
 * Side-effects: IO
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import type {
  ContainerRuntimePort,
  DeploymentSummary,
} from "../runtime/container-runtime.port.js";
import { deployRequestSchema } from "../runtime/container-runtime.port.js";

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

/** In-memory deployment index — maps deploymentId to workload IDs */
const deployments = new Map<string, DeploymentSummary>();
let deployCounter = 0;

export function createDeployRoutes(runtime: ContainerRuntimePort, log: Logger) {
  return {
    /** POST /api/v1/deploy — Deploy workloads */
    async deploy(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const request = deployRequestSchema.parse(parsed);

        log.info(
          { name: request.name, count: request.workloads.length },
          "Deploying"
        );

        const results = await Promise.all(
          request.workloads.map((spec) => runtime.deploy(spec))
        );

        const deploymentId = `deploy-${(++deployCounter).toString()}`;
        const allRunning = results.every((r) => r.status === "running");

        const summary: DeploymentSummary = {
          deploymentId,
          name: request.name,
          workloads: results,
          status: allRunning ? "active" : "partial",
        };

        deployments.set(deploymentId, summary);
        log.info({ deploymentId, workloads: results.length }, "Deployed");

        json(res, 201, summary);
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

    /** GET /api/v1/deployments/:id — Get deployment status */
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

      const summary = deployments.get(match[1]);
      if (!summary) {
        json(res, 404, { error: "Not found" });
        return;
      }

      // Refresh statuses from runtime
      const refreshed = await Promise.all(
        summary.workloads.map(async (w) => {
          const s = await runtime.status(w.id).catch(() => "failed" as const);
          return { ...w, status: s };
        })
      );

      json(res, 200, { ...summary, workloads: refreshed });
    },

    /** DELETE /api/v1/deployments/:id — Stop all workloads in a deployment */
    async stopDeployment(
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

      const summary = deployments.get(match[1]);
      if (!summary) {
        json(res, 404, { error: "Not found" });
        return;
      }

      await Promise.all(
        summary.workloads.map((w) => runtime.stop(w.id).catch(() => {}))
      );

      const stopped: DeploymentSummary = { ...summary, status: "failed" };
      deployments.set(match[1], stopped);
      log.info({ deploymentId: match[1] }, "Stopped");

      json(res, 200, stopped);
    },

    /** GET /api/v1/workloads — List all workloads across all deployments */
    async listWorkloads(
      _req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      const all = await runtime.list();
      json(res, 200, { workloads: all });
    },
  };
}
