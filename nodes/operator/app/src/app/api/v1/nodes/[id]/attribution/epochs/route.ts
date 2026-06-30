// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/[id]/attribution/epochs/route`
 * Purpose: Node-addressable read of ANY registered node's ledger epochs from the operator
 *   gateway — the same list the operator-self `/api/v1/attribution/epochs` returns, but for the
 *   node resolved from the `{id}` path segment instead of the operator's own `getNodeId()`.
 *   Lets a node read its own attribution results through the operator.
 * Scope: Thin HTTP shell — auth (bearer-or-session, mirroring the operator-self read), resolve
 *   `{id}` (repo-spec node_id UUID OR slug) via the shared `resolveNodeRef` seam, then delegate
 *   to the node-id-parameterized `listEpochsForNode` helper. No business logic, no duplicated
 *   aggregation.
 * Invariants: NODE_SCOPED (reads scoped to the resolved nodeId), ALL_MATH_BIGINT, VALIDATE_IO,
 *   AGENT_FIRST_READ (a valid bearer/session may read any node's epochs — transparency read,
 *   no per-node RBAC gate).
 * Side-effects: IO (HTTP response, service-db node resolution, database read)
 * Links: src/features/attribution/read/epoch-views.ts, src/features/nodes/node-lookup.ts,
 *   src/app/api/v1/attribution/epochs/route.ts (operator-self twin)
 * @public
 */

import { listEpochsOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { listEpochsForNode } from "@/features/attribution/read/epoch-views";
import { resolveNodeRef } from "@/features/nodes/node-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "nodes.attribution.list-epochs",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;

    const node = await resolveNodeRef(resolveServiceDb(), id);
    if (!node) {
      return NextResponse.json({ error: "node_not_found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const { limit, offset } = listEpochsOperation.input.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const store = getContainer().attributionStore;
    const result = await listEpochsForNode(store, node.nodeId, {
      limit,
      offset,
    });

    return NextResponse.json(listEpochsOperation.output.parse(result));
  }
);
