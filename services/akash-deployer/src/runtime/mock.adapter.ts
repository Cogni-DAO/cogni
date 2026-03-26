// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/runtime/mock.adapter`
 * Purpose: In-memory mock of ContainerRuntimePort for testing.
 * Scope: Test adapter only. Does NOT start real containers.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import type {
  ContainerRuntimePort,
  WorkloadInfo,
  WorkloadSpec,
  WorkloadStatus,
} from "./container-runtime.port.js";

export class MockContainerRuntime implements ContainerRuntimePort {
  private counter = 0;
  private readonly workloads = new Map<string, WorkloadInfo>();

  async deploy(spec: WorkloadSpec): Promise<WorkloadInfo> {
    const id = `mock-${(++this.counter).toString()}`;

    const endpoints: Record<string, string> = {};
    for (const port of spec.ports) {
      if (port.expose) {
        endpoints[`${spec.name}:${port.container.toString()}`] =
          `http://localhost:${(port.host ?? 10000 + this.counter).toString()}`;
      }
    }

    const info: WorkloadInfo = {
      id,
      name: spec.name,
      status: "running",
      endpoints,
      startedAt: new Date().toISOString(),
    };

    this.workloads.set(id, info);
    return info;
  }

  async stop(id: string): Promise<void> {
    const info = this.workloads.get(id);
    if (!info) throw new Error(`Workload not found: ${id}`);
    this.workloads.set(id, { ...info, status: "stopped" });
  }

  async list(): Promise<WorkloadInfo[]> {
    return [...this.workloads.values()];
  }

  async status(id: string): Promise<WorkloadStatus> {
    const info = this.workloads.get(id);
    if (!info) throw new Error(`Workload not found: ${id}`);
    return info.status;
  }

  /** Test helper */
  get(id: string): WorkloadInfo | undefined {
    return this.workloads.get(id);
  }

  /** Test helper */
  reset(): void {
    this.workloads.clear();
    this.counter = 0;
  }
}
