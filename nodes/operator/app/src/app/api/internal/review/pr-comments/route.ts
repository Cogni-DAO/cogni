// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/review/pr-comments`
 * Purpose: Internal GitHub-plane route to post a PR-review comment (with optional
 *   head-SHA staleness guard). Called by the scheduler-worker; the operator owns
 *   the GitHub App auth (bug.5000).
 * Scope: Thin — parse contract, delegate to the review adapter, return.
 * Invariants:
 *   - INTERNAL_API_SHARED_SECRET: Bearer SCHEDULER_API_TOKEN.
 * Side-effects: IO (GitHub REST via adapter).
 * Links: review.post-pr-comment.internal.v1 contract
 * @internal
 */

import {
  InternalReviewPostPrCommentInputSchema,
  type InternalReviewPostPrCommentOutput,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { resolveReviewRoute } from "@/bootstrap/review/resolve-review-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "review.post-pr-comment.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const resolved = resolveReviewRoute(request, ctx.log);
    if (!resolved.ok) return resolved.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = InternalReviewPostPrCommentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await resolved.adapter.postPrComment(parsed.data);
    const response: InternalReviewPostPrCommentOutput = result;
    return NextResponse.json(response, { status: 200 });
  }
);
