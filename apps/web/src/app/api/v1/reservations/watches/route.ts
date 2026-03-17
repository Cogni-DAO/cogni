// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/reservations/watches`
 * Purpose: HTTP endpoints for watch request collection (create, list).
 * Scope: Auth-protected POST/GET endpoints for reservation watch management.
 * Invariants:
 * - Watch ownership scoped to authenticated user
 * - AUDIT_TRAIL: creation recorded as watch_event
 * Side-effects: IO (HTTP request/response, database)
 * Links: task.0166, reservations.watch.v1.contract
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  watchCreateOperation,
  watchListOperation,
} from "@/contracts/reservations.watch.v1.contract";
import {
  createWatch,
  listWatches,
} from "@/features/reservations/services/watch-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toWireFormat(watch: {
  id: string;
  userId: string;
  platform: string;
  venue: string;
  partySize: string;
  dateStart: Date;
  dateEnd: Date;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: watch.id,
    userId: watch.userId,
    platform: watch.platform,
    venue: watch.venue,
    partySize: watch.partySize,
    dateStart: watch.dateStart.toISOString(),
    dateEnd: watch.dateEnd.toISOString(),
    preferredTimeStart: watch.preferredTimeStart,
    preferredTimeEnd: watch.preferredTimeEnd,
    status: watch.status,
    createdAt: watch.createdAt.toISOString(),
    updatedAt: watch.updatedAt.toISOString(),
  };
}

/**
 * POST /api/v1/reservations/watches - Create a new watch request.
 */
export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.create",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const input = watchCreateOperation.input.parse(body);
    if (!sessionUser) throw new Error("sessionUser required");

    const container = getContainer();
    const watch = await createWatch(sessionUser.id, input, {
      store: container.reservationStore,
      providers: container.reservationProviders,
    });

    return NextResponse.json(toWireFormat(watch), { status: 201 });
  }
);

/**
 * GET /api/v1/reservations/watches - List watch requests for current user.
 */
export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.watches.list",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const container = getContainer();
    const watches = await listWatches(sessionUser.id, {
      store: container.reservationStore,
      providers: container.reservationProviders,
    });

    const output = watchListOperation.output.parse({
      watches: watches.map(toWireFormat),
    });
    return NextResponse.json(output);
  }
);
