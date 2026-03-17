// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/reservations/watches/[id]/bookings`
 * Purpose: HTTP endpoints for booking attempts (list and approve).
 * Scope: Auth-protected GET/POST endpoints.
 * Invariants:
 * - USER_APPROVAL_GATE: POST creates booking only after explicit user action
 * - AUDIT_TRAIL: approval and booking results recorded as watch_events
 * Side-effects: IO (HTTP request/response, database, provider interaction)
 * Links: task.0166
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  bookingApproveOperation,
  bookingListOperation,
} from "@/contracts/reservations.booking.v1.contract";
import {
  approveBooking,
  getWatchBookings,
} from "@/features/reservations/services/watch-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getWatchIdFromUrl(request: Request): string | null {
  const url = new URL(request.url);
  const segments = url.pathname.split("/");
  const watchIdIndex = segments.indexOf("watches") + 1;
  return segments[watchIdIndex] ?? null;
}

/**
 * GET /api/v1/reservations/watches/[id]/bookings - List booking attempts.
 */
export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.bookings.list",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const watchId = getWatchIdFromUrl(request);
    if (!watchId) {
      return NextResponse.json({ error: "Watch ID required" }, { status: 400 });
    }

    const container = getContainer();
    const attempts = await getWatchBookings(watchId, {
      store: container.reservationStore,
      providers: container.reservationProviders,
    });

    const output = bookingListOperation.output.parse({
      attempts: attempts.map((a) => ({
        id: a.id,
        watchRequestId: a.watchRequestId,
        status: a.status,
        detailsJson: a.detailsJson,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
    });

    return NextResponse.json(output);
  }
);

/**
 * POST /api/v1/reservations/watches/[id]/bookings - Approve and launch booking attempt.
 * USER_APPROVAL_GATE: This endpoint represents explicit user approval.
 */
export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.bookings.approve",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const input = bookingApproveOperation.input.parse(body);
    if (!sessionUser) throw new Error("sessionUser required");

    const watchId = getWatchIdFromUrl(request);
    if (!watchId) {
      return NextResponse.json({ error: "Watch ID required" }, { status: 400 });
    }

    const container = getContainer();
    const attempt = await approveBooking(
      watchId,
      input.sessionStatePath,
      input.targetSlot,
      {
        store: container.reservationStore,
        providers: container.reservationProviders,
      }
    );

    return NextResponse.json(
      {
        id: attempt.id,
        watchRequestId: attempt.watchRequestId,
        status: attempt.status,
        detailsJson: attempt.detailsJson,
        createdAt: attempt.createdAt.toISOString(),
        updatedAt: attempt.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  }
);
