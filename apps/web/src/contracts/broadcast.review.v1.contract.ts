// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/broadcast.review.v1.contract`
 * Purpose: Defines operation contract for reviewing a platform post.
 * Scope: Provides Zod schemas and types for broadcast review wire format. Does not contain business logic.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - All consumers use z.infer types
 * - Per REVIEW_BEFORE_HIGH_RISK: HIGH-risk posts require explicit approval
 * Side-effects: none
 * Links: /api/v1/broadcasting/[messageId]/posts/[postId]/review route, docs/spec/broadcasting.md
 * @internal
 */

import { z } from "zod";

export const REVIEW_DECISIONS = ["approved", "rejected", "edited"] as const;

export const BroadcastReviewInputSchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  editedBody: z.string().max(5000).optional(),
});

export const PlatformPostResponseSchema = z.object({
  id: z.string().uuid(),
  contentMessageId: z.string().uuid(),
  platform: z.string(),
  optimizedBody: z.string(),
  optimizedTitle: z.string().nullable(),
  mediaUrls: z.array(z.string()),
  platformMetadata: z.record(z.string(), z.unknown()),
  status: z.string(),
  riskLevel: z.string().nullable(),
  riskReason: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const broadcastReviewOperation = {
  id: "broadcast.review.v1",
  summary: "Review a platform post",
  description:
    "Submit a review decision (approve, reject, or edit) for a platform post. Per REVIEW_BEFORE_HIGH_RISK, HIGH-risk posts require explicit approval.",
  input: BroadcastReviewInputSchema,
  output: PlatformPostResponseSchema,
} as const;

// Export inferred types - all consumers MUST use these, never manual interfaces
export type BroadcastReviewInput = z.infer<typeof BroadcastReviewInputSchema>;
export type PlatformPostResponse = z.infer<typeof PlatformPostResponseSchema>;
