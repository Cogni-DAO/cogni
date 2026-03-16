// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/reservations/ingest`
 * Purpose: HTTP endpoint to ingest availability notifications.
 * Scope: Auth-protected POST endpoint for receiving alerts from email/webhook/manual.
 * Invariants:
 * - AUDIT_TRAIL: ingested alerts recorded as watch_events
 * - NO_SCRAPING: this is a passive receiver, not an active scraper
 * Side-effects: IO (HTTP request/response, database)
 * Links: task.0166
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { ingestAlertOperation } from "@/contracts/reservations.ingest.v1.contract";
import { ingestAlert } from "@/features/reservations/services/watch-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/reservations/ingest - Ingest an availability notification.
 */
export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "reservations.ingest",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const input = ingestAlertOperation.input.parse(body);
    if (!sessionUser) throw new Error("sessionUser required");

    const container = getContainer();
    const event = await ingestAlert(
      input.watchRequestId,
      input.source,
      input.payload,
      {
        store: container.reservationStore,
        providers: container.reservationProviders,
      }
    );

    const output = ingestAlertOperation.output.parse({
      eventId: event.id,
      watchRequestId: event.watchRequestId,
      eventType: event.eventType,
    });

    return NextResponse.json(output, { status: 201 });
  }
);
