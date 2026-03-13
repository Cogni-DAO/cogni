// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/broadcasting`
 * Purpose: HTTP endpoints for broadcasting collection (create draft, list).
 * Scope: Auth-protected POST/GET endpoints for content message management. Does not contain business logic.
 * Invariants:
 * - Per MESSAGE_IS_PLATFORM_AGNOSTIC: body has no platform-specific formatting
 * - Content message ownership scoped to caller's billing account
 * Side-effects: IO (HTTP request/response, database)
 * Links: docs/spec/broadcasting.md, broadcast.draft.v1.contract
 * @public
 */

import type { ContentMessage } from "@cogni/broadcast-core";
import { toUserId } from "@cogni/ids";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  broadcastDraftOperation,
  broadcastListOperation,
  ContentMessageResponseSchema,
} from "@/contracts/broadcast.draft.v1.contract";
import { logRequestWarn, type RequestContext } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toResponse(msg: ContentMessage) {
  return {
    id: msg.id,
    body: msg.body,
    title: msg.title,
    targetPlatforms: [...msg.targetPlatforms],
    mediaUrls: [...msg.mediaUrls],
    metadata: msg.metadata,
    status: msg.status,
    createdAt: msg.createdAt.toISOString(),
    updatedAt: msg.updatedAt.toISOString(),
  };
}

function handleRouteError(
  ctx: RequestContext,
  error: unknown
): NextResponse | null {
  if (error && typeof error === "object" && "issues" in error) {
    logRequestWarn(ctx.log, error, "VALIDATION_ERROR");
    return NextResponse.json(
      { error: "Invalid input format" },
      { status: 400 }
    );
  }
  return null;
}

/**
 * POST /api/v1/broadcasting - Create a new broadcast draft.
 */
export const POST = wrapRouteHandlerWithLogging(
  { routeId: "broadcast.draft", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }

      const input = broadcastDraftOperation.input.parse(body);

      if (!sessionUser) throw new Error("sessionUser required");

      const container = getContainer();
      const accountService = container.accountsForUser(
        toUserId(sessionUser.id)
      );
      const account = await accountService.getOrCreateBillingAccountForUser({
        userId: sessionUser.id,
      });

      const message = await container.broadcastLedger.createContentMessage(
        toUserId(sessionUser.id),
        account.id,
        {
          body: input.body,
          targetPlatforms: input.targetPlatforms,
          ...(input.title !== undefined && { title: input.title }),
          ...(input.mediaUrls !== undefined && { mediaUrls: input.mediaUrls }),
          ...(input.metadata !== undefined && { metadata: input.metadata }),
        }
      );

      ctx.log.info({ contentMessageId: message.id }, "broadcast.draft_success");

      return NextResponse.json(
        ContentMessageResponseSchema.parse(toResponse(message)),
        { status: 201 }
      );
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);

/**
 * GET /api/v1/broadcasting - List user's broadcast messages.
 */
export const GET = wrapRouteHandlerWithLogging(
  { routeId: "broadcast.list", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    try {
      if (!sessionUser) throw new Error("sessionUser required");

      const container = getContainer();
      const url = new URL(request.url);
      const statusFilter = url.searchParams.get("status") ?? undefined;

      const messages = await container.broadcastLedger.listContentMessages(
        toUserId(sessionUser.id),
        statusFilter
          ? { status: statusFilter as ContentMessage["status"] }
          : undefined
      );

      ctx.log.info({ count: messages.length }, "broadcast.list_success");

      return NextResponse.json(
        broadcastListOperation.output.parse({
          messages: messages.map(toResponse),
        })
      );
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
