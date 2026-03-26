// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/runtime/container-runtime.port`
 * Purpose: Container runtime port — deploys images without knowing what's inside them.
 * Scope: Interface definitions only. Does NOT contain implementations or MCP/agent logic.
 * Invariants:
 *   - CONTAINER_AGNOSTIC: Port does not distinguish MCP vs agent vs anything else.
 *   - RUNTIME_IS_PLUGGABLE: Docker, k8s, Akash are adapters behind this interface.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { z } from "zod";

// ── Port interface ──

export interface ContainerRuntimePort {
  deploy(spec: WorkloadSpec): Promise<WorkloadInfo>;
  stop(id: string): Promise<void>;
  list(): Promise<WorkloadInfo[]>;
  status(id: string): Promise<WorkloadStatus>;
}

// ── Schemas ──

export const portMappingSchema = z.object({
  container: z.number(),
  host: z.number().optional(),
  expose: z.boolean().default(false),
});

export const resourceLimitsSchema = z.object({
  cpu: z.number().default(0.5),
  memory: z.string().default("512Mi"),
  storage: z.string().default("1Gi"),
});

export const workloadSpecSchema = z.object({
  name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "DNS-1035"),
  image: z.string(),
  env: z.record(z.string()).default({}),
  ports: z.array(portMappingSchema).default([]),
  resources: resourceLimitsSchema.default({}),
  connectsTo: z.array(z.string()).default([]),
});

export type PortMapping = z.infer<typeof portMappingSchema>;
export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;
export type WorkloadSpec = z.infer<typeof workloadSpecSchema>;

export const workloadStatusSchema = z.enum([
  "pending",
  "running",
  "stopped",
  "failed",
]);
export type WorkloadStatus = z.infer<typeof workloadStatusSchema>;

export interface WorkloadInfo {
  id: string;
  name: string;
  status: WorkloadStatus;
  endpoints: Record<string, string>;
  startedAt: string;
}

// ── Deploy request (HTTP API shape) ──

export const deployRequestSchema = z.object({
  name: z.string(),
  workloads: z.array(workloadSpecSchema).min(1),
});

export type DeployRequest = z.infer<typeof deployRequestSchema>;

export interface DeploymentSummary {
  deploymentId: string;
  name: string;
  workloads: WorkloadInfo[];
  status: "active" | "partial" | "failed";
}
