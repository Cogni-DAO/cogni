// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/[id]/attribution/epochs/[eid]/contributors/route`
 * Purpose: Node-addressable read of ANY registered node's epoch contributor rollup from the
 *   operator gateway — the same selection-to-contributor aggregation the operator-self
 *   `/api/v1/attribution/epochs/[id]/contributors` returns, but for the node resolved from `{id}`.
 * Scope: Thin HTTP shell — auth (bearer-or-session, mirroring the operator-self read), resolve
 *   `{id}` via the shared `resolveNodeRef` seam, then delegate to the node-id-parameterized
 *   `buildEpochContributorsView` helper. No duplicated aggregation logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, SELECTION_IS_THE_GATE (any status, no finalized
 *   gate), AGENT_FIRST_READ (valid bearer/session may read any node's epoch contributors).
 * Side-effects: IO (HTTP response, service-db node resolution, database read)
 * Links: src/features/attribution/read/epoch-views.ts, src/features/nodes/node-lookup.ts,
 *   src/app/api/v1/attribution/epochs/[id]/contributors/route.ts (operator-self twin)
 * @public
 */

import { epochContributorsOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  buildEpochContributorsView,
  EPOCH_NOT_FOUND,
} from "@/features/attribution/read/epoch-views";
import { resolveNodeRef } from "@/features/nodes/node-lookup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string; eid: string }>;
}>(
  {
    routeId: "nodes.attribution.epoch-contributors",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id, eid } = await context.params;

    let epochId: bigint;
    try {
      epochId = BigInt(eid);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    const node = await resolveNodeRef(resolveServiceDb(), id);
    if (!node) {
      return NextResponse.json({ error: "node_not_found" }, { status: 404 });
    }

    const store = getContainer().attributionStore;
    const view = await buildEpochContributorsView(store, node.nodeId, epochId);
    if (view === EPOCH_NOT_FOUND) {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    return NextResponse.json(epochContributorsOperation.output.parse(view));
  }
);
