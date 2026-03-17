// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/reservation.port`
 * Purpose: Port interfaces for the reservation assistant feature.
 * Scope: Defines ReservationStorePort (persistence) and ReservationProviderPort (platform integration).
 * Invariants:
 * - USER_APPROVAL_GATE: createBookingAttempt only called after explicit user approval
 * - OFFICIAL_CHANNELS_ONLY: providers must use official platform APIs/UX
 * - NO_SCRAPING: providers must never scrape or bypass anti-bot protections
 * - AUDIT_TRAIL: every action produces a watch_event record
 * Side-effects: none (interface only)
 * Links: task.0166, @core/reservations
 * @public
 */

import type {
  BookingAttempt,
  BookingAttemptStatus,
  WatchEvent,
  WatchEventSource,
  WatchEventType,
  WatchRequest,
  WatchRequestStatus,
} from "@/core";

// Re-exported for adapter access (adapters can only import from @/ports)
export type { BookingAttempt, WatchEvent, WatchRequest } from "@/core";

/* ─── Port Errors ─────────────────────────────────────────────────── */

export class WatchRequestNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Watch request not found: ${id}`);
    this.name = "WatchRequestNotFoundError";
  }
}

/* ─── Store Port (Persistence) ────────────────────────────────────── */

export interface CreateWatchRequestParams {
  userId: string;
  platform: string;
  venue: string;
  partySize: string;
  dateStart: Date;
  dateEnd: Date;
  preferredTimeStart?: string | undefined;
  preferredTimeEnd?: string | undefined;
}

export interface ReservationStorePort {
  createWatchRequest(params: CreateWatchRequestParams): Promise<WatchRequest>;
  getWatchRequest(id: string): Promise<WatchRequest | null>;
  listWatchRequests(userId: string): Promise<WatchRequest[]>;
  updateWatchRequestStatus(
    id: string,
    status: WatchRequestStatus
  ): Promise<WatchRequest>;

  appendEvent(params: {
    watchRequestId: string;
    source: WatchEventSource;
    eventType: WatchEventType;
    payloadJson?: Record<string, unknown> | undefined;
  }): Promise<WatchEvent>;
  listEvents(watchRequestId: string): Promise<WatchEvent[]>;

  createBookingAttempt(watchRequestId: string): Promise<BookingAttempt>;
  updateBookingAttemptStatus(
    id: string,
    status: BookingAttemptStatus,
    details?: Record<string, unknown>
  ): Promise<BookingAttempt>;
  listBookingAttempts(watchRequestId: string): Promise<BookingAttempt[]>;
}

/* ─── Provider Port (Platform Integration) ────────────────────────── */

/**
 * ReservationProviderPort — abstraction for restaurant reservation platforms.
 *
 * COMPLIANCE GUARDRAILS:
 * - Implementations MUST use only official platform APIs or user-directed UX
 * - Implementations MUST NOT scrape, bypass captchas, rotate accounts, or evade detection
 * - Booking assist MUST only occur with stored, user-provided authenticated sessions
 * - All actions MUST be logged via watch_events for auditability
 */
export interface ReservationProviderPort {
  /** Platform identifier (e.g., "resy", "opentable") */
  readonly platformId: string;

  /**
   * Set up an alert/notification for the given watch request.
   * Uses the platform's official notification mechanism.
   * Returns instructions for the user if manual setup is needed.
   */
  setupAlert(watch: WatchRequest): Promise<AlertSetupResult>;

  /**
   * Attempt to book a reservation on behalf of the user.
   * Only called after explicit user approval.
   * Uses Playwright with stored authenticated session state.
   *
   * INVARIANT: USER_APPROVAL_GATE — caller must verify approval before invoking.
   */
  attemptBooking(params: BookingAssistParams): Promise<BookingAssistResult>;
}

export interface AlertSetupResult {
  success: boolean;
  /** Instructions for the user if manual steps are needed */
  userInstructions?: string | undefined;
  /** URL the user should visit to complete alert setup */
  setupUrl?: string | undefined;
}

export interface BookingAssistParams {
  watch: WatchRequest;
  /** Path to stored browser session state (cookies, localStorage) */
  sessionStatePath: string;
  /** The specific availability slot to attempt */
  targetSlot?: { date: string; time: string } | undefined;
}

export interface BookingAssistResult {
  success: boolean;
  confirmationCode?: string | undefined;
  /** Path to screenshot for debugging/audit */
  screenshotPath?: string | undefined;
  error?: string | undefined;
}
