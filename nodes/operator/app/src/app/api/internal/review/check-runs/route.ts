// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/review/check-runs`
 * Purpose: Internal GitHub-plane routes for PR-review Check Runs — POST creates,
 *   PATCH finalizes. Called by the scheduler-worker's review activities; the
 *   operator owns the GitHub App auth so the worker holds no credential (bug.5000).
 * Scope: Thin — parse contract, delegate to the review adapter, return.
 * Invariants:
 *   - INTERNAL_API_SHARED_SECRET: Bearer SCHEDULER_API_TOKEN.
 * Side-effects: IO (GitHub REST via adapter).
 * Links: review.create-check-run/update-check-run.internal.v1 contracts
 * @internal
 */

import {
  InternalReviewCreateCheckRunInputSchema,
  type InternalReviewCreateCheckRunOutput,
  InternalReviewUpdateCheckRunInputSchema,
  type InternalReviewUpdateCheckRunOutput,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { resolveReviewRoute } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "review.create-check-run.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const resolved = resolveReviewRoute(request, ctx.log);
    if (!resolved.ok) return resolved.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = InternalReviewCreateCheckRunInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const checkRunId = await resolved.adapter.createCheckRun(parsed.data);
    const response: InternalReviewCreateCheckRunOutput = { checkRunId };
    return NextResponse.json(response, { status: 200 });
  }
);

export const PATCH = wrapRouteHandlerWithLogging(
  { routeId: "review.update-check-run.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const resolved = resolveReviewRoute(request, ctx.log);
    if (!resolved.ok) return resolved.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = InternalReviewUpdateCheckRunInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    await resolved.adapter.updateCheckRun(parsed.data);
    const response: InternalReviewUpdateCheckRunOutput = { ok: true };
    return NextResponse.json(response, { status: 200 });
  }
);
