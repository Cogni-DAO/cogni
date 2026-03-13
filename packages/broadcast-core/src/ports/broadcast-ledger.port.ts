// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/ports/broadcast-ledger`
 * Purpose: Persistence port interfaces for broadcasting domain entities.
 * Scope: Split by trust boundary — User (RLS) vs Worker (BYPASSRLS). Does not contain implementations.
 * Invariants:
 * - Crawl scope: ContentMessage + PlatformPost (with inline publish result)
 * - Walk adds: BroadcastRun reads/writes, EngagementSnapshot, Campaign CRUD
 * Side-effects: none (interface only)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { ActorId, UserId } from "@cogni/ids";
import type {
  ContentMessage,
  ContentMessageId,
  ContentMessageStatus,
  CreateContentMessageInput,
  CreatePlatformPostInput,
  FinalizePublishInput,
  PlatformPost,
  PlatformPostId,
  PlatformPostStatus,
  ReviewDecision,
} from "../types";

/** Filter options for listing content messages. */
export interface ContentMessageFilter {
  readonly status?: ContentMessageStatus;
}

/**
 * User-facing CRUD for broadcasting entities.
 * All methods enforce RLS via callerUserId.
 */
export interface BroadcastLedgerUserPort {
  createContentMessage(
    callerUserId: UserId,
    billingAccountId: string,
    input: CreateContentMessageInput
  ): Promise<ContentMessage>;

  getContentMessage(
    callerUserId: UserId,
    id: ContentMessageId
  ): Promise<ContentMessage | null>;

  listContentMessages(
    callerUserId: UserId,
    filter?: ContentMessageFilter
  ): Promise<readonly ContentMessage[]>;

  updateContentMessageStatus(
    callerUserId: UserId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ): Promise<ContentMessage>;

  getPlatformPosts(
    callerUserId: UserId,
    contentMessageId: ContentMessageId
  ): Promise<readonly PlatformPost[]>;

  updatePlatformPostReview(
    callerUserId: UserId,
    id: PlatformPostId,
    decision: ReviewDecision,
    editedBody?: string
  ): Promise<PlatformPost>;
}

/**
 * Worker-facing persistence for publishing pipeline.
 * Uses serviceDb (BYPASSRLS) for cross-tenant operations.
 */
export interface BroadcastLedgerWorkerPort {
  createPlatformPost(
    actorId: ActorId,
    input: CreatePlatformPostInput
  ): Promise<PlatformPost>;

  updatePlatformPostStatus(
    actorId: ActorId,
    id: PlatformPostId,
    status: PlatformPostStatus
  ): Promise<void>;

  finalizePlatformPost(
    actorId: ActorId,
    id: PlatformPostId,
    result: FinalizePublishInput
  ): Promise<void>;

  updateContentMessageStatus(
    actorId: ActorId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ): Promise<void>;

  getContentMessage(
    actorId: ActorId,
    id: ContentMessageId
  ): Promise<ContentMessage | null>;

  getPlatformPosts(
    actorId: ActorId,
    contentMessageId: ContentMessageId
  ): Promise<readonly PlatformPost[]>;
}
