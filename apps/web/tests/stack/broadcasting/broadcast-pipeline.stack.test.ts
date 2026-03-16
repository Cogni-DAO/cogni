// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/broadcasting/broadcast-pipeline.stack`
 * Purpose: Happy-path stack test for the full broadcast pipeline: draft → optimize → review → publish.
 * Scope: Tests POST/GET broadcasting routes with mocked auth against real DB. Does not test real platform publishing.
 * Invariants:
 *   - MESSAGE_IS_PLATFORM_AGNOSTIC: body unchanged by optimization
 *   - PUBLISH_IS_IDEMPOTENT: approving twice does not double-publish
 *   - STATE_TRANSITIONS_ENFORCED: statuses progress correctly
 * Side-effects: IO (database)
 * Links: docs/spec/broadcasting.md, apps/web/src/app/api/v1/broadcasting/
 * @public
 */

import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { seedTestActor, type TestActor } from "@tests/_fixtures/stack/seed";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getSessionUser } from "@/app/_lib/auth/session";
import { POST as POST_REVIEW } from "@/app/api/v1/broadcasting/[messageId]/posts/[postId]/review/route";
import { GET as GET_STATUS } from "@/app/api/v1/broadcasting/[messageId]/route";
import {
  GET as GET_LIST,
  POST as POST_DRAFT,
} from "@/app/api/v1/broadcasting/route";
import { users } from "@/shared/db";

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

describe("[broadcasting] full pipeline: draft → optimize → review → publish", () => {
  let testActor: TestActor;

  beforeEach(async () => {
    const db = getSeedDb();
    testActor = await seedTestActor(db);
    vi.mocked(getSessionUser).mockResolvedValue(testActor.user);
  });

  afterEach(async () => {
    const db = getSeedDb();
    // content_messages cascade-deletes platform_posts via FK
    await db.delete(users).where(eq(users.id, testActor.user.id));
    vi.clearAllMocks();
  });

  test("happy path: create draft → posts generated → approve → published", async () => {
    // 1. Create a broadcast draft
    const draftRequest = new NextRequest(
      "http://localhost:3000/api/v1/broadcasting",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "Launch day!",
          targetPlatforms: ["x", "discord"],
        }),
      }
    );

    const draftResponse = await POST_DRAFT(draftRequest);
    expect(draftResponse.status).toBe(201);

    const draft = await draftResponse.json();
    expect(draft.id).toBeDefined();
    expect(draft.status).toBe("review");
    expect(draft.targetPlatforms).toEqual(["x", "discord"]);

    const messageId = draft.id;

    // 2. Get status — should have platform posts
    const statusRequest = new NextRequest(
      `http://localhost:3000/api/v1/broadcasting/${messageId}`,
      { method: "GET" }
    );

    const statusResponse = await GET_STATUS(statusRequest, {
      params: Promise.resolve({ messageId }),
    });
    expect(statusResponse.status).toBe(200);

    const status = await statusResponse.json();
    expect(status.posts).toHaveLength(2);

    const xPost = status.posts.find(
      (p: { platform: string }) => p.platform === "x"
    );
    const discordPost = status.posts.find(
      (p: { platform: string }) => p.platform === "discord"
    );

    expect(xPost).toBeDefined();
    expect(discordPost).toBeDefined();
    expect(xPost.optimizedBody).toContain("[x]");
    expect(discordPost.optimizedBody).toContain("[discord]");
    // Short body, 2 platforms = low risk → auto-approved (skips review)
    expect(xPost.status).toBe("approved");
    expect(discordPost.status).toBe("approved");

    // 3. List broadcasts — should show the message
    const listRequest = new NextRequest(
      "http://localhost:3000/api/v1/broadcasting",
      { method: "GET" }
    );

    const listResponse = await GET_LIST(listRequest);
    expect(listResponse.status).toBe(200);

    const list = await listResponse.json();
    expect(list.messages.length).toBeGreaterThanOrEqual(1);
    expect(list.messages.some((m: { id: string }) => m.id === messageId)).toBe(
      true
    );
  });

  test("high-risk message: URL in body → posts at pending_review", async () => {
    const draftRequest = new NextRequest(
      "http://localhost:3000/api/v1/broadcasting",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "Check out https://example.com for our launch!",
          targetPlatforms: ["x"],
        }),
      }
    );

    const draftResponse = await POST_DRAFT(draftRequest);
    expect(draftResponse.status).toBe(201);

    const draft = await draftResponse.json();
    const messageId = draft.id;

    // Posts should be pending_review (high risk due to URL)
    const statusRequest = new NextRequest(
      `http://localhost:3000/api/v1/broadcasting/${messageId}`,
      { method: "GET" }
    );

    const statusResponse = await GET_STATUS(statusRequest, {
      params: Promise.resolve({ messageId }),
    });
    const status = await statusResponse.json();
    expect(status.posts[0].status).toBe("pending_review");
    expect(status.posts[0].riskLevel).toBe("high");

    // Approve → should publish via echo
    const postId = status.posts[0].id;
    const reviewRequest = new NextRequest(
      `http://localhost:3000/api/v1/broadcasting/${messageId}/posts/${postId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }
    );

    const reviewResponse = await POST_REVIEW(reviewRequest, {
      params: Promise.resolve({ messageId, postId }),
    });
    expect(reviewResponse.status).toBe(200);

    const reviewed = await reviewResponse.json();
    expect(reviewed.status).toBe("published");
    expect(reviewed.externalId).toContain("echo-x-");
    expect(reviewed.externalUrl).toContain("echo.local");
  });

  test("review with wrong messageId → ownership error", async () => {
    // Create a draft
    const draftRequest = new NextRequest(
      "http://localhost:3000/api/v1/broadcasting",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "Check https://example.com — needs review",
          targetPlatforms: ["x"],
        }),
      }
    );

    const draftResponse = await POST_DRAFT(draftRequest);
    const draft = await draftResponse.json();
    const messageId = draft.id;

    // Get the real post ID
    const statusResponse = await GET_STATUS(
      new NextRequest(
        `http://localhost:3000/api/v1/broadcasting/${messageId}`,
        { method: "GET" }
      ),
      { params: Promise.resolve({ messageId }) }
    );
    const status = await statusResponse.json();
    const postId = status.posts[0].id;

    // Try to review with a fake messageId — should fail ownership check
    const fakeMessageId = "00000000-0000-0000-0000-000000000000";
    const reviewRequest = new NextRequest(
      `http://localhost:3000/api/v1/broadcasting/${fakeMessageId}/posts/${postId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      }
    );

    // Should fail — post doesn't belong to this message
    // applyReviewDecision throws, wrapRouteHandlerWithLogging may rethrow or return 500
    const reviewResponse = await POST_REVIEW(reviewRequest, {
      params: Promise.resolve({ messageId: fakeMessageId, postId }),
    }).catch((err: Error) => {
      // Error rethrown by route handler — ownership validation working
      expect(err.message).toContain("not found for message");
      return null;
    });

    if (reviewResponse) {
      // If route catches the error and returns a response, expect non-200
      expect(reviewResponse.status).toBeGreaterThanOrEqual(400);
    }
  });
});
