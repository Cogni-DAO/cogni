// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/db-client/broadcasting/drizzle-broadcast-user`
 * Purpose: User-facing Drizzle adapter for broadcasting entities (RLS enforced).
 * Scope: Implements BroadcastLedgerUserPort with appDb. Does not contain worker operations.
 * Invariants:
 * - withTenantScope called on every method (uniform RLS enforcement)
 * - Per MESSAGE_IS_PLATFORM_AGNOSTIC: No platform-specific logic here
 * Side-effects: IO (database operations)
 * Links: docs/spec/broadcasting.md, packages/broadcast-core/src/ports/broadcast-ledger.port.ts
 * @public
 */

import type {
  BroadcastLedgerUserPort,
  ContentMessage,
  ContentMessageFilter,
  ContentMessageId,
  ContentMessageStatus,
  CreateContentMessageInput,
  PlatformPost,
  PlatformPostId,
  PlatformPostStatus,
  ReviewDecision,
} from "@cogni/broadcast-core";
import { contentMessages, platformPosts } from "@cogni/db-schema/broadcasting";
import type { UserId } from "@cogni/ids";
import { userActor } from "@cogni/ids";
import { and, eq } from "drizzle-orm";
import type { Database, LoggerLike } from "../client";
import { withTenantScope } from "../tenant-scope";

const defaultLogger: LoggerLike = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function toContentMessage(
  row: typeof contentMessages.$inferSelect
): ContentMessage {
  return {
    id: row.id as ContentMessageId,
    ownerUserId: row.ownerUserId,
    billingAccountId: row.billingAccountId,
    body: row.body,
    title: row.title,
    mediaUrls: row.mediaUrls ?? [],
    targetPlatforms: row.targetPlatforms ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    status: row.status as ContentMessageStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPlatformPost(row: typeof platformPosts.$inferSelect): PlatformPost {
  return {
    id: row.id as PlatformPostId,
    contentMessageId: row.contentMessageId as ContentMessageId,
    platform: row.platform,
    optimizedBody: row.optimizedBody,
    optimizedTitle: row.optimizedTitle,
    mediaUrls: row.mediaUrls ?? [],
    platformMetadata: (row.platformMetadata as Record<string, unknown>) ?? {},
    status: row.status as PlatformPostStatus,
    riskLevel: row.riskLevel,
    riskReason: row.riskReason,
    reviewDecision: row.reviewDecision as ReviewDecision | null,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    errorMessage: row.errorMessage,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleBroadcastUserAdapter implements BroadcastLedgerUserPort {
  private readonly logger: LoggerLike;

  constructor(
    private readonly db: Database,
    logger?: LoggerLike
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createContentMessage(
    callerUserId: UserId,
    billingAccountId: string,
    input: CreateContentMessageInput
  ): Promise<ContentMessage> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const [row] = await tx
        .insert(contentMessages)
        .values({
          ownerUserId: callerUserId,
          billingAccountId,
          body: input.body,
          title: input.title ?? null,
          targetPlatforms: [...input.targetPlatforms],
          mediaUrls: input.mediaUrls ? [...input.mediaUrls] : [],
          metadata: input.metadata ?? {},
          status: "draft",
        })
        .returning();

      if (!row) {
        throw new Error("Failed to insert content message");
      }

      this.logger.info({ contentMessageId: row.id }, "Created content message");

      return toContentMessage(row);
    });
  }

  async getContentMessage(
    callerUserId: UserId,
    id: ContentMessageId
  ): Promise<ContentMessage | null> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const row = await tx.query.contentMessages.findFirst({
        where: eq(contentMessages.id, id),
      });
      return row ? toContentMessage(row) : null;
    });
  }

  async listContentMessages(
    callerUserId: UserId,
    filter?: ContentMessageFilter
  ): Promise<readonly ContentMessage[]> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const conditions = [eq(contentMessages.ownerUserId, callerUserId)];
      if (filter?.status) {
        conditions.push(eq(contentMessages.status, filter.status));
      }
      const rows = await tx.query.contentMessages.findMany({
        where: and(...conditions),
      });
      return rows.map(toContentMessage);
    });
  }

  async updateContentMessageStatus(
    callerUserId: UserId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ): Promise<ContentMessage> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const [row] = await tx
        .update(contentMessages)
        .set({ status, updatedAt: new Date() })
        .where(eq(contentMessages.id, id))
        .returning();

      if (!row) {
        throw new Error(`Content message not found: ${id}`);
      }

      this.logger.info(
        { contentMessageId: id, status },
        "Updated content message status"
      );

      return toContentMessage(row);
    });
  }

  async getPlatformPosts(
    callerUserId: UserId,
    contentMessageId: ContentMessageId
  ): Promise<readonly PlatformPost[]> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const rows = await tx.query.platformPosts.findMany({
        where: eq(platformPosts.contentMessageId, contentMessageId),
      });
      return rows.map(toPlatformPost);
    });
  }

  async updatePlatformPostReview(
    callerUserId: UserId,
    id: PlatformPostId,
    decision: ReviewDecision,
    editedBody?: string
  ): Promise<PlatformPost> {
    const actorId = userActor(callerUserId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const updates: Partial<typeof platformPosts.$inferInsert> = {
        reviewDecision: decision,
        reviewedBy: callerUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };

      if (decision === "approved") {
        updates.status = "approved";
      } else if (decision === "rejected") {
        updates.status = "rejected";
      } else if (decision === "edited" && editedBody) {
        updates.optimizedBody = editedBody;
        updates.status = "approved";
      }

      const [row] = await tx
        .update(platformPosts)
        .set(updates)
        .where(eq(platformPosts.id, id))
        .returning();

      if (!row) {
        throw new Error(`Platform post not found: ${id}`);
      }

      this.logger.info(
        { platformPostId: id, decision },
        "Updated platform post review"
      );

      return toPlatformPost(row);
    });
  }
}
