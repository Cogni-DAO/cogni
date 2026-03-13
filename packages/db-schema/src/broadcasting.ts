// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/broadcasting`
 * Purpose: Broadcasting tables schema for content publishing pipeline.
 * Scope: Defines content_messages, platform_posts tables. Does not contain queries or logic.
 * Invariants:
 * - content_messages: Platform-agnostic content intent (the "what to say")
 * - platform_posts: Platform-specific rendition with inline publish result (Crawl simplification)
 * - ONE_POST_PER_PLATFORM: UNIQUE(content_message_id, platform) prevents duplicates
 * - RLS enabled on both tables
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { billingAccounts, users } from "./refs";

// ── Content Message Statuses ────────────────────────────────────

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

// ── Platform Post Statuses ──────────────────────────────────────

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

// ── Platform IDs ────────────────────────────────────────────────

export const PLATFORM_IDS = [
  "x",
  "bluesky",
  "linkedin",
  "discord",
  "blog",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

// ── Risk Levels ─────────────────────────────────────────────────

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// ── Review Decisions ────────────────────────────────────────────

export const REVIEW_DECISIONS = ["approved", "rejected", "edited"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

// ── Content Messages ────────────────────────────────────────────

/**
 * Content messages — platform-agnostic content intent.
 * Per MESSAGE_IS_PLATFORM_AGNOSTIC: body has no platform-specific formatting.
 */
export const contentMessages = pgTable(
  "content_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    billingAccountId: text("billing_account_id")
      .notNull()
      .references(() => billingAccounts.id, { onDelete: "cascade" }),
    /** Platform-agnostic body text */
    body: text("body").notNull(),
    /** Optional title */
    title: text("title"),
    /** Media attachment URLs */
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    /** Target platforms for broadcast */
    targetPlatforms: jsonb("target_platforms").$type<PlatformId[]>().notNull(),
    /** Arbitrary metadata */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Content message status */
    status: text("status", { enum: CONTENT_MESSAGE_STATUSES })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerIdx: index("content_messages_owner_idx").on(table.ownerUserId),
    statusIdx: index("content_messages_status_idx").on(table.status),
    billingAccountIdx: index("content_messages_billing_account_idx").on(
      table.billingAccountId
    ),
  })
).enableRLS();

// ── Platform Posts ──────────────────────────────────────────────

/**
 * Platform posts — platform-specific optimized rendition with inline publish result.
 * Per ONE_POST_PER_PLATFORM: UNIQUE(content_message_id, platform) prevents duplicates.
 * Publish result fields (externalId, externalUrl, errorMessage, publishedAt) are
 * flattened here for Crawl simplicity instead of a separate broadcast_runs table.
 */
export const platformPosts = pgTable(
  "platform_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentMessageId: uuid("content_message_id")
      .notNull()
      .references(() => contentMessages.id, { onDelete: "cascade" }),
    /** Target platform */
    platform: text("platform", { enum: PLATFORM_IDS }).notNull(),
    /** AI-optimized body text for this platform */
    optimizedBody: text("optimized_body").notNull(),
    /** AI-optimized title (optional) */
    optimizedTitle: text("optimized_title"),
    /** Media attachment URLs (may differ from content message) */
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    /** Platform-specific metadata from optimizer */
    platformMetadata: jsonb("platform_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Platform post status */
    status: text("status", { enum: PLATFORM_POST_STATUSES })
      .notNull()
      .default("pending_optimization"),
    /** Risk assessment level */
    riskLevel: text("risk_level", { enum: RISK_LEVELS }),
    /** Risk assessment reason */
    riskReason: text("risk_reason"),
    /** Human review decision */
    reviewDecision: text("review_decision", { enum: REVIEW_DECISIONS }),
    /** Who reviewed */
    reviewedBy: text("reviewed_by"),
    /** When reviewed */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // ── Inline publish result (Crawl simplification) ──
    /** External platform post ID */
    externalId: text("external_id"),
    /** External platform post URL */
    externalUrl: text("external_url"),
    /** Error message if publish failed */
    errorMessage: text("error_message"),
    /** When published */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    contentMessageIdx: index("platform_posts_content_message_idx").on(
      table.contentMessageId
    ),
    /** ONE_POST_PER_PLATFORM: Prevents duplicate posts per platform per message */
    platformUnique: uniqueIndex("platform_posts_platform_unique").on(
      table.contentMessageId,
      table.platform
    ),
    statusIdx: index("platform_posts_status_idx").on(table.status),
  })
).enableRLS();
