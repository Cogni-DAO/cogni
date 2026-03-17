// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/reservation`
 * Purpose: Temporal Activities for reservation watch workflows.
 * Scope: Plain async functions that perform I/O (DB, HTTP, notifications). Called by Workflow.
 * Invariants:
 * - Per ACTIVITY_IDEMPOTENCY: All activities idempotent or rely on downstream idempotency
 * - USER_APPROVAL_GATE: attemptBookingActivity only called after user approval signal
 * - OFFICIAL_CHANNELS_ONLY: no scraping, no anti-bot bypass
 * - AUDIT_TRAIL: every action recorded as watch_event
 * Side-effects: IO (database, notifications)
 * Links: task.0166
 * @internal
 */

import type { Logger } from "../observability/logger.js";

/* ─── Activity Input/Output Types ─────────────────────────────────── */

export interface RecordEventInput {
  watchRequestId: string;
  source: "system" | "resy" | "opentable" | "email" | "webhook" | "manual";
  eventType: string;
  payload?: Record<string, unknown>;
}

export interface SetupAlertInput {
  watchRequestId: string;
  platform: string;
}

export interface NotifyUserInput {
  watchRequestId: string;
  userId: string;
  alertPayload: { source: string; payload: Record<string, unknown> };
}

export interface AttemptBookingInput {
  watchRequestId: string;
  platform: string;
  sessionStatePath: string;
  targetSlot?: { date: string; time: string };
}

export interface AttemptBookingOutput {
  success: boolean;
  confirmationCode?: string;
  screenshotPath?: string;
  error?: string;
}

export interface UpdateWatchStatusInput {
  watchRequestId: string;
  status: "active" | "paused" | "fulfilled" | "cancelled" | "expired";
}

/* ─── Activity Dependencies ───────────────────────────────────────── */

export interface ReservationActivityDeps {
  /** Base URL for internal API calls */
  appBaseUrl: string;
  /** API token for internal calls */
  apiToken: string;
  logger: Logger;
}

/* ─── Activity Factory ────────────────────────────────────────────── */

export function createReservationActivities(deps: ReservationActivityDeps) {
  const { appBaseUrl, apiToken, logger } = deps;

  async function callInternalApi(
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = `${appBaseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Internal API error: ${response.status} - ${text}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Record a watch event in the audit trail.
   */
  async function recordEventActivity(input: RecordEventInput): Promise<void> {
    const { watchRequestId, source, eventType, payload } = input;
    logger.info({ watchRequestId, source, eventType }, "Recording watch event");
    await callInternalApi("/api/v1/reservations/internal/events", {
      watchRequestId,
      source,
      eventType,
      payload,
    });
  }

  /**
   * Set up platform alert for the watch request.
   * Returns user instructions if manual setup is required.
   */
  async function setupAlertActivity(input: SetupAlertInput): Promise<void> {
    const { watchRequestId, platform } = input;
    logger.info({ watchRequestId, platform }, "Setting up platform alert");

    // Call internal API which delegates to the appropriate provider
    await callInternalApi("/api/v1/reservations/internal/setup-alert", {
      watchRequestId,
      platform,
    });
  }

  /**
   * Notify the user that availability has been detected.
   */
  async function notifyUserActivity(input: NotifyUserInput): Promise<void> {
    const { watchRequestId, userId, alertPayload } = input;
    logger.info(
      { watchRequestId, userId, source: alertPayload.source },
      "Notifying user of availability"
    );

    await callInternalApi("/api/v1/reservations/internal/notify", {
      watchRequestId,
      userId,
      alertPayload,
    });
  }

  /**
   * Attempt booking on behalf of the user.
   * INVARIANT: USER_APPROVAL_GATE — only called after user approval signal.
   * Uses Playwright with stored authenticated session state.
   * INVARIANT: OFFICIAL_CHANNELS_ONLY — navigates official booking pages only.
   */
  async function attemptBookingActivity(
    input: AttemptBookingInput
  ): Promise<AttemptBookingOutput> {
    const { watchRequestId, platform, sessionStatePath, targetSlot } = input;
    logger.info(
      { watchRequestId, platform, hasTargetSlot: !!targetSlot },
      "Attempting booking assist"
    );

    const result = await callInternalApi(
      "/api/v1/reservations/internal/attempt-booking",
      {
        watchRequestId,
        platform,
        sessionStatePath,
        targetSlot,
      }
    );

    return result as unknown as AttemptBookingOutput;
  }

  /**
   * Update watch request status.
   */
  async function updateWatchStatusActivity(
    input: UpdateWatchStatusInput
  ): Promise<void> {
    const { watchRequestId, status } = input;
    logger.info({ watchRequestId, status }, "Updating watch request status");

    await callInternalApi("/api/v1/reservations/internal/update-status", {
      watchRequestId,
      status,
    });
  }

  return {
    setupAlertActivity,
    notifyUserActivity,
    recordEventActivity,
    attemptBookingActivity,
    updateWatchStatusActivity,
  };
}

export type ReservationActivities = ReturnType<
  typeof createReservationActivities
>;
