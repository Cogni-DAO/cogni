// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/reservations.ingest.v1.contract`
 * Purpose: Operation contract for ingesting availability notifications.
 * Scope: Zod schemas for receiving alerts from email forwarding, webhooks, or manual input.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - Ingestion creates watch_event records for audit trail
 * Side-effects: none
 * Links: task.0166, /api/v1/reservations/ingest route
 * @internal
 */

import { z } from "zod";

export const IngestAlertInputSchema = z.object({
  /** Watch request ID this alert is for */
  watchRequestId: z.string().uuid(),
  /** Source of the notification */
  source: z.enum(["resy", "opentable", "email", "webhook", "manual"]),
  /** Raw notification payload (email body, webhook data, etc.) */
  payload: z.record(z.string(), z.unknown()),
});

export const IngestAlertOutputSchema = z.object({
  eventId: z.string().uuid(),
  watchRequestId: z.string().uuid(),
  eventType: z.string(),
});

export const ingestAlertOperation = {
  id: "reservations.ingest.v1",
  summary: "Ingest an availability notification",
  description:
    "Receives an availability notification from email forwarding, webhook callback, or manual input. Creates a watch_event and triggers the notification workflow.",
  input: IngestAlertInputSchema,
  output: IngestAlertOutputSchema,
} as const;

export type IngestAlertInput = z.infer<typeof IngestAlertInputSchema>;
export type IngestAlertOutput = z.infer<typeof IngestAlertOutputSchema>;
