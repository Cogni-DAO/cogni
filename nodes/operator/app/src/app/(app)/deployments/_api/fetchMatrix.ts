// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { DeploymentMatrixResponse } from "@/app/api/v1/deployments/matrix/route";

export type { DeploymentMatrixResponse };

export async function fetchDeploymentMatrix(): Promise<DeploymentMatrixResponse> {
  try {
    const res = await fetch("/api/v1/deployments/matrix");
    if (res.ok) return res.json();
    if (res.status === 404) {
      return {
        rows: [],
        recentRuns: [],
        lokiEvents: [],
        sources: { github: false, loki: false, health: false },
        fetchedAt: new Date().toISOString(),
      };
    }
    throw new Error(`Failed to fetch deployment matrix: ${res.status}`);
  } catch (err) {
    if (err instanceof TypeError) {
      return {
        rows: [],
        recentRuns: [],
        lokiEvents: [],
        sources: { github: false, loki: false, health: false },
        fetchedAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}
