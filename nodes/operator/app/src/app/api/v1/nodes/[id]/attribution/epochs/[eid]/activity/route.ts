// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/[id]/attribution/epochs/[eid]/activity/route`
 * Purpose: Node-addressable read of ANY registered node's epoch activity (window ∪ epoch-selected
 *   receipts with selection join) from the operator gateway — the same union the operator-self
 *   `/api/v1/attribution/epochs/[id]/activity` returns, but for the node resolved from `{id}`.
 * Scope: Thin HTTP shell — auth (bearer-or-session, mirroring the operator-self read), resolve
 *   `{id}` via the shared `resolveNodeRef` seam, then delegate to the node-id-parameterized
 *   `buildEpochActivityView` helper. No duplicated aggregation logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, VALIDATE_IO, AGENT_FIRST_READ (valid bearer/session
 *   may read any node's epoch activity). Exposes PII fields (platformUserId/Login) like its twin.
 * Side-effects: IO (HTTP response, service-db node resolution, database read; background
 *   selection userId updates on read-time identity resolution)
 * Links: src/features/attribution/read/epoch-views.ts, src/features/nodes/node-lookup.ts,
 *   src/app/api/v1/attribution/epochs/[id]/activity/route.ts (operator-self twin)
 * @public
 */

import { epochActivityOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  buildEpochActivityView,
  EPOCH_NOT_FOUND,
} from "@/features/attribution/read/epoch-views";
import { resolveNodeRef } from "@/features/nodes/node-lookup";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string; eid: string }>;
}>(
  {
    routeId: "nodes.attribution.epoch-activity",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, _sessionUser, context) => {
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

    const url = new URL(request.url);
    const { limit, offset } = epochActivityOperation.input.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const store = getContainer().attributionStore;
    const view = await buildEpochActivityView(
      store,
      node.nodeId,
      epochId,
      eid,
      { limit, offset },
      ({ resolvedCount, unresolvedCount }) => {
        logEvent(ctx.log, EVENT_NAMES.LEDGER_IDENTITY_RESOLVED_AT_READ, {
          reqId: ctx.reqId,
          routeId: "nodes.attribution.epoch-activity",
          epochId: eid,
          resolvedCount,
          unresolvedCount,
        });
      }
    );
    if (view === EPOCH_NOT_FOUND) {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    return NextResponse.json(epochActivityOperation.output.parse(view));
  }
);
