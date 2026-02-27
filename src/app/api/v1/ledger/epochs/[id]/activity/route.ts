// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ledger/epochs/[id]/activity/route`
 * Purpose: Authenticated HTTP endpoint for epoch ingestion receipts with selection join.
 * Scope: SIWE-protected route; exposes PII fields (platformUserId, platformLogin, etc.). Does not contain business logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, VALIDATE_IO, ACTIVITY_AUTHED.
 * Side-effects: IO (HTTP response, database read)
 * Links: docs/spec/epoch-ledger.md, contracts/ledger.epoch-activity.v1.contract
 * @public
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  toIngestionReceiptDto,
  toSelectionDto,
} from "@/app/api/v1/public/ledger/_lib/ledger-dto";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { epochActivityOperation } from "@/contracts/ledger.epoch-activity.v1.contract";
import { getNodeId } from "@/shared/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.epoch-activity",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;
    let epochId: bigint;
    try {
      epochId = BigInt(id);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    const url = new URL(request.url);
    const parsed = epochActivityOperation.input.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    const { limit, offset } = parsed;

    const store = getContainer().attributionStore;
    const nodeId = getNodeId();

    // Load epoch to get window bounds
    const epoch = await store.getEpoch(epochId);
    if (!epoch) {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    // Load receipts + selections and join in-memory (V0 data sizes are small)
    const receipts = await store.getReceiptsForWindow(
      nodeId,
      epoch.periodStart,
      epoch.periodEnd
    );
    const selections = await store.getSelectionForEpoch(epochId);
    const selectionMap = new Map(selections.map((s) => [s.receiptId, s]));

    const enriched = receipts.map((r) => {
      const selection = selectionMap.get(r.receiptId);
      return {
        ...toIngestionReceiptDto(r),
        selection: selection ? toSelectionDto(selection) : null,
      };
    });

    const page = enriched.slice(offset, offset + limit);

    return NextResponse.json(
      epochActivityOperation.output.parse({
        events: page,
        epochId: id,
        total: enriched.length,
      })
    );
  }
);
