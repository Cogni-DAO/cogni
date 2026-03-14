// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core`
 * Purpose: Broadcasting core types and port interfaces.
 * Scope: Pure types and interfaces for broadcasting domain. Does not contain implementations or I/O.
 * Invariants:
 * - FORBIDDEN: `@/`, `src/`, drizzle-orm, any I/O
 * - ALLOWED: Pure TypeScript types/interfaces only
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

// Errors
export {
  ContentMessageNotFoundError,
  InvalidStatusTransitionError,
  isContentMessageNotFoundError,
  isInvalidStatusTransitionError,
  isPlatformPostNotFoundError,
  isPublishError,
  PlatformPostNotFoundError,
  PublishError,
} from "./errors";
// Ports
export type {
  BroadcastLedgerUserPort,
  BroadcastLedgerWorkerPort,
  ContentMessageFilter,
  ContentOptimizerPort,
  HealthCheckResult,
  OptimizationResult,
  PublishPort,
  PublishResult,
} from "./ports";
// Rules
export {
  assessRisk,
  canTransitionMessage,
  canTransitionPlatformPost,
  requiresReview,
} from "./rules";
// Types
export {
  CONTENT_MESSAGE_STATUSES,
  type ContentMessage,
  type ContentMessageId,
  type ContentMessageStatus,
  type CreateContentMessageInput,
  type CreatePlatformPostInput,
  type FinalizePublishInput,
  type GenerationPolicy,
  PLATFORM_IDS,
  PLATFORM_POST_STATUSES,
  type PlatformId,
  type PlatformPost,
  type PlatformPostId,
  type PlatformPostStatus,
  REVIEW_DECISIONS,
  type ReviewDecision,
  RISK_LEVELS,
  type RiskLevel,
  toContentMessageId,
  toPlatformPostId,
} from "./types";
