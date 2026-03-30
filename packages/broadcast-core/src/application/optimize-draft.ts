// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/application/optimize-draft`
 * Purpose: Orchestrate draft optimization — run ContentOptimizerPort per target platform, create PlatformPosts, assess risk.
 * Scope: Pure orchestration. Takes ports as args. Does not perform I/O directly.
 * Invariants:
 *   - USE_CASES_ARE_TEMPORAL_READY: pure function, ports as args, no HTTP/framework deps
 *   - REVIEW_BEFORE_HIGH_RISK: high-risk posts get pending_review status
 *   - STATE_TRANSITIONS_ENFORCED: validates message is in draft status
 *   - ONE_POST_PER_PLATFORM: one optimization per target platform
 * Side-effects: none (delegates to ports)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { ActorId } from "@cogni/ids";

import {
  ContentMessageNotFoundError,
  InvalidStatusTransitionError,
} from "../errors";
import type { BroadcastLedgerWorkerPort } from "../ports/broadcast-ledger.port";
import type { ContentOptimizerPort } from "../ports/content-optimizer.port";
import { assessRisk, canTransitionMessage, requiresReview } from "../rules";
import type { ContentMessage, ContentMessageId, PlatformPost } from "../types";

export interface OptimizeDraftDeps {
  readonly ledger: BroadcastLedgerWorkerPort;
  readonly optimizer: ContentOptimizerPort;
}

export interface OptimizeDraftResult {
  readonly message: ContentMessage;
  readonly posts: readonly PlatformPost[];
}

/**
 * Optimize a draft ContentMessage for all target platforms.
 *
 * 1. Validates message is in `draft` status
 * 2. Transitions message to `optimizing`
 * 3. Runs ContentOptimizerPort per target platform
 * 4. Creates PlatformPosts with risk assessment
 * 5. Transitions message to `review`
 *
 * @throws InvalidStatusTransitionError if message is not in `draft` status
 */
export async function optimizeDraft(
  deps: OptimizeDraftDeps,
  actorId: ActorId,
  messageId: ContentMessageId
): Promise<OptimizeDraftResult> {
  const { ledger, optimizer } = deps;

  // 1. Fetch and validate
  const message = await ledger.getContentMessage(actorId, messageId);
  if (!message) {
    throw new ContentMessageNotFoundError(messageId);
  }

  if (!canTransitionMessage(message.status, "optimizing")) {
    throw new InvalidStatusTransitionError(message.status, "optimizing");
  }

  // 2. Transition to optimizing
  await ledger.updateContentMessageStatus(actorId, messageId, "optimizing");

  // 3. Optimize for each platform + create posts
  const riskLevel = assessRisk(message);
  const needsReview = requiresReview(riskLevel);

  try {
    for (const platform of message.targetPlatforms) {
      const result = await optimizer.optimize(message, platform);

      await ledger.createPlatformPost(actorId, {
        contentMessageId: messageId,
        platform,
        optimizedBody: result.optimizedBody,
        optimizedTitle: result.optimizedTitle,
        mediaUrls: [...message.mediaUrls],
        platformMetadata: result.platformMetadata,
        riskLevel: result.riskLevel,
        riskReason: result.riskReason,
      });
    }
  } catch (error) {
    // Transition message to failed so it doesn't stay stuck in "optimizing"
    await ledger.updateContentMessageStatus(actorId, messageId, "failed");
    throw error;
  }

  // 4. Transition posts based on risk, then message to review
  const posts = await ledger.getPlatformPosts(actorId, messageId);
  for (const post of posts) {
    const targetStatus = needsReview ? "pending_review" : "approved";
    await ledger.updatePlatformPostStatus(actorId, post.id, targetStatus);
  }

  await ledger.updateContentMessageStatus(actorId, messageId, "review");

  // Re-fetch to get current state
  const [updatedMessage, updatedPosts] = await Promise.all([
    ledger.getContentMessage(actorId, messageId),
    ledger.getPlatformPosts(actorId, messageId),
  ]);

  return {
    message: updatedMessage ?? message,
    posts: updatedPosts,
  };
}
