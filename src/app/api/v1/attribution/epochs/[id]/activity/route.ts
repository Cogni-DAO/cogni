// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/attribution/epochs/[id]/activity/route`
 * Purpose: Authenticated HTTP endpoint for epoch ingestion receipts with selection join.
 * Scope: SIWE-protected route; exposes PII fields (platformUserId, platformLogin, etc.). Does not contain business logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, VALIDATE_IO, ACTIVITY_AUTHED.
 * Side-effects: IO (HTTP response, database read)
 * Links: docs/spec/attribution-ledger.md, contracts/attribution.epoch-activity.v1.contract
 * @public
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  toIngestionReceiptDto,
  toSelectionDto,
} from "@/app/api/v1/public/attribution/_lib/attribution-dto";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { epochActivityOperation } from "@/contracts/attribution.epoch-activity.v1.contract";
import { getNodeId } from "@/shared/config";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.epoch-activity",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, _sessionUser, context) => {
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

    // Read-time identity resolution: resolve any unresolved GitHub identities
    // so linked users appear immediately without waiting for the next scheduler run
    const unresolvedGithubIds = new Set<string>();
    for (const r of receipts) {
      const sel = selectionMap.get(r.receiptId);
      if ((!sel || sel.userId === null) && r.source === "github") {
        unresolvedGithubIds.add(r.platformUserId);
      }
    }
    const resolvedIdentities =
      unresolvedGithubIds.size > 0
        ? await store.resolveIdentities("github", [...unresolvedGithubIds])
        : new Map<string, string>();

    // Fire-and-forget: persist resolved userIds to selection rows for future reads
    if (resolvedIdentities.size > 0) {
      const updates: Promise<void>[] = [];
      for (const r of receipts) {
        const sel = selectionMap.get(r.receiptId);
        if (sel && sel.userId === null && r.source === "github") {
          const resolved = resolvedIdentities.get(r.platformUserId);
          if (resolved) {
            updates.push(
              store.updateSelectionUserId(epochId, r.receiptId, resolved)
            );
          }
        }
      }
      // Don't await — background DB updates, response returns immediately
      void Promise.allSettled(updates);

      logEvent(ctx.log, EVENT_NAMES.LEDGER_IDENTITY_RESOLVED_AT_READ, {
        reqId: ctx.reqId,
        routeId: "ledger.epoch-activity",
        epochId: id,
        resolvedCount: resolvedIdentities.size,
        unresolvedCount: unresolvedGithubIds.size - resolvedIdentities.size,
      });
    }

    const enriched = receipts.map((r) => {
      const selection = selectionMap.get(r.receiptId);
      const needsResolution =
        r.source === "github" && (!selection || selection.userId === null);
      const resolvedUserId = needsResolution
        ? (resolvedIdentities.get(r.platformUserId) ?? null)
        : null;
      const selectionDto = resolvedUserId
        ? selection
          ? toSelectionDto({ ...selection, userId: resolvedUserId })
          : {
              userId: resolvedUserId,
              included: true,
              weightOverrideMilli: null,
              note: null,
            }
        : selection
          ? toSelectionDto(selection)
          : null;
      return {
        ...toIngestionReceiptDto(r),
        selection: selectionDto,
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
