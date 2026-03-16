// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/reservations/watches/[id]/events`
 * Purpose: HTTP endpoint to list watch event timeline.
 * Scope: Auth-protected GET endpoint.
 * Invariants:
 * - AUDIT_TRAIL: events are immutable, append-only
 * Side-effects: IO (HTTP request/response, database)
 * Links: task.0166
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { eventsListOperation } from "@/contracts/reservations.events.v1.contract";
import { getWatchTimeline } from "@/features/reservations/services/watch-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/reservations/watches/[id]/events - List event timeline.
 */
export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.events",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const url = new URL(request.url);
    const segments = url.pathname.split("/");
    const watchIdIndex = segments.indexOf("watches") + 1;
    const watchId = segments[watchIdIndex];

    if (!watchId) {
      return NextResponse.json({ error: "Watch ID required" }, { status: 400 });
    }

    const container = getContainer();
    const events = await getWatchTimeline(watchId, {
      store: container.reservationStore,
      providers: container.reservationProviders,
    });

    const output = eventsListOperation.output.parse({
      events: events.map((e) => ({
        id: e.id,
        watchRequestId: e.watchRequestId,
        source: e.source,
        eventType: e.eventType,
        payloadJson: e.payloadJson,
        createdAt: e.createdAt.toISOString(),
      })),
    });

    return NextResponse.json(output);
  }
);
