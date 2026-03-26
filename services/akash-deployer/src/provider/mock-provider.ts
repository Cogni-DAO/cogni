// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/provider/mock-provider`
 * Purpose: In-memory mock of ClusterProvider for v0 testing.
 * Scope: Test adapter only. Does NOT connect to any cloud.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { generateSdl } from "../sdl/sdl-generator.js";
import type {
  ClusterConnection,
  ClusterProvider,
  DeploymentInfo,
  DeployRequest,
} from "./cluster-provider.js";

export class MockClusterProvider implements ClusterProvider {
  private counter = 1000;
  readonly deployments = new Map<string, DeploymentInfo>();
  readonly sdls = new Map<string, string>();

  async ensureCluster(_env: string): Promise<ClusterConnection> {
    return { endpoint: "mock://localhost", provider: "mock" };
  }

  async createNamespace(_conn: ClusterConnection, name: string): Promise<void> {
    const id = `mock-${(++this.counter).toString()}`;
    this.deployments.set(id, {
      deploymentId: id,
      name,
      status: "pending",
      services: [],
      endpoints: {},
      createdAt: new Date().toISOString(),
    });
  }

  async applyManifests(_conn: ClusterConnection, _path: string): Promise<void> {
    // Mock: manifests "applied"
  }

  async createSecret(
    _conn: ClusterConnection,
    _ns: string,
    _data: Record<string, string>
  ): Promise<void> {
    // Mock: secrets "created"
  }

  /** Service-level deploy — wraps ClusterProvider for HTTP API convenience */
  async deploy(request: DeployRequest): Promise<DeploymentInfo> {
    const conn = await this.ensureCluster("mock");
    const id = `mock-${(++this.counter).toString()}`;
    const sdl = generateSdl(request.services);

    this.sdls.set(id, sdl);

    const info: DeploymentInfo = {
      deploymentId: id,
      name: request.name,
      status: "active",
      services: request.services.map((s) => s.name),
      endpoints: Object.fromEntries(
        request.services
          .filter((s) => s.exposeGlobal)
          .map((s) => [s.name, `https://${id}.mock.akash.local:${s.port}`])
      ),
      createdAt: new Date().toISOString(),
    };

    this.deployments.set(id, info);
    await this.createNamespace(conn, request.name);
    return info;
  }

  async getDeployment(id: string): Promise<DeploymentInfo | undefined> {
    return this.deployments.get(id);
  }

  async closeDeployment(id: string): Promise<DeploymentInfo | undefined> {
    const info = this.deployments.get(id);
    if (!info) return undefined;
    const updated = { ...info, status: "closed" as const };
    this.deployments.set(id, updated);
    return updated;
  }

  getSdl(id: string): string | undefined {
    return this.sdls.get(id);
  }
}
