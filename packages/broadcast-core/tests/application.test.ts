// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/tests/application`
 * Purpose: Unit tests for broadcasting application use-cases with mock ports.
 * Scope: Tests optimizeDraft, applyReviewDecision, publishPost. Does not test adapters or I/O.
 * Invariants: USE_CASES_ARE_TEMPORAL_READY, PUBLISH_IS_IDEMPOTENT, STATE_TRANSITIONS_ENFORCED
 * Side-effects: none
 * Links: packages/broadcast-core/src/application/
 * @internal
 */

import type { ActorId, UserId } from "@cogni/ids";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyReviewDecision } from "../src/application/apply-review-decision";
import { optimizeDraft } from "../src/application/optimize-draft";
import { publishPost } from "../src/application/publish-post";
import {
  ContentMessageNotFoundError,
  InvalidStatusTransitionError,
} from "../src/errors";
import type {
  BroadcastLedgerUserPort,
  BroadcastLedgerWorkerPort,
} from "../src/ports/broadcast-ledger.port";
import type { ContentOptimizerPort } from "../src/ports/content-optimizer.port";
import type { PublishPort } from "../src/ports/publish.port";
import type {
  ContentMessage,
  ContentMessageId,
  PlatformPost,
  PlatformPostId,
} from "../src/types";

// ── Helpers ──────────────────────────────────────────────────────

const ACTOR_ID = "actor-1" as ActorId;
const USER_ID = "user-1" as UserId;
const MSG_ID = "msg-1" as ContentMessageId;
const POST_ID = "post-1" as PlatformPostId;

function makeMessage(overrides: Partial<ContentMessage> = {}): ContentMessage {
  return {
    id: MSG_ID,
    ownerUserId: "user-1",
    billingAccountId: "billing-1",
    body: "Hello world",
    title: null,
    mediaUrls: [],
    targetPlatforms: ["x"],
    metadata: {},
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePost(overrides: Partial<PlatformPost> = {}): PlatformPost {
  return {
    id: POST_ID,
    contentMessageId: MSG_ID,
    platform: "x",
    optimizedBody: "[x] Hello world",
    optimizedTitle: null,
    mediaUrls: [],
    platformMetadata: {},
    status: "pending_review",
    riskLevel: "low",
    riskReason: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    externalId: null,
    externalUrl: null,
    errorMessage: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── optimizeDraft ───────────────────────────────────────────────

describe("optimizeDraft", () => {
  let ledger: BroadcastLedgerWorkerPort;
  let optimizer: ContentOptimizerPort;

  beforeEach(() => {
    const msg = makeMessage();
    const post = makePost({ status: "pending_optimization" });
    ledger = {
      getContentMessage: vi.fn().mockResolvedValue(msg),
      updateContentMessageStatus: vi.fn().mockResolvedValue(undefined),
      createPlatformPost: vi.fn().mockResolvedValue(post),
      updatePlatformPostStatus: vi.fn().mockResolvedValue(undefined),
      finalizePlatformPost: vi.fn().mockResolvedValue(undefined),
      getPlatformPosts: vi.fn().mockResolvedValue([post]),
    };
    optimizer = {
      optimize: vi.fn().mockResolvedValue({
        optimizedBody: "[x] Hello world",
        platformMetadata: {},
        riskLevel: "low",
      }),
    };
  });

  it("creates platform posts for each target platform", async () => {
    const msg = makeMessage({ targetPlatforms: ["x", "bluesky"] });
    vi.mocked(ledger.getContentMessage).mockResolvedValue(msg);

    await optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID);

    expect(optimizer.optimize).toHaveBeenCalledTimes(2);
    expect(ledger.createPlatformPost).toHaveBeenCalledTimes(2);
  });

  it("transitions message draft → optimizing → review", async () => {
    await optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID);

    expect(ledger.updateContentMessageStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      MSG_ID,
      "optimizing"
    );
    expect(ledger.updateContentMessageStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      MSG_ID,
      "review"
    );
  });

  it("sets pending_review for high-risk posts", async () => {
    const msg = makeMessage({ body: "Check https://example.com" });
    vi.mocked(ledger.getContentMessage).mockResolvedValue(msg);
    vi.mocked(optimizer.optimize).mockResolvedValue({
      optimizedBody: "[x] Check https://example.com",
      platformMetadata: {},
      riskLevel: "high",
    });

    await optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID);

    expect(ledger.updatePlatformPostStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      "pending_review"
    );
  });

  it("sets approved for low-risk posts", async () => {
    await optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID);

    expect(ledger.updatePlatformPostStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      "approved"
    );
  });

  it("throws ContentMessageNotFoundError if message missing", async () => {
    vi.mocked(ledger.getContentMessage).mockResolvedValue(null);

    await expect(
      optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID)
    ).rejects.toThrow(ContentMessageNotFoundError);
  });

  it("throws InvalidStatusTransitionError if not in draft", async () => {
    const msg = makeMessage({ status: "published" });
    vi.mocked(ledger.getContentMessage).mockResolvedValue(msg);

    await expect(
      optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID)
    ).rejects.toThrow(InvalidStatusTransitionError);
  });

  it("transitions message to failed when optimization throws", async () => {
    vi.mocked(optimizer.optimize).mockRejectedValue(new Error("LLM timeout"));

    await expect(
      optimizeDraft({ ledger, optimizer }, ACTOR_ID, MSG_ID)
    ).rejects.toThrow("LLM timeout");

    expect(ledger.updateContentMessageStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      MSG_ID,
      "failed"
    );
  });
});

