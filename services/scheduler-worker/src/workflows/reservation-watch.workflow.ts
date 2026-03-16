// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/reservation-watch`
 * Purpose: Temporal Workflow for reservation watch request lifecycle.
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 * - Per TEMPORAL_DETERMINISM: No I/O, network calls in workflow code
 * - USER_APPROVAL_GATE: Booking assist only after explicit approval signal
 * - OFFICIAL_CHANNELS_ONLY: All platform interactions through official channels
 * - AUDIT_TRAIL: Every state change recorded via activities
 * Side-effects: none (deterministic orchestration only)
 * Links: task.0166, docs/spec/temporal-patterns.md
 * @internal
 */

import {
  ApplicationFailure,
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import type { ReservationActivities } from "../activities/reservation.js";
import { STANDARD_ACTIVITY_OPTIONS } from "./activity-profiles.js";

/* ─── Signals ─────────────────────────────────────────────────────── */

/** Signal: availability alert received from external source */
export const alertReceivedSignal = defineSignal<[AlertPayload]>(
  "reservation.alertReceived"
);

/** Signal: user approves booking assistance */
export const userApprovedSignal = defineSignal<[BookingApprovalPayload]>(
  "reservation.userApproved"
);

/** Signal: user declines booking assistance */
export const userDeclinedSignal = defineSignal("reservation.userDeclined");

/** Signal: user cancels the watch */
export const cancelWatchSignal = defineSignal("reservation.cancelWatch");

/* ─── Types ───────────────────────────────────────────────────────── */

export interface ReservationWatchWorkflowInput {
  watchRequestId: string;
  userId: string;
  platform: string;
  venue: string;
}

export interface AlertPayload {
  source: string;
  payload: Record<string, unknown>;
}

export interface BookingApprovalPayload {
  sessionStatePath: string;
  targetSlot?: { date: string; time: string };
}

/* ─── Workflow ────────────────────────────────────────────────────── */

const {
  setupAlertActivity,
  notifyUserActivity,
  recordEventActivity,
  attemptBookingActivity,
  updateWatchStatusActivity,
} = proxyActivities<ReservationActivities>(STANDARD_ACTIVITY_OPTIONS);

/**
 * ReservationWatchWorkflow — monitors a restaurant watch request.
 *
 * Flow:
 * 1. Setup platform alert (or return manual instructions)
 * 2. Wait for alert signal OR cancellation
 * 3. On alert: notify user, wait for approval/decline
 * 4. On approval: launch booking assist
 * 5. On completion/cancellation: finalize
 */
export async function ReservationWatchWorkflow(
  input: ReservationWatchWorkflowInput
): Promise<void> {
  const { watchRequestId, userId, platform, venue } = input;

  if (!watchRequestId || !userId) {
    throw ApplicationFailure.nonRetryable("Missing required fields");
  }

  // State
  let cancelled = false;
  let alertPayload: AlertPayload | null = null;
  let approvalPayload: BookingApprovalPayload | null = null;
  let declined = false;

  // Register signal handlers
  setHandler(alertReceivedSignal, (payload: AlertPayload) => {
    alertPayload = payload;
  });
  setHandler(userApprovedSignal, (payload: BookingApprovalPayload) => {
    approvalPayload = payload;
  });
  setHandler(userDeclinedSignal, () => {
    declined = true;
  });
  setHandler(cancelWatchSignal, () => {
    cancelled = true;
  });

  // 1. Setup platform alert
  await recordEventActivity({
    watchRequestId,
    source: "system",
    eventType: "created",
    payload: { platform, venue },
  });

  await setupAlertActivity({ watchRequestId, platform });

  // 2. Wait for alert signal or cancellation (up to 30 days)
  const gotAlert = await condition(
    () => alertPayload !== null || cancelled,
    "30 days"
  );

  if (cancelled || !gotAlert) {
    await updateWatchStatusActivity({
      watchRequestId,
      status: cancelled ? "cancelled" : "expired",
    });
    await recordEventActivity({
      watchRequestId,
      source: "system",
      eventType: cancelled ? "cancelled" : "expired",
    });
    return;
  }

  // 3. Record alert and notify user
  await recordEventActivity({
    watchRequestId,
    source: alertPayload!.source as
      | "system"
      | "resy"
      | "opentable"
      | "email"
      | "webhook"
      | "manual",
    eventType: "alert_received",
    payload: alertPayload!.payload,
  });

  await notifyUserActivity({
    watchRequestId,
    userId,
    alertPayload: alertPayload!,
  });

  await recordEventActivity({
    watchRequestId,
    source: "system",
    eventType: "user_notified",
  });

  // 4. Wait for user approval or decline (up to 1 hour)
  const gotDecision = await condition(
    () => approvalPayload !== null || declined || cancelled,
    "1 hour"
  );

  if (!gotDecision || declined || cancelled) {
    await recordEventActivity({
      watchRequestId,
      source: "system",
      eventType: declined
        ? "user_declined"
        : cancelled
          ? "cancelled"
          : "expired",
    });
    return;
  }

  // 5. USER_APPROVAL_GATE: Booking assist only after explicit approval
  await recordEventActivity({
    watchRequestId,
    source: "system",
    eventType: "user_approved",
  });

  await recordEventActivity({
    watchRequestId,
    source: "system",
    eventType: "booking_started",
  });

  const bookingResult = await attemptBookingActivity({
    watchRequestId,
    platform,
    sessionStatePath: approvalPayload!.sessionStatePath,
    targetSlot: approvalPayload!.targetSlot,
  });

  if (bookingResult.success) {
    await recordEventActivity({
      watchRequestId,
      source: "system",
      eventType: "booking_succeeded",
      payload: {
        confirmationCode: bookingResult.confirmationCode,
        screenshotPath: bookingResult.screenshotPath,
      },
    });
    await updateWatchStatusActivity({
      watchRequestId,
      status: "fulfilled",
    });
  } else {
    await recordEventActivity({
      watchRequestId,
      source: "system",
      eventType: "booking_failed",
      payload: { error: bookingResult.error },
    });
  }
}
