// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/broadcasting/[messageId]`
 * Purpose: HTTP endpoint for broadcast message status.
 * Scope: Auth-protected GET endpoint for content message with platform posts. Does not contain business logic.
 * Invariants:
 * - Content message ownership scoped to caller via RLS
 * Side-effects: IO (HTTP request/response, database)
 * Links: docs/spec/broadcasting.md, broadcast.status.v1.contract
 * @public
 */

import type { ContentMessage, PlatformPost } from "@cogni/broadcast-core";
import { toUserId } from "@cogni/ids";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { broadcastStatusOperation } from "@/contracts/broadcast.status.v1.contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toMessageResponse(msg: ContentMessage) {
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

function toPostResponse(post: PlatformPost) {
  return {
    id: post.id,
    contentMessageId: post.contentMessageId,
    platform: post.platform,
    optimizedBody: post.optimizedBody,
    optimizedTitle: post.optimizedTitle,
    mediaUrls: [...post.mediaUrls],
    platformMetadata: post.platformMetadata,
    status: post.status,
    riskLevel: post.riskLevel,
    riskReason: post.riskReason,
    reviewDecision: post.reviewDecision,
    reviewedBy: post.reviewedBy,
    reviewedAt: post.reviewedAt?.toISOString() ?? null,
    externalId: post.externalId,
    externalUrl: post.externalUrl,
    errorMessage: post.errorMessage,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

/**
 * GET /api/v1/broadcasting/[messageId] - Get broadcast status.
 */
export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ messageId: string }>;
}>(
  { routeId: "broadcast.status", auth: { mode: "required", getSessionUser } },
  async (ctx, _request, sessionUser, context) => {
    if (!sessionUser) throw new Error("sessionUser required");
    if (!context) throw new Error("context required for dynamic routes");

    const { messageId } = await context.params;
    const userId = toUserId(sessionUser.id);
    const container = getContainer();

    const message = await container.broadcastLedger.getContentMessage(
      userId,
      messageId as never
    );

    if (!message) {
      return NextResponse.json(
        { error: "Content message not found" },
        { status: 404 }
      );
    }

    const posts = await container.broadcastLedger.getPlatformPosts(
      userId,
      message.id
    );

    ctx.log.info({ contentMessageId: messageId }, "broadcast.status_success");

    return NextResponse.json(
      broadcastStatusOperation.output.parse({
        message: toMessageResponse(message),
        posts: posts.map(toPostResponse),
      })
    );
  }
);
