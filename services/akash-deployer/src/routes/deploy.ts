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
import type { ContainerRuntimePort } from "@cogni/container-runtime";
import { groupSpecSchema, workloadSpecSchema } from "@cogni/container-runtime";
import type { Logger } from "pino";
import { z } from "zod";

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

const deployRequestSchema = z.object({
  name: z.string(),
  workloads: z.array(workloadSpecSchema).min(1),
});

export function createDeployRoutes(runtime: ContainerRuntimePort, log: Logger) {
  return {
    /** POST /api/v1/deploy — Create group + deploy all workloads into it */
    async deploy(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as unknown;
        const request = deployRequestSchema.parse(parsed);

        log.info(
          { name: request.name, count: request.workloads.length },
          "Deploying"
        );

        // Create isolated group
        const group = await runtime.createGroup(
          groupSpecSchema.parse({ name: request.name })
        );

        // Deploy all workloads into the group
        const results = await Promise.all(
          request.workloads.map((spec) => runtime.deploy(group.groupId, spec))
        );

        const updated = await runtime.getGroup(group.groupId);
        log.info(
          { groupId: group.groupId, workloads: results.length },
          "Deployed"
        );

        json(res, 201, updated);
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

    /** GET /api/v1/groups/:id — Get group status with all workloads */
    async getGroup(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );
      const match = /\/([^/]+)$/.exec(url.pathname);
      if (!match?.[1]) {
        json(res, 400, { error: "Missing group ID" });
        return;
      }

      const group = await runtime.getGroup(match[1]);
      if (!group) {
        json(res, 404, { error: "Not found" });
        return;
      }

      json(res, 200, group);
    },

    /** DELETE /api/v1/groups/:id — Destroy group and all workloads */
    async destroyGroup(
      req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`
      );
      const match = /\/([^/]+)$/.exec(url.pathname);
      if (!match?.[1]) {
        json(res, 400, { error: "Missing group ID" });
        return;
      }

      const group = await runtime.getGroup(match[1]);
      if (!group) {
        json(res, 404, { error: "Not found" });
        return;
      }

      await runtime.destroyGroup(match[1]);
      const destroyed = await runtime.getGroup(match[1]);
      log.info({ groupId: match[1] }, "Destroyed");

      json(res, 200, destroyed);
    },

    /** GET /api/v1/groups — List all groups */
    async listGroups(
      _req: IncomingMessage,
      res: ServerResponse
    ): Promise<void> {
      const groups = await runtime.listGroups();
      json(res, 200, { groups });
    },
  };
}
