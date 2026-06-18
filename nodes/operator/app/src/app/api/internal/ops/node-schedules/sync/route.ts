// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/node-schedules/sync`
 * Purpose: Internal operations endpoint that reconciles this node's repo-spec recurring `schedules` into Temporal.
 * Scope: Auth-protected POST for deploy/ops automation. Delegates to the bootstrap job; does not implement sync logic. Mirror of the governance schedules-sync endpoint, for the node-as-tenant path.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN (same gate + token as governance sync).
 *   - JOB_DELEGATION_ONLY: Uses runNodeSchedulesSyncJob() for all orchestration.
 *   - APP_LOCAL_EVENT: emits the app-local NODE_SCHEDULES_SYNC_COMPLETE event via ctx.log.info (logEvent types only the SHARED EventName).
 * Side-effects: IO (HTTP request/response, DB advisory lock, Temporal RPC via job)
 * Links: src/bootstrap/jobs/syncNodeSchedules.job.ts, node-schedules-sync.internal.v1.contract, docs/spec/temporal-patterns.md
 * @internal
 */

import { timingSafeEqual } from "node:crypto";
import { NodeSchedulesSyncSummarySchema } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { runNodeSchedulesSyncJob } from "@/bootstrap/jobs/syncNodeSchedules.job";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice(7).trim();
  if (token.length > MAX_TOKEN_LENGTH) return null;

  return token;
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "node.schedules.sync.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const env = serverEnv();

    const configuredToken = env.INTERNAL_OPS_TOKEN;
    if (!configuredToken) {
      ctx.log.error("INTERNAL_OPS_TOKEN not configured");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const providedToken = extractBearerToken(authHeader);
    if (!providedToken || !safeCompare(providedToken, configuredToken)) {
      ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const start = performance.now();
    const summary = await runNodeSchedulesSyncJob();
    const durationMs = Math.round(performance.now() - start);

    // APP_LOCAL_EVENT: NODE_SCHEDULES_SYNC_COMPLETE is app-local, so logEvent
    // (which types only the SHARED EventName) would TS2345 — log directly.
    ctx.log.info(
      {
        event: EVENT_NAMES.NODE_SCHEDULES_SYNC_COMPLETE,
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        status: 200,
        durationMs,
        outcome: "success",
        created: summary.created,
        updated: summary.updated,
        resumed: summary.resumed,
        skipped: summary.skipped,
        paused: summary.paused,
      },
      EVENT_NAMES.NODE_SCHEDULES_SYNC_COMPLETE
    );

    return NextResponse.json(NodeSchedulesSyncSummarySchema.parse(summary), {
      status: 200,
    });
  }
);
