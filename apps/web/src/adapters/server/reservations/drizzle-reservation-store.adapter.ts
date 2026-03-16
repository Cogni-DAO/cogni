// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/reservations/drizzle-reservation-store`
 * Purpose: Drizzle ORM implementation of ReservationStorePort.
 * Scope: Database persistence for watch requests, events, and booking attempts.
 * Invariants:
 * - AUDIT_TRAIL: watch_events are append-only
 * - All timestamps stored with timezone
 * Side-effects: IO (database reads and writes)
 * Links: task.0166, @ports/reservation.port
 * @public
 */

import type {
  BookingAttemptStatus,
  WatchEventSource,
  WatchEventType,
  WatchRequestStatus,
} from "@cogni/db-schema/reservations";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@/adapters/server/db/client";
import type {
  BookingAttempt,
  CreateWatchRequestParams,
  ReservationStorePort,
  WatchEvent,
  WatchRequest,
} from "@/ports";
import { bookingAttempts, watchEvents, watchRequests } from "@/shared/db";

/* ─── Row Mappers ─────────────────────────────────────────────────── */

type WatchRequestRow = typeof watchRequests.$inferSelect;
type WatchEventRow = typeof watchEvents.$inferSelect;
type BookingAttemptRow = typeof bookingAttempts.$inferSelect;

function mapWatchRequest(row: WatchRequestRow): WatchRequest {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform,
    venue: row.venue,
    partySize: row.partySize,
    dateStart: row.dateStart,
    dateEnd: row.dateEnd,
    preferredTimeStart: row.preferredTimeStart,
    preferredTimeEnd: row.preferredTimeEnd,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapWatchEvent(row: WatchEventRow): WatchEvent {
  return {
    id: row.id,
    watchRequestId: row.watchRequestId,
    source: row.source,
    eventType: row.eventType,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt,
  };
}

function mapBookingAttempt(row: BookingAttemptRow): BookingAttempt {
  return {
    id: row.id,
    watchRequestId: row.watchRequestId,
    status: row.status,
    detailsJson: row.detailsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ─── Adapter ─────────────────────────────────────────────────────── */

export class DrizzleReservationStoreAdapter implements ReservationStorePort {
  constructor(private db: Database) {}

  async createWatchRequest(
    params: CreateWatchRequestParams
  ): Promise<WatchRequest> {
    const [row] = await this.db
      .insert(watchRequests)
      .values({
        userId: params.userId,
        platform: params.platform as WatchRequestRow["platform"],
        venue: params.venue,
        partySize: params.partySize,
        dateStart: params.dateStart,
        dateEnd: params.dateEnd,
        preferredTimeStart: params.preferredTimeStart ?? null,
        preferredTimeEnd: params.preferredTimeEnd ?? null,
      })
      .returning();
    return mapWatchRequest(row!);
  }

  async getWatchRequest(id: string): Promise<WatchRequest | null> {
    const rows = await this.db
      .select()
      .from(watchRequests)
      .where(eq(watchRequests.id, id))
      .limit(1);
    return rows[0] ? mapWatchRequest(rows[0]) : null;
  }

  async listWatchRequests(userId: string): Promise<WatchRequest[]> {
    const rows = await this.db
      .select()
      .from(watchRequests)
      .where(eq(watchRequests.userId, userId))
      .orderBy(desc(watchRequests.createdAt));
    return rows.map(mapWatchRequest);
  }

  async updateWatchRequestStatus(
    id: string,
    status: WatchRequestStatus
  ): Promise<WatchRequest> {
    const [row] = await this.db
      .update(watchRequests)
      .set({ status, updatedAt: new Date() })
      .where(eq(watchRequests.id, id))
      .returning();
    return mapWatchRequest(row!);
  }

  async appendEvent(params: {
    watchRequestId: string;
    source: WatchEventSource;
    eventType: WatchEventType;
    payloadJson?: Record<string, unknown> | undefined;
  }): Promise<WatchEvent> {
    const [row] = await this.db
      .insert(watchEvents)
      .values({
        watchRequestId: params.watchRequestId,
        source: params.source,
        eventType: params.eventType,
        payloadJson: params.payloadJson ?? null,
      })
      .returning();
    return mapWatchEvent(row!);
  }

  async listEvents(watchRequestId: string): Promise<WatchEvent[]> {
    const rows = await this.db
      .select()
      .from(watchEvents)
      .where(eq(watchEvents.watchRequestId, watchRequestId))
      .orderBy(watchEvents.createdAt);
    return rows.map(mapWatchEvent);
  }

  async createBookingAttempt(watchRequestId: string): Promise<BookingAttempt> {
    const [row] = await this.db
      .insert(bookingAttempts)
      .values({ watchRequestId })
      .returning();
    return mapBookingAttempt(row!);
  }

  async updateBookingAttemptStatus(
    id: string,
    status: BookingAttemptStatus,
    details?: Record<string, unknown>
  ): Promise<BookingAttempt> {
    const [row] = await this.db
      .update(bookingAttempts)
      .set({
        status,
        detailsJson: details ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(bookingAttempts.id, id))
      .returning();
    return mapBookingAttempt(row!);
  }

  async listBookingAttempts(watchRequestId: string): Promise<BookingAttempt[]> {
    const rows = await this.db
      .select()
      .from(bookingAttempts)
      .where(eq(bookingAttempts.watchRequestId, watchRequestId))
      .orderBy(desc(bookingAttempts.createdAt));
    return rows.map(mapBookingAttempt);
  }
}
