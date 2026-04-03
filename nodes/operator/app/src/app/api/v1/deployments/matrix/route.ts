// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/deployments/matrix/route`
 * Purpose: Deployment matrix endpoint — delegates to facade.
 * Scope: Delivery-only route handler.
 * Side-effects: IO (via facade)
 * @public
 */

import { NextResponse } from "next/server";
import {
  type DeploymentMatrixResponse,
  fetchDeploymentMatrix,
} from "@/app/_facades/deployments/matrix.server";

export type { DeploymentMatrixResponse };
export type {
  DeploymentRow,
  WorkflowRun,
} from "@/app/_facades/deployments/matrix.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse<DeploymentMatrixResponse>> {
  const data = await fetchDeploymentMatrix();
  return NextResponse.json(data);
}
