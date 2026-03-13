// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/tests/rules`
 * Purpose: Unit tests for broadcasting domain rules (state machines, risk assessment).
 * Scope: Tests pure functions from rules.ts. Does not test I/O or adapters.
 * Invariants:
 * - REVIEW_BEFORE_HIGH_RISK: HIGH-risk posts require review
 * Side-effects: none
 * Links: packages/broadcast-core/src/rules.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  assessRisk,
  canTransitionMessage,
  canTransitionPlatformPost,
  requiresReview,
} from "../src/rules";
import type { ContentMessage, ContentMessageId } from "../src/types";

// ── Helpers ──────────────────────────────────────────────────────

function makeMessage(overrides: Partial<ContentMessage> = {}): ContentMessage {
  return {
    id: "test-msg-id" as ContentMessageId,
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

// ── Content Message State Machine ────────────────────────────────

describe("canTransitionMessage", () => {
  it("allows draft → optimizing", () => {
    expect(canTransitionMessage("draft", "optimizing")).toBe(true);
  });

  it("allows draft → cancelled", () => {
    expect(canTransitionMessage("draft", "cancelled")).toBe(true);
  });

  it("disallows draft → published", () => {
    expect(canTransitionMessage("draft", "published")).toBe(false);
  });

  it("allows optimizing → review", () => {
    expect(canTransitionMessage("optimizing", "review")).toBe(true);
  });

  it("allows optimizing → failed", () => {
    expect(canTransitionMessage("optimizing", "failed")).toBe(true);
  });

  it("allows failed → draft (retry)", () => {
    expect(canTransitionMessage("failed", "draft")).toBe(true);
  });

  it("disallows published → anything", () => {
    expect(canTransitionMessage("published", "draft")).toBe(false);
    expect(canTransitionMessage("published", "cancelled")).toBe(false);
  });

  it("disallows cancelled → anything", () => {
    expect(canTransitionMessage("cancelled", "draft")).toBe(false);
  });
});

// ── Platform Post State Machine ──────────────────────────────────

describe("canTransitionPlatformPost", () => {
  it("allows pending_optimization → optimized", () => {
    expect(canTransitionPlatformPost("pending_optimization", "optimized")).toBe(
      true
    );
  });

  it("allows optimized → pending_review", () => {
    expect(canTransitionPlatformPost("optimized", "pending_review")).toBe(true);
  });

  it("allows optimized → approved (auto-approve low risk)", () => {
    expect(canTransitionPlatformPost("optimized", "approved")).toBe(true);
  });

  it("allows approved → publishing", () => {
    expect(canTransitionPlatformPost("approved", "publishing")).toBe(true);
  });

  it("allows publishing → published", () => {
    expect(canTransitionPlatformPost("publishing", "published")).toBe(true);
  });

  it("allows publishing → failed", () => {
    expect(canTransitionPlatformPost("publishing", "failed")).toBe(true);
  });

  it("disallows rejected → anything", () => {
    expect(canTransitionPlatformPost("rejected", "approved")).toBe(false);
    expect(canTransitionPlatformPost("rejected", "publishing")).toBe(false);
  });

  it("allows failed → pending_optimization (retry)", () => {
    expect(canTransitionPlatformPost("failed", "pending_optimization")).toBe(
      true
    );
  });
});

// ── Risk Assessment ──────────────────────────────────────────────

describe("assessRisk", () => {
  it("returns low for short, single-platform messages", () => {
    const msg = makeMessage({ body: "Hello", targetPlatforms: ["x"] });
    expect(assessRisk(msg, [])).toBe("low");
  });

  it("returns high for messages with URLs", () => {
    const msg = makeMessage({ body: "Check https://example.com" });
    expect(assessRisk(msg, [])).toBe("high");
  });

  it("returns high for messages with @ mentions", () => {
    const msg = makeMessage({ body: "Hey @admin check this" });
    expect(assessRisk(msg, [])).toBe("high");
  });

  it("returns high for messages over 500 characters", () => {
    const msg = makeMessage({ body: "x".repeat(501) });
    expect(assessRisk(msg, [])).toBe("high");
  });

  it("returns medium for messages targeting > 2 platforms", () => {
    const msg = makeMessage({
      body: "Hello world",
      targetPlatforms: ["x", "bluesky", "discord"],
    });
    expect(assessRisk(msg, [])).toBe("medium");
  });

  it("returns low for 2-platform messages without URLs", () => {
    const msg = makeMessage({
      body: "Hello",
      targetPlatforms: ["x", "bluesky"],
    });
    expect(assessRisk(msg, [])).toBe("low");
  });
});

// ── Review Requirement ───────────────────────────────────────────

describe("requiresReview", () => {
  it("requires review for high risk", () => {
    expect(requiresReview("high")).toBe(true);
  });

  it("does not require review for medium risk", () => {
    expect(requiresReview("medium")).toBe(false);
  });

  it("does not require review for low risk", () => {
    expect(requiresReview("low")).toBe(false);
  });
});