// ── applyReviewDecision ─────────────────────────────────────────

describe("applyReviewDecision", () => {
  let ledger: BroadcastLedgerUserPort;

  beforeEach(() => {
    const post = makePost({ status: "pending_review" });
    ledger = {
      createContentMessage: vi.fn(),
      getContentMessage: vi.fn(),
      listContentMessages: vi.fn(),
      updateContentMessageStatus: vi.fn(),
      getPlatformPosts: vi.fn().mockResolvedValue([post]),
      updatePlatformPostReview: vi.fn().mockResolvedValue({
        ...post,
        reviewDecision: "approved",
        status: "approved",
      }),
    };
  });

  it("applies approved decision", async () => {
    const result = await applyReviewDecision(
      { ledger },
      USER_ID,
      MSG_ID,
      POST_ID,
      "approved"
    );

    expect(result.reviewDecision).toBe("approved");
    expect(ledger.updatePlatformPostReview).toHaveBeenCalledWith(
      USER_ID,
      POST_ID,
      "approved",
      undefined
    );
  });

  it("throws if post not found for message (ownership check)", async () => {
    vi.mocked(ledger.getPlatformPosts).mockResolvedValue([]);

    await expect(
      applyReviewDecision({ ledger }, USER_ID, MSG_ID, POST_ID, "approved")
    ).rejects.toThrow("not found for message");
  });

  it("throws if post not in pending_review", async () => {
    const post = makePost({ status: "published" });
    vi.mocked(ledger.getPlatformPosts).mockResolvedValue([post]);

    await expect(
      applyReviewDecision({ ledger }, USER_ID, MSG_ID, POST_ID, "approved")
    ).rejects.toThrow("expected 'pending_review'");
  });

  it("throws if edited without editedBody", async () => {
    await expect(
      applyReviewDecision({ ledger }, USER_ID, MSG_ID, POST_ID, "edited")
    ).rejects.toThrow("requires editedBody");
  });

  it("passes editedBody for edited decision", async () => {
    await applyReviewDecision(
      { ledger },
      USER_ID,
      MSG_ID,
      POST_ID,
      "edited",
      "new body"
    );

    expect(ledger.updatePlatformPostReview).toHaveBeenCalledWith(
      USER_ID,
      POST_ID,
      "edited",
      "new body"
    );
  });
});

// ── publishPost ─────────────────────────────────────────────────

describe("publishPost", () => {
  let ledger: BroadcastLedgerWorkerPort;
  let publisher: PublishPort;

  beforeEach(() => {
    const post = makePost({ status: "approved" });
    ledger = {
      getContentMessage: vi.fn(),
      updateContentMessageStatus: vi.fn(),
      createPlatformPost: vi.fn(),
      updatePlatformPostStatus: vi.fn().mockResolvedValue(undefined),
      finalizePlatformPost: vi.fn().mockResolvedValue(undefined),
      getPlatformPosts: vi.fn().mockResolvedValue([post]),
    };
    publisher = {
      platform: "x",
      publish: vi.fn().mockResolvedValue({
        externalId: "tweet-123",
        externalUrl: "https://x.com/tweet/123",
      }),
      delete: vi.fn(),
      healthCheck: vi.fn(),
    };
  });

  it("publishes approved post and finalizes", async () => {
    const result = await publishPost(
      { ledger, publisher },
      ACTOR_ID,
      MSG_ID,
      POST_ID
    );

    expect(result.published).toBe(true);
    expect(result.skipped).toBe(false);
    expect(publisher.publish).toHaveBeenCalled();
    expect(ledger.finalizePlatformPost).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      expect.objectContaining({
        externalId: "tweet-123",
        externalUrl: "https://x.com/tweet/123",
      })
    );
  });

  it("skips if already published (PUBLISH_IS_IDEMPOTENT)", async () => {
    const post = makePost({
      status: "published",
      externalId: "already-published",
    });
    vi.mocked(ledger.getPlatformPosts).mockResolvedValue([post]);

    const result = await publishPost(
      { ledger, publisher },
      ACTOR_ID,
      MSG_ID,
      POST_ID
    );

    expect(result.published).toBe(false);
    expect(result.skipped).toBe(true);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("throws if post not in approved status", async () => {
    const post = makePost({ status: "pending_review" });
    vi.mocked(ledger.getPlatformPosts).mockResolvedValue([post]);

    await expect(
      publishPost({ ledger, publisher }, ACTOR_ID, MSG_ID, POST_ID)
    ).rejects.toThrow("expected 'approved'");
  });

  it("throws if platform mismatch", async () => {
    const post = makePost({ status: "approved", platform: "bluesky" });
    vi.mocked(ledger.getPlatformPosts).mockResolvedValue([post]);

    await expect(
      publishPost({ ledger, publisher }, ACTOR_ID, MSG_ID, POST_ID)
    ).rejects.toThrow("does not match");
  });

  it("transitions to failed on publish error", async () => {
    vi.mocked(publisher.publish).mockRejectedValue(new Error("API timeout"));

    await expect(
      publishPost({ ledger, publisher }, ACTOR_ID, MSG_ID, POST_ID)
    ).rejects.toThrow("API timeout");

    expect(ledger.updatePlatformPostStatus).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      "failed"
    );
    expect(ledger.finalizePlatformPost).toHaveBeenCalledWith(
      ACTOR_ID,
      POST_ID,
      expect.objectContaining({ errorMessage: "API timeout" })
    );
  });
});
