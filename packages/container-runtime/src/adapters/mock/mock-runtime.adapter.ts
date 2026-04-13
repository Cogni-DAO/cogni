// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/container-runtime/adapters/mock`
 * Purpose: In-memory mock of ContainerRuntimePort for testing.
 * Scope: Domain adapter — no env reads, no process lifecycle. Does NOT start real containers.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

import type {
  ContainerRuntimePort,
  GroupInfo,
  GroupSpec,
  WorkloadInfo,
  WorkloadSpec,
} from "../../port/container-runtime.port.js";

export class MockContainerRuntime implements ContainerRuntimePort {
  private counter = 0;
  private readonly groups = new Map<string, GroupInfo>();
  private readonly workloadToGroup = new Map<string, string>();

  async createGroup(spec: GroupSpec): Promise<GroupInfo> {
    const groupId = `grp-${(++this.counter).toString()}`;
    const info: GroupInfo = {
      groupId,
      name: spec.name,
      status: "active",
      workloads: [],
      createdAt: new Date().toISOString(),
    };
    this.groups.set(groupId, info);
    return info;
  }

  async deploy(groupId: string, spec: WorkloadSpec): Promise<WorkloadInfo> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);
    if (group.status !== "active")
      throw new Error(`Group ${groupId} is ${group.status}`);

    const workloadId = `wk-${(++this.counter).toString()}`;

    const endpoints: Record<string, string> = {};
    for (const port of spec.ports) {
      if (port.expose) {
        const hostPort =
          port.host !== undefined ? port.host : 10000 + this.counter;
        endpoints[`${spec.name}:${port.container.toString()}`] =
          `http://localhost:${hostPort.toString()}`;
      }
    }

    // Internal endpoint: other workloads in this group reach this by name
    if (spec.ports.length > 0) {
      const firstPort = spec.ports[0];
      if (firstPort) {
        endpoints.internal = `http://${spec.name}:${firstPort.container.toString()}`;
      }
    }

    const info: WorkloadInfo = {
      workloadId,
      name: spec.name,
      status: "running",
      endpoints,
      startedAt: new Date().toISOString(),
    };

    group.workloads.push(info);
    this.workloadToGroup.set(workloadId, groupId);
    return info;
  }

  async stop(workloadId: string): Promise<void> {
    const groupId = this.workloadToGroup.get(workloadId);
    if (!groupId) throw new Error(`Workload not found: ${workloadId}`);

    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    const wk = group.workloads.find((w) => w.workloadId === workloadId);
    if (wk) wk.status = "stopped";
  }

  async destroyGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    for (const wk of group.workloads) {
      wk.status = "stopped";
      this.workloadToGroup.delete(wk.workloadId);
    }
    group.status = "stopped";
  }

  async getGroup(groupId: string): Promise<GroupInfo | undefined> {
    return this.groups.get(groupId);
  }

  async listGroups(): Promise<GroupInfo[]> {
    return [...this.groups.values()];
  }

  /** Test helper */
  reset(): void {
    this.groups.clear();
    this.workloadToGroup.clear();
    this.counter = 0;
  }
}
