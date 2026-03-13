// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/tests/types`
 * Purpose: Unit tests for broadcasting type helpers and branded ID factories.
 * Scope: Tests toContentMessageId, toPlatformPostId, and enum completeness. Does not test I/O.
 * Invariants: Branded IDs are string-based with tag metadata.
 * Side-effects: none
 * Links: packages/broadcast-core/src/types.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  CONTENT_MESSAGE_STATUSES,
  PLATFORM_IDS,
  PLATFORM_POST_STATUSES,
  REVIEW_DECISIONS,
  RISK_LEVELS,
  toContentMessageId,
  toPlatformPostId,
} from "../src/types";

describe("branded ID factories", () => {
  it("toContentMessageId returns the same string", () => {
    const raw = "550e8400-e29b-41d4-a716-446655440000";
    const id = toContentMessageId(raw);
    expect(id).toBe(raw);
    // Type assertion: id is ContentMessageId, can be used as string
    expect(typeof id).toBe("string");
  });

  it("toPlatformPostId returns the same string", () => {
    const raw = "660e8400-e29b-41d4-a716-446655440000";
    const id = toPlatformPostId(raw);
    expect(id).toBe(raw);
    expect(typeof id).toBe("string");
  });
});

describe("enum completeness", () => {
  it("PLATFORM_IDS contains expected platforms", () => {
    expect(PLATFORM_IDS).toContain("x");
    expect(PLATFORM_IDS).toContain("bluesky");
    expect(PLATFORM_IDS).toContain("linkedin");
    expect(PLATFORM_IDS).toContain("discord");
    expect(PLATFORM_IDS).toContain("blog");
    expect(PLATFORM_IDS).toHaveLength(5);
  });

  it("CONTENT_MESSAGE_STATUSES covers the full lifecycle", () => {
    expect(CONTENT_MESSAGE_STATUSES).toContain("draft");
    expect(CONTENT_MESSAGE_STATUSES).toContain("optimizing");
    expect(CONTENT_MESSAGE_STATUSES).toContain("review");
    expect(CONTENT_MESSAGE_STATUSES).toContain("approved");
    expect(CONTENT_MESSAGE_STATUSES).toContain("publishing");
    expect(CONTENT_MESSAGE_STATUSES).toContain("published");
    expect(CONTENT_MESSAGE_STATUSES).toContain("failed");
    expect(CONTENT_MESSAGE_STATUSES).toContain("cancelled");
    expect(CONTENT_MESSAGE_STATUSES).toHaveLength(8);
  });

  it("PLATFORM_POST_STATUSES covers the full lifecycle", () => {
    expect(PLATFORM_POST_STATUSES).toContain("pending_optimization");
    expect(PLATFORM_POST_STATUSES).toContain("optimized");
    expect(PLATFORM_POST_STATUSES).toContain("pending_review");
    expect(PLATFORM_POST_STATUSES).toContain("approved");
    expect(PLATFORM_POST_STATUSES).toContain("rejected");
    expect(PLATFORM_POST_STATUSES).toContain("publishing");
    expect(PLATFORM_POST_STATUSES).toContain("published");
    expect(PLATFORM_POST_STATUSES).toContain("failed");
    expect(PLATFORM_POST_STATUSES).toHaveLength(8);
  });

  it("REVIEW_DECISIONS contains all options", () => {
    expect(REVIEW_DECISIONS).toContain("approved");
    expect(REVIEW_DECISIONS).toContain("rejected");
    expect(REVIEW_DECISIONS).toContain("edited");
    expect(REVIEW_DECISIONS).toHaveLength(3);
  });

  it("RISK_LEVELS contains all levels", () => {
    expect(RISK_LEVELS).toContain("low");
    expect(RISK_LEVELS).toContain("medium");
    expect(RISK_LEVELS).toContain("high");
    expect(RISK_LEVELS).toHaveLength(3);
  });
});
