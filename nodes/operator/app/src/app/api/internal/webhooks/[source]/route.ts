// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/internal/webhooks/[source]`
 * Purpose: Webhook receiver route — accepts platform webhook payloads and inserts receipts.
 * Scope: HTTP entry point only. Delegates to WebhookReceiverService. Does not contain business logic.
 * Invariants:
 * - WEBHOOK_VERIFY_BEFORE_NORMALIZE: Verification happens inside the feature service before normalization
 * - WEBHOOK_RECEIPT_APPEND_EXEMPT: Receipt insertion bypasses WRITES_VIA_TEMPORAL (safe per RECEIPT_IDEMPOTENT + RECEIPT_APPEND_ONLY)
 * - ARCHITECTURE_ALIGNMENT: Route → feature service → port
 * Side-effects: IO (database writes via feature service)
 * Links: docs/spec/attribution-ledger.md
 * @internal
 */

import type { CiStatusEvent, VcsActivityEvent } from "@cogni/node-streams";
import { NextResponse } from "next/server";
import { dispatchPrReview } from "@/app/_facades/review/dispatch.server";
import { getContainer } from "@/bootstrap/container";
import { dispatchSignalExecution } from "@/features/governance/services/signal-dispatch";
import {
  receiveWebhook,
  WebhookPayloadParseError,
  WebhookSourceNotFoundError,
  WebhookVerificationError,
} from "@/features/ingestion/services/webhook-receiver";
import { getNodeId } from "@/shared/config";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";

const log = makeLogger().child({ component: "webhook-route" });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Max body size for webhook payloads (1MB) */
const MAX_BODY_SIZE = 1_048_576;

/**
 * Resolve webhook secret for a given source.
 * V0: environment variable per source. P1: connections table.
 */
function resolveWebhookSecret(
  source: string,
  env: ReturnType<typeof serverEnv>
): string | null {
  switch (source) {
    case "github":
      return env.GH_WEBHOOK_SECRET ?? null;
    case "alchemy":
      return env.ALCHEMY_WEBHOOK_SECRET ?? null;
    default:
      return null;
  }
}

interface RouteParams {
  params: Promise<{ source: string }>;
}

/**
 * POST /api/internal/webhooks/{source}
 *
 * Receives webhook payloads from external platforms (GitHub, Discord, etc.).
 * Auth: Platform-specific signature verification (e.g., X-Hub-Signature-256).
 * No session auth — this endpoint is called by external platforms.
 */
export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const { source } = await params;
  const env = serverEnv();

  // 1. Resolve webhook secret
  const secret = resolveWebhookSecret(source, env);
  if (!secret) {
    return NextResponse.json(
      { error: `Webhook not configured for source: ${source}` },
      { status: 404 }
    );
  }

  // 2. Fast-path reject oversized payloads before reading body into memory
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Read raw body (needed for signature verification)
  const bodyBuffer = Buffer.from(await request.arrayBuffer());
  if (bodyBuffer.length > MAX_BODY_SIZE) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // 3. Extract headers as plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const eventType = headers["x-github-event"] ?? "unknown";

  // 4. Delegate ingestion to feature service (verify → normalize → insert receipts)
  try {
    const container = getContainer();

    const result = await receiveWebhook(
      {
        attributionStore: container.attributionStore,
        sourceRegistrations: container.webhookRegistrations,
        nodeId: getNodeId(),
      },
      { source, headers, body: bodyBuffer, secret }
    );

    log.info(
      { source, eventType, eventCount: result.eventCount },
      "webhook processed"
    );

    // 5. Fire-and-forget dispatches after successful verification.
    // Runs async — errors logged, never block webhook response.
    // Parse body once for all downstream consumers.
    const payload = JSON.parse(bodyBuffer.toString("utf-8"));

    if (source === "github" && eventType === "pull_request") {
      dispatchPrReview(payload, env, log);
    }

    if (source === "alchemy") {
      dispatchSignalExecution(payload, env, log);
    }

    // 6. Publish VCS activity summary to node stream (fire-and-forget).
    // SSE consumers (dashboard, AI agents) see real-time VCS events.
    if (source === "github" && result.eventCount > 0 && container.nodeStream) {
      const action = String(payload?.action ?? "unknown");
      const summary: VcsActivityEvent = {
        type: "vcs_activity",
        timestamp: new Date().toISOString(),
        source: "github",
        eventType,
        action,
        prNumber:
          (payload?.pull_request?.number as number) ??
          (payload?.issue?.number as number) ??
          null,
        title: String(
          payload?.pull_request?.title ??
            payload?.issue?.title ??
            payload?.ref ??
            ""
        ),
        actor: String(payload?.sender?.login ?? "unknown"),
        repo: String(payload?.repository?.full_name ?? ""),
      };
      container.nodeStream
        .publish(`node:${getNodeId()}:events`, summary)
        .catch((err: unknown) => {
          log.warn({ err }, "Stream publish failed for webhook event");
        });
    }

    // 7. Publish CI status to node stream (fire-and-forget).
    // Dashboard renders CiStatusEventContent for real-time CI pipeline visibility.
    if (
      source === "github" &&
      eventType === "workflow_run" &&
      container.nodeStream
    ) {
      const run = payload.workflow_run as Record<string, unknown> | undefined;
      if (run) {
        const headCommit = run.head_commit as
          | Record<string, unknown>
          | undefined;
        const pullRequests = run.pull_requests as
          | { number: number }[]
          | undefined;
        const ciEvent: CiStatusEvent = {
          type: "ci_status",
          timestamp: new Date().toISOString(),
          source: "github-actions",
          branch: String(run.head_branch ?? ""),
          conclusion: (run.conclusion as string) ?? null,
          workflowName: String(run.name ?? ""),
          runUrl: String(run.html_url ?? ""),
          commitSha: String(run.head_sha ?? ""),
          commitMessage: String(headCommit?.message ?? ""),
          prNumber: pullRequests?.[0]?.number ?? null,
        };
        container.nodeStream
          .publish(`node:${getNodeId()}:events`, ciEvent)
          .catch(() => {});
      }
    }

    return NextResponse.json(
      { ok: true, eventCount: result.eventCount },
      { status: 200 }
    );
  } catch (error) {
    // Verification / parse errors → reject
    if (error instanceof WebhookSourceNotFoundError) {
      log.warn({ source }, "webhook source not found");
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof WebhookVerificationError) {
      log.warn({ source }, "webhook verification failed");
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof WebhookPayloadParseError) {
      log.warn({ source }, "webhook payload parse error");
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // DB or other infra error — still dispatch review (signature was already verified
    // inside receiveWebhook before the DB insert that failed).
    log.error(
      { source, eventType, error: String(error) },
      "webhook ingestion failed — dispatching review anyway"
    );

    const fallbackPayload = JSON.parse(bodyBuffer.toString("utf-8"));

    if (source === "github" && eventType === "pull_request") {
      dispatchPrReview(fallbackPayload, env, log);
    }

    if (source === "alchemy") {
      dispatchSignalExecution(fallbackPayload, env, log);
    }

    return NextResponse.json(
      { ok: false, error: "Ingestion failed" },
      { status: 500 }
    );
  }
}
