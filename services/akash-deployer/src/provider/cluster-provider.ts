// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/provider/cluster-provider`
 * Purpose: ClusterProvider interface from node-launch spec + service-local types.
 * Scope: Interface definitions only. Does NOT contain implementations.
 * Invariants: ONE_PORT — this is the only deployment port.
 * Side-effects: none
 * Links: docs/spec/node-launch.md, docs/spec/akash-deploy-service.md
 * @internal
 */

import { z } from "zod";

// ── ClusterProvider interface (from node-launch spec) ──

export interface ClusterConnection {
  endpoint: string;
  provider: "k3s" | "akash" | "mock";
}

export interface ClusterProvider {
  ensureCluster(env: string): Promise<ClusterConnection>;
  createNamespace(conn: ClusterConnection, name: string): Promise<void>;
  applyManifests(conn: ClusterConnection, path: string): Promise<void>;
  createSecret(
    conn: ClusterConnection,
    ns: string,
    data: Record<string, string>
  ): Promise<void>;
}

// ── Service specs (what gets deployed) ──

export const serviceSpecSchema = z.object({
  name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "DNS-1035"),
  image: z.string(),
  port: z.number().default(8080),
  env: z.record(z.string()).default({}),
  cpu: z.number().default(0.5),
  memory: z.string().default("512Mi"),
  storage: z.string().default("1Gi"),
  exposeGlobal: z.boolean().default(false),
  connectsTo: z.array(z.string()).default([]),
});

export type ServiceSpec = z.infer<typeof serviceSpecSchema>;

export const deployRequestSchema = z.object({
  name: z.string(),
  services: z.array(serviceSpecSchema).min(1),
});

export type DeployRequest = z.infer<typeof deployRequestSchema>;

export interface DeploymentInfo {
  deploymentId: string;
  name: string;
  status: "pending" | "active" | "closed" | "error";
  services: string[];
  endpoints: Record<string, string>;
  createdAt: string;
}
