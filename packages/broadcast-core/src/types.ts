// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/types`
 * Purpose: Domain types and enums for the broadcasting pipeline.
 * Scope: ContentMessage, PlatformPost, branded IDs, status enums. Does not contain logic or I/O.
 * Invariants:
 * - MESSAGE_IS_PLATFORM_AGNOSTIC: ContentMessage.body has no platform-specific formatting
 * - ONE_POST_PER_PLATFORM: A ContentMessage produces at most one PlatformPost per PlatformId
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { Tagged } from "type-fest";

// ── Branded IDs ──────────────────────────────────────────────────

export type ContentMessageId = Tagged<string, "ContentMessageId">;
export type PlatformPostId = Tagged<string, "PlatformPostId">;

export function toContentMessageId(raw: string): ContentMessageId {
  return raw as ContentMessageId;
}

export function toPlatformPostId(raw: string): PlatformPostId {
  return raw as PlatformPostId;
}

// ── Enums ────────────────────────────────────────────────────────

export const PLATFORM_IDS = [
  "x",
  "bluesky",
  "linkedin",
  "discord",
  "blog",
] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const CONTENT_MESSAGE_STATUSES = [
  "draft",
  "optimizing",
  "review",
  "approved",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
export type ContentMessageStatus = (typeof CONTENT_MESSAGE_STATUSES)[number];

export const PLATFORM_POST_STATUSES = [
  "pending_optimization",
  "optimized",
  "pending_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "failed",
] as const;
export type PlatformPostStatus = (typeof PLATFORM_POST_STATUSES)[number];

export const REVIEW_DECISIONS = ["approved", "rejected", "edited"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ── Domain Entities ──────────────────────────────────────────────

/** Platform-agnostic content intent. The "what to say". */
export interface ContentMessage {
  readonly id: ContentMessageId;
  readonly ownerUserId: string;
  readonly billingAccountId: string;
  readonly body: string;
  readonly title: string | null;
  readonly mediaUrls: readonly string[];
  readonly targetPlatforms: readonly PlatformId[];
  readonly metadata: Record<string, unknown>;
  readonly status: ContentMessageStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Platform-specific optimized rendition + publish result. */
export interface PlatformPost {
  readonly id: PlatformPostId;
  readonly contentMessageId: ContentMessageId;
  readonly platform: PlatformId;
  readonly optimizedBody: string;
  readonly optimizedTitle: string | null;
  readonly mediaUrls: readonly string[];
  readonly platformMetadata: Record<string, unknown>;
  readonly status: PlatformPostStatus;
  readonly riskLevel: RiskLevel | null;
  readonly riskReason: string | null;
  readonly reviewDecision: ReviewDecision | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  // Publish result (flattened from BroadcastRun for Crawl simplicity)
  readonly externalId: string | null;
  readonly externalUrl: string | null;
  readonly errorMessage: string | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ── Generation Policy ────────────────────────────────────────────

/**
 * Token budget and trim strategy for LLM-based content optimization.
 * Passed to ContentOptimizerPort so the adapter can enforce model-aware
 * limits without leaking those concerns into Zod request contracts.
 */
export interface GenerationPolicy {
  /** Max input tokens to send to the model. Adapter counts and enforces. */
  readonly maxInputTokens?: number;
  /** Max output tokens to request from the model. */
  readonly maxOutputTokens?: number;
  /** What to do when input exceeds maxInputTokens. */
  readonly trimStrategy?: "truncate" | "summarize" | "fail";
}

// ── Input Types ──────────────────────────────────────────────────

export interface CreateContentMessageInput {
  readonly body: string;
  readonly title?: string;
  readonly targetPlatforms: readonly PlatformId[];
  readonly mediaUrls?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface CreatePlatformPostInput {
  readonly contentMessageId: ContentMessageId;
  readonly platform: PlatformId;
  readonly optimizedBody: string;
  readonly optimizedTitle?: string;
  readonly mediaUrls?: readonly string[];
  readonly platformMetadata?: Record<string, unknown>;
  readonly riskLevel?: RiskLevel;
  readonly riskReason?: string;
}

export interface FinalizePublishInput {
  readonly externalId?: string;
  readonly externalUrl?: string;
  readonly errorMessage?: string;
  readonly publishedAt?: Date;
}
