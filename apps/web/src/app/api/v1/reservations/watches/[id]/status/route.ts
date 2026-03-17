// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/reservations/watches/[id]/status`
 * Purpose: HTTP endpoint to update watch request status (pause/cancel/resume).
 * Scope: Auth-protected PATCH endpoint.
 * Invariants:
 * - Only the watch owner can update status
 * - Status transitions validated by domain rules
 * Side-effects: IO (HTTP request/response, database)
 * Links: task.0166
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { watchStatusUpdateOperation } from "@/contracts/reservations.watch.v1.contract";
import { updateWatchStatus } from "@/features/reservations/services/watch-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/v1/reservations/watches/[id]/status - Update watch status.
 */
export const PATCH = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.updateStatus",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const input = watchStatusUpdateOperation.input.parse(body);
    if (!sessionUser) throw new Error("sessionUser required");

    // Extract watch ID from URL
    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const watchIdIndex = segments.indexOf("watches") + 1;
    const watchId = segments[watchIdIndex];

    if (!watchId) {
      return NextResponse.json({ error: "Watch ID required" }, { status: 400 });
    }

    const container = getContainer();

    try {
      const updated = await updateWatchStatus(watchId, input.status, {
        store: container.reservationStore,
        providers: container.reservationProviders,
      });

      return NextResponse.json({
        id: updated.id,
        userId: updated.userId,
        platform: updated.platform,
        venue: updated.venue,
        partySize: updated.partySize,
        dateStart: updated.dateStart.toISOString(),
        dateEnd: updated.dateEnd.toISOString(),
        preferredTimeStart: updated.preferredTimeStart,
        preferredTimeEnd: updated.preferredTimeEnd,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "InvalidStatusTransitionError"
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }
);
