// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/reservations`
 * Purpose: Schema for reservation assistant — watch requests, events, and booking attempts.
 * Scope: Defines watch_requests, watch_events, booking_attempts tables. Does not contain queries or logic.
 * Invariants:
 * - watch_events: Immutable audit trail for every state change and external signal
 * - booking_attempts: Only created after explicit user approval (USER_APPROVAL_GATE)
 * - All timestamps use withTimezone: true
 * Side-effects: none (schema definitions only)
 * Links: task.0166, apps/web/src/ports/reservation.port.ts
 * @public
 */

import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./refs";

/* ─── Enums ───────────────────────────────────────────────────────── */

export const WATCH_REQUEST_STATUSES = [
  "active",
  "paused",
  "fulfilled",
  "cancelled",
  "expired",
] as const;
export type WatchRequestStatus = (typeof WATCH_REQUEST_STATUSES)[number];

export const WATCH_EVENT_TYPES = [
  "created",
  "alert_received",
  "availability_detected",
  "user_notified",
  "user_approved",
  "user_declined",
  "booking_started",
  "booking_succeeded",
  "booking_failed",
  "paused",
  "resumed",
  "cancelled",
  "expired",
] as const;
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

export const WATCH_EVENT_SOURCES = [
  "system",
  "resy",
  "opentable",
  "email",
  "webhook",
  "manual",
] as const;
export type WatchEventSource = (typeof WATCH_EVENT_SOURCES)[number];

export const BOOKING_ATTEMPT_STATUSES = [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type BookingAttemptStatus = (typeof BOOKING_ATTEMPT_STATUSES)[number];

export const RESERVATION_PLATFORMS = ["resy", "opentable", "other"] as const;
export type ReservationPlatform = (typeof RESERVATION_PLATFORMS)[number];

/* ─── Tables ──────────────────────────────────────────────────────── */

/**
 * Watch requests — user-created monitoring entries for restaurant availability.
 * Each row tracks a single venue+date-range+party-size watch.
 */
export const watchRequests = pgTable(
  "watch_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Platform to monitor: resy, opentable, other */
    platform: text("platform", { enum: RESERVATION_PLATFORMS }).notNull(),
    /** Restaurant/venue name or identifier */
    venue: text("venue").notNull(),
    /** Party size for the reservation */
    partySize: text("party_size").notNull(),
    /** Start of date range to watch (inclusive) */
    dateStart: timestamp("date_start", { withTimezone: true }).notNull(),
    /** End of date range to watch (inclusive) */
    dateEnd: timestamp("date_end", { withTimezone: true }).notNull(),
    /** Preferred earliest time slot (e.g., "18:00") */
    preferredTimeStart: text("preferred_time_start"),
    /** Preferred latest time slot (e.g., "21:00") */
    preferredTimeEnd: text("preferred_time_end"),
    /** Current status of the watch */
    status: text("status", { enum: WATCH_REQUEST_STATUSES })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("watch_requests_user_idx").on(table.userId),
    statusIdx: index("watch_requests_status_idx").on(table.status),
    userStatusIdx: index("watch_requests_user_status_idx").on(
      table.userId,
      table.status
    ),
  })
).enableRLS();

/**
 * Watch events — immutable audit trail for watch request lifecycle.
 * Every state transition, external alert, and user action is recorded here.
 */
export const watchEvents = pgTable(
  "watch_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    watchRequestId: uuid("watch_request_id")
      .notNull()
      .references(() => watchRequests.id, { onDelete: "cascade" }),
    /** Origin of the event */
    source: text("source", { enum: WATCH_EVENT_SOURCES }).notNull(),
    /** Type of event */
    eventType: text("event_type", { enum: WATCH_EVENT_TYPES }).notNull(),
    /** Arbitrary JSON payload (alert details, error info, etc.) */
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    watchRequestIdx: index("watch_events_watch_request_idx").on(
      table.watchRequestId
    ),
    eventTypeIdx: index("watch_events_event_type_idx").on(table.eventType),
  })
).enableRLS();

/**
 * Booking attempts — records of user-approved booking assistance actions.
 * Only created after explicit user approval (USER_APPROVAL_GATE invariant).
 */
export const bookingAttempts = pgTable(
  "booking_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    watchRequestId: uuid("watch_request_id")
      .notNull()
      .references(() => watchRequests.id, { onDelete: "cascade" }),
    /** Current status of the booking attempt */
    status: text("status", { enum: BOOKING_ATTEMPT_STATUSES })
      .notNull()
      .default("pending"),
    /** Structured details: screenshots paths, error messages, confirmation codes */
    detailsJson: jsonb("details_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    watchRequestIdx: index("booking_attempts_watch_request_idx").on(
      table.watchRequestId
    ),
    statusIdx: index("booking_attempts_status_idx").on(table.status),
  })
).enableRLS();
