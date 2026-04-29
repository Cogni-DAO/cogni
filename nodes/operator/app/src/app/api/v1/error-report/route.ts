// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/error-report`
 * Purpose: "Send to Cogni" intake endpoint — accepts a structured error
 *   report from the UI's error boundaries (or any future surface) and
 *   persists it to `error_reports` for downstream agent triage.
 * Scope: Anonymous-allowed POST. Mints a server-side trackingId, inserts
 *   the row synchronously, emits a structured Pino line carrying the
 *   `digest` so the report shows up in Loki at the deployed SHA. Does
 *   NOT pull a Loki window in v0-of-v0 (task.0420 adds that via Temporal).
 * Invariants:
 *   - ANONYMOUS_ALLOWED: auth.mode=none so `(public)/error.tsx` can submit.
 *   - BOUNDED_INTAKE: per-IP token-bucket rate limit + Zod byte caps.
 *   - DIGEST_IS_CORRELATION_KEY: the structured log line includes
 *     `event: "error_report.intake"` and `digest`/`trackingId`/`build_sha`
 *     as fields so an agent can later join Loki ↔ DB ↔ deployed build.
 *   - SERVER_STAMPS_BUILD_SHA: build_sha comes from server env, not the
 *     client.
 * Side-effects: IO (DB insert, Pino log line, rate-limiter state).
 * Links: work/items/task.0423.send-to-cogni-error-intake-v0.md, contracts/error-report.v1.contract
 * @public
 */

import { randomUUID } from "node:crypto";
import { errorReports } from "@cogni/db-schema";
import { errorReportOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { resolveServiceDb } from "@/bootstrap/container";
import {
  extractClientIp,
  publicApiLimiter,
  wrapRouteHandlerWithLogging,
} from "@/bootstrap/http";
import { serverEnv } from "@/shared/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_NAME = "operator";

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "errors.send-to-cogni", auth: { mode: "none" } },
  async (ctx, request) => {
    // BOUNDED_INTAKE — per-IP token bucket. Bypass-token semantics are
    // identical to wrapPublicRoute; we don't honor them here because
    // this endpoint is anonymous and never participates in test bypass.
    const clientIp = extractClientIp(request);
    if (!publicApiLimiter.consume(clientIp)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = errorReportOperation.input.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const trackingId = randomUUID();
    const env = serverEnv();
    const buildSha = env.APP_BUILD_SHA ?? null;

    const db = resolveServiceDb();
    await db.insert(errorReports).values({
      id: trackingId,
      node: NODE_NAME,
      buildSha,
      userId: null, // best-effort session lookup deferred to v1 (task.0420).
      digest: input.digest ?? null,
      route: input.route,
      errorName: input.errorName,
      errorMessage: input.errorMessage,
      errorStack: input.errorStack ?? null,
      componentStack: input.componentStack ?? null,
      userNote: input.userNote ?? null,
      userAgent: input.userAgent ?? null,
      clientTs: input.clientTs ? new Date(input.clientTs) : null,
      lokiWindow: null,
      lokiStatus: "pending",
    });

    // DIGEST_IS_CORRELATION_KEY — this is the line an agent later finds in
    // Loki to join the persisted report back to the failing request log.
    ctx.log.info(
      {
        event: "error_report.intake",
        trackingId,
        digest: input.digest ?? null,
        route: input.route,
        errorName: input.errorName,
        node: NODE_NAME,
        build_sha: buildSha,
      },
      "error_report.intake"
    );

    return NextResponse.json(
      errorReportOperation.output.parse({
        trackingId,
        status: "received",
      }),
      { status: 202 }
    );
  }
);
