// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/tests/errors`
 * Purpose: Unit tests for broadcasting domain error classes and type guards.
 * Scope: Tests error construction and isXxxError type guards. Does not test I/O.
 * Invariants: Error type guards must reliably distinguish error types.
 * Side-effects: none
 * Links: packages/broadcast-core/src/errors.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  ContentMessageNotFoundError,
  InvalidStatusTransitionError,
  isContentMessageNotFoundError,
  isInvalidStatusTransitionError,
  isPlatformPostNotFoundError,
  isPublishError,
  PlatformPostNotFoundError,
  PublishError,
} from "../src/errors";
import type { ContentMessageId, PlatformPostId } from "../src/types";

describe("ContentMessageNotFoundError", () => {
  it("has correct message and messageId", () => {
    const id = "msg-123" as ContentMessageId;
    const err = new ContentMessageNotFoundError(id);
    expect(err.message).toContain("msg-123");
    expect(err.messageId).toBe(id);
    expect(err.name).toBe("ContentMessageNotFoundError");
  });

  it("is identified by type guard", () => {
    const err = new ContentMessageNotFoundError("id" as ContentMessageId);
    expect(isContentMessageNotFoundError(err)).toBe(true);
    expect(isContentMessageNotFoundError(new Error("other"))).toBe(false);
  });
});

describe("PlatformPostNotFoundError", () => {
  it("has correct message and postId", () => {
    const id = "post-456" as PlatformPostId;
    const err = new PlatformPostNotFoundError(id);
    expect(err.message).toContain("post-456");
    expect(err.postId).toBe(id);
    expect(err.name).toBe("PlatformPostNotFoundError");
  });

  it("is identified by type guard", () => {
    const err = new PlatformPostNotFoundError("id" as PlatformPostId);
    expect(isPlatformPostNotFoundError(err)).toBe(true);
    expect(isPlatformPostNotFoundError(new Error("other"))).toBe(false);
  });
});

describe("InvalidStatusTransitionError", () => {
  it("has correct message with from/to", () => {
    const err = new InvalidStatusTransitionError("draft", "published");
    expect(err.message).toContain("draft");
    expect(err.message).toContain("published");
    expect(err.from).toBe("draft");
    expect(err.to).toBe("published");
    expect(err.name).toBe("InvalidStatusTransitionError");
  });

  it("is identified by type guard", () => {
    const err = new InvalidStatusTransitionError("draft", "published");
    expect(isInvalidStatusTransitionError(err)).toBe(true);
    expect(isInvalidStatusTransitionError(new Error("other"))).toBe(false);
  });
});

describe("PublishError", () => {
  it("has correct message and platform", () => {
    const err = new PublishError("x", "API rate limited");
    expect(err.message).toContain("API rate limited");
    expect(err.platform).toBe("x");
    expect(err.name).toBe("PublishError");
  });

  it("is identified by type guard", () => {
    const err = new PublishError("x", "fail");
    expect(isPublishError(err)).toBe(true);
    expect(isPublishError(new Error("other"))).toBe(false);
  });
});
