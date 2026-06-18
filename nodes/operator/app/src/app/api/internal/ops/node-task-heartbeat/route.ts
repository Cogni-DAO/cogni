// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/node-task-heartbeat`
 * Purpose: Dispatch-target route for the operator's own `node-task-heartbeat` schedule — the first real consumer of the node-task http-dispatch path. NodeTaskWorkflow POSTs here on cron; this proves the substrate end-to-end (observable in Loki).
 * Scope: Auth + structured observability only. Does not run business logic — it exists to PROVE the dispatch arrives under the node principal with the idempotency key.
 * Invariants:
 *   - DISPATCH_PRINCIPAL_AUTH: requires Bearer SCHEDULER_API_TOKEN — the MVP shared node-principal the scheduler-worker's dispatchNodeTaskActivity sends (createSharedTokenNodePrincipalResolver).
 *   - IDEMPOTENT_OBSERVE: reads `Idempotency-Key` (= `${nodeId}/${scheduleId}/${scheduledFor}`) and emits it; a real handler would dedup on it. This route is observe-only, so re-delivery is a safe no-op.
 *   - APP_LOCAL_EVENT: emits `node_task.heartbeat.received` via ctx.log.info (logEvent types only the SHARED EventName).
 * Side-effects: IO (HTTP request/response, structured log emit)
 * Links: services/scheduler-worker/src/activities/index.ts (dispatchNodeTaskActivity), packages/temporal-workflows/src/workflows/node-task.workflow.ts
 * @internal
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getNodeId } from "@/shared/config";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader || authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return trimmed.slice(7).trim();
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "node-task-heartbeat.internal", auth: { mode: "none" } },
  async (ctx, request) => {
    const env = serverEnv();

    const configured = env.SCHEDULER_API_TOKEN;
    if (!configured) {
      ctx.log.error("SCHEDULER_API_TOKEN not configured");
      return NextResponse.json(
        { error: "Service not configured" },
        { status: 500 }
      );
    }

    const provided = extractBearer(request.headers.get("authorization"));
    if (!provided || !safeCompare(provided, configured)) {
      ctx.log.warn("Invalid or missing SCHEDULER_API_TOKEN");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The dispatch keys `Idempotency-Key: ${nodeId}/${scheduleId}/${scheduledFor}`.
    // A real handler dedups on it; this observe-only route surfaces it for proof.
    const idempotencyKey = request.headers.get("idempotency-key");
    const scheduleId = idempotencyKey?.split("/")[1] ?? null;
    const scheduledFor = idempotencyKey?.split("/").slice(2).join("/") ?? null;

    // APP_LOCAL_EVENT: node_task.heartbeat.received is app-local, so logEvent
    // (which types only the SHARED EventName) would TS2345 — log directly.
    ctx.log.info(
      {
        event: EVENT_NAMES.NODE_TASK_HEARTBEAT_RECEIVED,
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        nodeId: getNodeId(),
        scheduleId,
        scheduledFor,
        idempotencyKey,
      },
      EVENT_NAMES.NODE_TASK_HEARTBEAT_RECEIVED
    );

    return NextResponse.json({ ok: true }, { status: 200 });
  }
);
