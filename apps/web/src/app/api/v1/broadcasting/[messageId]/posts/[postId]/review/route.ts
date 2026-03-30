// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/broadcasting/[messageId]/posts/[postId]/review`
 * Purpose: HTTP endpoint for platform post review submission.
 * Scope: Auth-protected POST endpoint for review decisions. Does not contain business logic.
 * Invariants:
 * - Per REVIEW_BEFORE_HIGH_RISK: HIGH-risk posts require explicit approval
 * Side-effects: IO (HTTP request/response, database)
 * Links: docs/spec/broadcasting.md, broadcast.review.v1.contract
 * @public
 */

import {
  applyReviewDecision,
  type PlatformPost,
  publishPost,
  toContentMessageId,
  toPlatformPostId,
} from "@cogni/broadcast-core";
import { toUserId, userActor } from "@cogni/ids";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  broadcastReviewOperation,
  PlatformPostResponseSchema,
} from "@/contracts/broadcast.review.v1.contract";
import { logRequestWarn, type RequestContext } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
 * POST /api/v1/broadcasting/[messageId]/posts/[postId]/review - Submit review.
 */
export const POST = wrapRouteHandlerWithLogging<{
  params: Promise<{ messageId: string; postId: string }>;
}>(
  { routeId: "broadcast.review", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser, context) => {
    try {
      if (!sessionUser) throw new Error("sessionUser required");
      if (!context) throw new Error("context required for dynamic routes");

      const { messageId, postId } = await context.params;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }

      const input = broadcastReviewOperation.input.parse(body);
      const container = getContainer();
      const userId = toUserId(sessionUser.id);
      const msgId = toContentMessageId(messageId);
      const pId = toPlatformPostId(postId);

      // Apply review decision (validates ownership + status)
      let post = await applyReviewDecision(
        { ledger: container.broadcastLedger },
        userId,
        msgId,
        pId,
        input.decision,
        input.editedBody
      );

      // If approved, attempt to publish
      if (input.decision === "approved") {
        const publisher = container.broadcastPublishers.get(post.platform);
        if (publisher) {
          try {
            const result = await publishPost(
              {
                ledger: container.broadcastWorkerLedger,
                publisher,
              },
              userActor(userId),
              msgId,
              pId
            );
            post = result.post;
            ctx.log.info(
              {
                platformPostId: postId,
                published: result.published,
                skipped: result.skipped,
              },
              "broadcast.publish_result"
            );
          } catch (publishError) {
            ctx.log.warn(
              { platformPostId: postId, err: publishError },
              "broadcast.publish_failed"
            );
            // Re-fetch to return current state (may be "failed")
            const currentPosts =
              await container.broadcastLedger.getPlatformPosts(userId, msgId);
            const currentPost = currentPosts.find((p) => p.id === pId);
            if (currentPost) post = currentPost;
          }
        }
      }

      ctx.log.info(
        { platformPostId: postId, decision: input.decision },
        "broadcast.review_success"
      );

      return NextResponse.json(
        PlatformPostResponseSchema.parse(toPostResponse(post))
      );
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
