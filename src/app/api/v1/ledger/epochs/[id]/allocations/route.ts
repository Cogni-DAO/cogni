// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ledger/epochs/[id]/allocations/route`
 * Purpose: SIWE + approver-gated endpoint for adjusting allocation final_units.
 * Scope: Auth-protected PATCH endpoint. Requires wallet in activity_ledger.approvers. Does not contain business logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, VALIDATE_IO, WRITE_ROUTES_APPROVER_GATED.
 * Side-effects: IO (HTTP response, database write)
 * Links: docs/spec/epoch-ledger.md, contracts/ledger.update-allocations.v1.contract
 * @public
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { checkApprover } from "@/app/api/v1/ledger/_lib/approver-guard";
import { toAllocationDto } from "@/app/api/v1/public/ledger/_lib/ledger-dto";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { epochAllocationsOperation } from "@/contracts/ledger.epoch-allocations.v1.contract";
import { updateAllocationsOperation } from "@/contracts/ledger.update-allocations.v1.contract";
import {
  EVENT_NAMES,
  logEvent,
  logRequestWarn,
  type RequestContext,
} from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.epoch-allocations",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;
    let epochId: bigint;
    try {
      epochId = BigInt(id);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    const store = getContainer().activityLedgerStore;
    const epoch = await store.getEpoch(epochId);
    if (!epoch) {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    const allocations = await store.getAllocationsForEpoch(epochId);

    return NextResponse.json(
      epochAllocationsOperation.output.parse({
        allocations: allocations.map(toAllocationDto),
        epochId: id,
      })
    );
  }
);

function handleRouteError(
  ctx: RequestContext,
  error: unknown
): NextResponse | null {
  if (error && typeof error === "object" && "issues" in error) {
    logRequestWarn(ctx.log, error, "VALIDATION_ERROR");
    return NextResponse.json(
      { error: "Invalid input format" },
      { status: 400 }
    );
  }
  return null;
}

export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.update-allocations",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser, context) => {
    try {
      // WRITE_ROUTES_APPROVER_GATED
      const denied = checkApprover(ctx, sessionUser?.walletAddress);
      if (denied) return denied;

      if (!context) throw new Error("context required for dynamic routes");
      const { id } = await context.params;
      let epochId: bigint;
      try {
        epochId = BigInt(id);
      } catch {
        return NextResponse.json(
          { error: "Invalid epoch ID" },
          { status: 400 }
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }

      const input = updateAllocationsOperation.input.parse(body);

      const store = getContainer().activityLedgerStore;

      // Verify epoch exists
      const epoch = await store.getEpoch(epochId);
      if (!epoch) {
        return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
      }

      // Verify epoch is open
      if (epoch.status !== "open") {
        return NextResponse.json(
          { error: "Epoch is not open for adjustments" },
          { status: 409 }
        );
      }

      // Apply each adjustment — adj.finalUnits is already bigint (zBigint transform)
      let updated = 0;
      for (const adj of input.adjustments) {
        await store.updateAllocationFinalUnits(
          epochId,
          adj.userId,
          adj.finalUnits,
          adj.overrideReason
        );
        updated++;
      }

      logEvent(ctx.log, EVENT_NAMES.LEDGER_ALLOCATIONS_UPDATED, {
        reqId: ctx.reqId,
        routeId: "ledger.update-allocations",
        epochId: id,
        updated,
      });

      return NextResponse.json(
        updateAllocationsOperation.output.parse({ updated })
      );
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
