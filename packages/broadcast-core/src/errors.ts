// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/errors`
 * Purpose: Domain error classes for the broadcasting pipeline.
 * Scope: Error classes with type guards. Does not contain business logic or I/O.
 * Invariants: Error codes are unique per class.
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

export class ContentMessageNotFoundError extends Error {
  readonly code = "CONTENT_MESSAGE_NOT_FOUND" as const;
  constructor(public readonly messageId: string) {
    super(`Content message not found: ${messageId}`);
    this.name = "ContentMessageNotFoundError";
  }
}

export class PlatformPostNotFoundError extends Error {
  readonly code = "PLATFORM_POST_NOT_FOUND" as const;
  constructor(public readonly postId: string) {
    super(`Platform post not found: ${postId}`);
    this.name = "PlatformPostNotFoundError";
  }
}

export class InvalidStatusTransitionError extends Error {
  readonly code = "INVALID_STATUS_TRANSITION" as const;
  constructor(
    public readonly from: string,
    public readonly to: string
  ) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}

export class PublishError extends Error {
  readonly code = "PUBLISH_ERROR" as const;
  constructor(
    public readonly platform: string,
    message: string
  ) {
    super(`Publish to ${platform} failed: ${message}`);
    this.name = "PublishError";
  }
}

// ── Type Guards ──────────────────────────────────────────────────

export function isContentMessageNotFoundError(
  error: unknown
): error is ContentMessageNotFoundError {
  return error instanceof ContentMessageNotFoundError;
}

export function isPlatformPostNotFoundError(
  error: unknown
): error is PlatformPostNotFoundError {
  return error instanceof PlatformPostNotFoundError;
}

export function isInvalidStatusTransitionError(
  error: unknown
): error is InvalidStatusTransitionError {
  return error instanceof InvalidStatusTransitionError;
}

export function isPublishError(error: unknown): error is PublishError {
  return error instanceof PublishError;
}
