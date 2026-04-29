// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/error-reports`
 * Purpose: Error reports table — durable record of "Send to Cogni" UI submissions.
 * Scope: Defines error_reports table. Does not contain queries or business logic.
 * Invariants:
 * - ID_IS_TRACKING_ID: row id is the trackingId returned to the user; uuid v4.
 * - DIGEST_IS_CORRELATION_KEY: digest column joins reports to the original failing log line in Loki.
 * - LOKI_WINDOW_NULLABLE_V0: v0-of-v0 leaves loki_window null; task.0420's Temporal worker fills it.
 * - SYSTEM_OWNED: No RLS — the intake API is anonymous-allowed (so `(public)/error.tsx` can submit), and reads are admin-only via direct queries. Same precedent as poly_copy_trade_* tables.
 * Side-effects: none (schema definitions only)
 * Links: work/items/task.0423.send-to-cogni-error-intake-v0.md, work/items/task.0420.error-intake-temporal-v1.md
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

/**
 * Loki window fetch status. v0-of-v0 only writes 'pending' (the worker
 * doesn't run yet); task.0420 transitions to fetched / empty / failed.
 */
export const ERROR_REPORT_LOKI_STATUSES = [
  "pending",
  "fetched",
  "empty",
  "failed",
] as const;

export type ErrorReportLokiStatus = (typeof ERROR_REPORT_LOKI_STATUSES)[number];

/**
 * Error reports — one row per "Send to Cogni" click in any Cogni UI.
 *
 * Per task.0423 (v0-of-v0): rows are written synchronously by the
 * intake API. `loki_window` and `loki_status` exist now but are filled
 * by task.0420's Temporal worker; v0-of-v0 leaves them null/'pending'.
 *
 * No FK to users — `user_id` is best-effort, populated when an
 * authenticated session was present, null otherwise. The intake route
 * is anonymous-allowed (so `(public)/error.tsx` can submit), so
 * `user_id` cannot be required.
 */
export const errorReports = pgTable(
  "error_reports",
  {
    /** Primary key = trackingId returned to the client. */
    id: uuid("id").primaryKey(),
    /** Receive timestamp on the server. Authoritative. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Which node submitted (e.g. "operator"). */
    node: text("node").notNull(),
    /** Build SHA stamped by the server from APP_BUILD_SHA env. */
    buildSha: text("build_sha"),
    /** Best-effort user id from session; null for anonymous reports. */
    userId: text("user_id"),
    /** Next.js error.digest from the failing render — Loki join key. */
    digest: text("digest"),
    /** Route the error happened on. */
    route: text("route").notNull(),
    /** Error.name, e.g. "TypeError". */
    errorName: text("error_name").notNull(),
    /** Error.message (truncated client-side per ERROR_REPORT_LIMITS). */
    errorMessage: text("error_message").notNull(),
    /** Error.stack (truncated). */
    errorStack: text("error_stack"),
    /** React componentStack where available. */
    componentStack: text("component_stack"),
    /** Optional free-text from the user. */
    userNote: text("user_note"),
    /** navigator.userAgent. */
    userAgent: text("user_agent"),
    /** Client-reported timestamp; diagnostic only (clocks lie). */
    clientTs: timestamp("client_ts", { withTimezone: true }),
    /** Loki window pulled by the worker (v1). v0-of-v0: always null. */
    lokiWindow: jsonb("loki_window").$type<unknown>(),
    /** Status of the loki_window pull. v0-of-v0: always 'pending'. */
    lokiStatus: text("loki_status", { enum: ERROR_REPORT_LOKI_STATUSES })
      .notNull()
      .default("pending"),
  },
  (table) => ({
    /** For "show me recent reports" admin queries. */
    createdAtIdx: index("error_reports_created_at_idx").on(table.createdAt),
    /** For joining a report back to its Loki log via digest. */
    digestIdx: index("error_reports_digest_idx").on(table.digest),
    /** For dashboards filtered by user. */
    userIdIdx: index("error_reports_user_id_idx").on(table.userId),
  })
);
// SYSTEM_OWNED: no .enableRLS() — anonymous intake. Match poly_copy_trade_* precedent.
