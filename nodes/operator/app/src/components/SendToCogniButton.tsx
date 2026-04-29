// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/SendToCogniButton`
 * Purpose: Standard "Send to Cogni" UI affordance for error surfaces —
 *   captures the failing error's context (name, message, stack, digest,
 *   route) and POSTs it to /api/v1/error-report.
 * Scope: Client component. Renders a button + status text. Does not
 *   handle re-tries, retries-on-failure, or rate-limit UX beyond a
 *   simple inline error message.
 * Invariants:
 *   - DIGEST_FORWARDED_VERBATIM: passes Next's error.digest through as
 *     the Loki join key.
 *   - CLIENT_TRUNCATES_BEFORE_SEND: enforces ERROR_REPORT_LIMITS so
 *     huge stacks never even leave the browser.
 *   - SINGLE_SUBMIT: button disables after first successful submit so
 *     a user double-click is a no-op.
 * Side-effects: IO (fetch POST + DOM updates).
 * Links: contracts/error-report.v1.contract, work/items/task.0423
 * @public
 */

"use client";

import {
  ERROR_REPORT_LIMITS,
  type ErrorReportInput,
} from "@cogni/node-contracts";
import { useState } from "react";

interface SendToCogniButtonProps {
  /** The error from the Next.js error boundary. */
  readonly error: Error & { digest?: string };
  /** Route the error happened on, e.g. "/dashboard". */
  readonly route: string;
  /** Optional componentStack from a React error boundary. */
  readonly componentStack?: string;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  return value.length <= max ? value : value.slice(0, max);
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; trackingId: string }
  | { kind: "error"; message: string };

export function SendToCogniButton({
  error,
  route,
  componentStack,
}: SendToCogniButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [userNote, setUserNote] = useState("");

  const submit = async () => {
    setStatus({ kind: "submitting" });

    const payload: ErrorReportInput = {
      digest: truncate(error.digest, ERROR_REPORT_LIMITS.digest),
      route: truncate(route, ERROR_REPORT_LIMITS.route) ?? "/",
      errorName: truncate(
        error.name || "Error",
        ERROR_REPORT_LIMITS.errorName
      )!,
      errorMessage: truncate(
        error.message || "(no message)",
        ERROR_REPORT_LIMITS.errorMessage
      )!,
      errorStack: truncate(error.stack, ERROR_REPORT_LIMITS.errorStack),
      componentStack: truncate(
        componentStack,
        ERROR_REPORT_LIMITS.componentStack
      ),
      userNote: userNote
        ? truncate(userNote, ERROR_REPORT_LIMITS.userNote)
        : undefined,
      clientTs: new Date().toISOString(),
      userAgent: truncate(
        typeof navigator === "undefined" ? undefined : navigator.userAgent,
        ERROR_REPORT_LIMITS.userAgent
      ),
    };

    try {
      const res = await fetch("/api/v1/error-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: `Submit failed (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as { trackingId: string };
      setStatus({ kind: "sent", trackingId: data.trackingId });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error",
      });
    }
  };

  if (status.kind === "sent") {
    return (
      <p className="font-mono text-muted-foreground text-xs">
        Sent to Cogni · trackingId: {status.trackingId}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={userNote}
        onChange={(e) => setUserNote(e.target.value)}
        placeholder="Optional: what were you doing?"
        rows={2}
        maxLength={ERROR_REPORT_LIMITS.userNote}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        disabled={status.kind === "submitting"}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={status.kind === "submitting"}
          className="inline-flex w-fit items-center rounded-md border border-border bg-primary px-3 py-1.5 text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
        >
          {status.kind === "submitting" ? "Sending…" : "Send to Cogni"}
        </button>
        {status.kind === "error" ? (
          <span className="text-destructive text-xs">{status.message}</span>
        ) : null}
      </div>
    </div>
  );
}
