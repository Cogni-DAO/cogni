// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/error-report.v1.contract`
 * Purpose: Defines the "Send to Cogni" error report intake contract — what the UI submits when a user clicks the button on an error boundary.
 * Scope: Zod schemas + types for the POST /api/v1/error-report wire format. Does not contain business logic, persistence, or rate-limit policy.
 * Invariants:
 *   - CONTRACTS_ARE_SOT: this file is the only declaration of the request/response shape.
 *   - BOUNDED_INTAKE: every string field has a hard byte cap to prevent abuse.
 *   - ANONYMOUS_ALLOWED: route is anonymous-allowed so (public)/error.tsx can submit; no auth fields here.
 *   - DIGEST_IS_CORRELATION_KEY: `digest` is the Next.js error.digest, the join key against Loki logs.
 *   - Contract remains stable; breaking changes require new version.
 * Side-effects: none
 * Links: work/items/task.0423.send-to-cogni-error-intake-v0.md, work/items/story.0417.ui-send-to-cogni-error-button.md
 * @public
 */

import { z } from "zod";

/**
 * Hard size caps. Client truncates before send; server enforces too.
 * Numbers chosen to fit a real stack trace without being abusive.
 */
const MAX_ERROR_NAME = 256;
const MAX_ERROR_MESSAGE = 2_000;
const MAX_ERROR_STACK = 20_000;
const MAX_COMPONENT_STACK = 20_000;
const MAX_ROUTE = 512;
const MAX_DIGEST = 256;
const MAX_USER_NOTE = 1_000;
const MAX_USER_AGENT = 512;

export const ErrorReportInputSchema = z.object({
  /** Next.js error.digest from the failing render — the Loki join key. Optional in dev. */
  digest: z.string().max(MAX_DIGEST).optional(),
  /** Route the error happened on, e.g. "/dashboard". */
  route: z.string().max(MAX_ROUTE),
  /** Error.name (e.g. "TypeError"). */
  errorName: z.string().max(MAX_ERROR_NAME),
  /** Error.message — truncated client-side. */
  errorMessage: z.string().max(MAX_ERROR_MESSAGE),
  /** Error.stack — truncated client-side. */
  errorStack: z.string().max(MAX_ERROR_STACK).optional(),
  /** React componentStack (where available). */
  componentStack: z.string().max(MAX_COMPONENT_STACK).optional(),
  /** Optional free text: "what were you doing?". */
  userNote: z.string().max(MAX_USER_NOTE).optional(),
  /** ISO timestamp from the client. Server clock is authoritative; this is for diagnostics only. */
  clientTs: z.string().datetime().optional(),
  /** navigator.userAgent — bounded. */
  userAgent: z.string().max(MAX_USER_AGENT).optional(),
});

export const ErrorReportOutputSchema = z.object({
  /** UUID minted by the server; client shows this so the user can reference it. */
  trackingId: z.string().uuid(),
  /** Always "received" in v0-of-v0 (synchronous insert). v1 will use "queued". */
  status: z.literal("received"),
});

export const errorReportOperation = {
  id: "errors.send-to-cogni.v1",
  summary: "Submit an error report from the UI to Cogni",
  description:
    "Anonymous-allowed POST. Captures error context from a Next.js error boundary, persists it for downstream agent triage, and emits a structured Pino log line so the report shows up in Loki at the deployed SHA. Rate-limited per-IP. v0-of-v0: synchronous insert, no Loki window pull.",
  input: ErrorReportInputSchema,
  output: ErrorReportOutputSchema,
} as const;

export type ErrorReportInput = z.infer<typeof ErrorReportInputSchema>;
export type ErrorReportOutput = z.infer<typeof ErrorReportOutputSchema>;

/**
 * Public byte caps so the client component can truncate using the same numbers
 * that the contract enforces. Imported by `<SendToCogniButton />`.
 */
export const ERROR_REPORT_LIMITS = {
  errorName: MAX_ERROR_NAME,
  errorMessage: MAX_ERROR_MESSAGE,
  errorStack: MAX_ERROR_STACK,
  componentStack: MAX_COMPONENT_STACK,
  route: MAX_ROUTE,
  digest: MAX_DIGEST,
  userNote: MAX_USER_NOTE,
  userAgent: MAX_USER_AGENT,
} as const;
