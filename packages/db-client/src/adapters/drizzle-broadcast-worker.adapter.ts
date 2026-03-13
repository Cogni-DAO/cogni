// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/db-client/broadcasting/drizzle-broadcast-worker`
 * Purpose: Worker-facing Drizzle adapter for broadcasting pipeline (serviceDb, BYPASSRLS).
 * Scope: Implements BroadcastLedgerWorkerPort with serviceDb. Does not contain user-facing operations.
 * Invariants:
 * - withTenantScope called on every method (no-op on serviceDb, uniform pattern)
 * - Per REVIEW_BEFORE_HIGH_RISK: Status transitions enforced at domain layer, not here
 * Side-effects: IO (database operations)
 * Links: docs/spec/broadcasting.md, packages/broadcast-core/src/ports/broadcast-ledger.port.ts
 * @public
 */

import type {
  BroadcastLedgerWorkerPort,
  ContentMessage,
  ContentMessageId,
  ContentMessageStatus,
  CreatePlatformPostInput,
  FinalizePublishInput,
  PlatformPost,
  PlatformPostId,
  PlatformPostStatus,
  ReviewDecision,
} from "@cogni/broadcast-core";
import { contentMessages, platformPosts } from "@cogni/db-schema/broadcasting";
import type { ActorId } from "@cogni/ids";
import { eq } from "drizzle-orm";
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

export class DrizzleBroadcastWorkerAdapter
  implements BroadcastLedgerWorkerPort
{
  private readonly logger: LoggerLike;

  constructor(
    private readonly db: Database,
    logger?: LoggerLike
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createPlatformPost(
    actorId: ActorId,
    input: CreatePlatformPostInput
  ): Promise<PlatformPost> {
    return withTenantScope(this.db, actorId, async (tx) => {
      const [row] = await tx
        .insert(platformPosts)
        .values({
          contentMessageId: input.contentMessageId,
          platform: input.platform,
          optimizedBody: input.optimizedBody,
          optimizedTitle: input.optimizedTitle ?? null,
          mediaUrls: input.mediaUrls ? [...input.mediaUrls] : [],
          platformMetadata: input.platformMetadata ?? {},
          riskLevel: input.riskLevel ?? null,
          riskReason: input.riskReason ?? null,
          status: "pending_optimization",
        })
        .returning();

      if (!row) {
        throw new Error("Failed to insert platform post");
      }

      this.logger.info(
        { platformPostId: row.id, platform: input.platform },
        "Created platform post"
      );

      return toPlatformPost(row);
    });
  }

  async updatePlatformPostStatus(
    actorId: ActorId,
    id: PlatformPostId,
    status: PlatformPostStatus
  ): Promise<void> {
    await withTenantScope(this.db, actorId, async (tx) => {
      await tx
        .update(platformPosts)
        .set({ status, updatedAt: new Date() })
        .where(eq(platformPosts.id, id));
    });

    this.logger.info(
      { platformPostId: id, status },
      "Updated platform post status"
    );
  }

  async finalizePlatformPost(
    actorId: ActorId,
    id: PlatformPostId,
    result: FinalizePublishInput
  ): Promise<void> {
    await withTenantScope(this.db, actorId, async (tx) => {
      const updates: Partial<typeof platformPosts.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (result.externalId !== undefined) {
        updates.externalId = result.externalId;
      }
      if (result.externalUrl !== undefined) {
        updates.externalUrl = result.externalUrl;
      }
      if (result.errorMessage !== undefined) {
        updates.errorMessage = result.errorMessage;
      }
      if (result.publishedAt !== undefined) {
        updates.publishedAt = result.publishedAt;
      }

      // If we have externalId, it's a successful publish
      if (result.externalId) {
        updates.status = "published";
      }
      // If we have errorMessage but no externalId, it failed
      if (result.errorMessage && !result.externalId) {
        updates.status = "failed";
      }

      await tx
        .update(platformPosts)
        .set(updates)
        .where(eq(platformPosts.id, id));
    });

    this.logger.info(
      { platformPostId: id, hasExternalId: !!result.externalId },
      "Finalized platform post"
    );
  }

  async updateContentMessageStatus(
    actorId: ActorId,
    id: ContentMessageId,
    status: ContentMessageStatus
  ): Promise<void> {
    await withTenantScope(this.db, actorId, async (tx) => {
      await tx
        .update(contentMessages)
        .set({ status, updatedAt: new Date() })
        .where(eq(contentMessages.id, id));
    });

    this.logger.info(
      { contentMessageId: id, status },
      "Updated content message status (worker)"
    );
  }

  async getContentMessage(
    actorId: ActorId,
    id: ContentMessageId
  ): Promise<ContentMessage | null> {
    return withTenantScope(this.db, actorId, async (tx) => {
      const row = await tx.query.contentMessages.findFirst({
        where: eq(contentMessages.id, id),
      });
      return row ? toContentMessage(row) : null;
    });
  }

  async getPlatformPosts(
    actorId: ActorId,
    contentMessageId: ContentMessageId
  ): Promise<readonly PlatformPost[]> {
    return withTenantScope(this.db, actorId, async (tx) => {
      const rows = await tx.query.platformPosts.findMany({
        where: eq(platformPosts.contentMessageId, contentMessageId),
      });
      return rows.map(toPlatformPost);
    });
  }
}
