// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/container-runtime/port`
 * Purpose: Container runtime port — deploys images into isolated groups.
 * Scope: Interface + domain types. Does NOT contain adapters or runtime wiring.
 * Invariants:
 *   - CONTAINER_AGNOSTIC: Port does not distinguish MCP vs agent vs any workload type.
 *   - RUNTIME_IS_PLUGGABLE: Docker, k8s, Akash are adapters behind this interface.
 *   - GROUP_IS_ISOLATION: Workloads in a group share networking. Cross-group access is denied by default.
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

import { z } from "zod";

// ── Port interface ──

/**
 * Deploys containerized workloads into isolated groups.
 *
 * A group is the isolation boundary:
 * - k8s: group = namespace (NetworkPolicy enforces isolation)
 * - Akash: group = SDL deployment (services share internal DNS)
 * - Docker: group = network (containers on same bridge can communicate)
 *
 * Workloads in a group can reach each other by name.
 * Workloads in different groups cannot, unless explicitly exposed.
 */
export interface ContainerRuntimePort {
  /** Create an isolated group. Workloads deployed into it share networking. */
  createGroup(group: GroupSpec): Promise<GroupInfo>;

  /** Deploy a workload into an existing group. */
  deploy(groupId: string, spec: WorkloadSpec): Promise<WorkloadInfo>;

  /** Stop a workload. */
  stop(workloadId: string): Promise<void>;

  /** Stop and remove an entire group and all its workloads. */
  destroyGroup(groupId: string): Promise<void>;

  /** Get group status including all workload statuses. */
  getGroup(groupId: string): Promise<GroupInfo | undefined>;

  /** List all groups. */
  listGroups(): Promise<GroupInfo[]>;
}

// ── Group (isolation boundary) ──

export const groupSpecSchema = z.object({
  name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "DNS-1035"),
});

export type GroupSpec = z.infer<typeof groupSpecSchema>;

export interface GroupInfo {
  groupId: string;
  name: string;
  status: "active" | "stopped";
  workloads: WorkloadInfo[];
  createdAt: string;
}

// ── Workload ──

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
  workloadId: string;
  name: string;
  status: WorkloadStatus;
  endpoints: Record<string, string>;
  startedAt: string;
}
