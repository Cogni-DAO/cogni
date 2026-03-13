// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/rules`
 * Purpose: Pure domain rules for risk assessment and state machine transitions.
 * Scope: Pure functions used by workflow and adapters. Does not perform I/O.
 * Invariants:
 * - REVIEW_BEFORE_HIGH_RISK: HIGH-risk posts block until explicit approval
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type {
  ContentMessage,
  ContentMessageStatus,
  PlatformPost,
  PlatformPostStatus,
  RiskLevel,
} from "./types";

// ── Content Message State Machine ────────────────────────────────

const CONTENT_MESSAGE_TRANSITIONS: Record<
  ContentMessageStatus,
  readonly ContentMessageStatus[]
> = {
  draft: ["optimizing", "cancelled"],
  optimizing: ["review", "failed"],
  review: ["approved", "cancelled"],
  approved: ["publishing", "cancelled"],
  publishing: ["published", "failed"],
  published: [],
  failed: ["draft"],
  cancelled: [],
};

export function canTransitionMessage(
  from: ContentMessageStatus,
  to: ContentMessageStatus
): boolean {
  return CONTENT_MESSAGE_TRANSITIONS[from].includes(to);
}

// ── Platform Post State Machine ──────────────────────────────────

const PLATFORM_POST_TRANSITIONS: Record<
  PlatformPostStatus,
  readonly PlatformPostStatus[]
> = {
  pending_optimization: ["optimized", "failed"],
  optimized: ["pending_review", "approved"],
  pending_review: ["approved", "rejected"],
  approved: ["publishing"],
  rejected: [],
  publishing: ["published", "failed"],
  published: [],
  failed: ["pending_optimization"],
};

export function canTransitionPlatformPost(
  from: PlatformPostStatus,
  to: PlatformPostStatus
): boolean {
  return PLATFORM_POST_TRANSITIONS[from].includes(to);
}

// ── Risk Assessment ──────────────────────────────────────────────

/**
 * Assess risk of a content message based on content and target platforms.
 * Pure function — no I/O.
 *
 * Risk heuristics:
 * - HIGH: contains URLs, mentions, or > 500 chars (needs human review)
 * - MEDIUM: targets > 2 platforms
 * - LOW: short content, single platform
 */
export function assessRisk(
  message: ContentMessage,
  _platformPosts: readonly PlatformPost[]
): RiskLevel {
  const body = message.body;

  // HIGH: contains URLs or @ mentions (potential spam/misuse)
  if (/https?:\/\//.test(body) || /@\w+/.test(body)) {
    return "high";
  }

  // HIGH: long content (more likely to contain problematic material)
  if (body.length > 500) {
    return "high";
  }

  // MEDIUM: multi-platform broadcast (higher blast radius)
  if (message.targetPlatforms.length > 2) {
    return "medium";
  }

  return "low";
}

/**
 * Determine if a post at a given risk level requires explicit human review.
 * Per REVIEW_BEFORE_HIGH_RISK: HIGH-risk posts always require review.
 */
export function requiresReview(riskLevel: RiskLevel): boolean {
  return riskLevel === "high";
}
