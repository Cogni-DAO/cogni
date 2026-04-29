// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/error-report.v1.contract`
 * Purpose: Validates the "Send to Cogni" intake contract — accepts valid payloads, rejects oversize fields and bad timestamps, enforces output shape.
 * Scope: Pure schema tests. Does not exercise the route handler or DB.
 * Invariants: BOUNDED_INTAKE caps every string; output requires uuid trackingId + literal status="received".
 * Side-effects: none
 * Links: contracts/error-report.v1.contract, work/items/task.0423
 * @internal
 */

import {
  ERROR_REPORT_LIMITS,
  ErrorReportInputSchema,
  ErrorReportOutputSchema,
} from "@cogni/node-contracts";
import { describe, expect, it } from "vitest";

describe("error-report.v1.contract", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = ErrorReportInputSchema.parse({
      route: "/dashboard",
      errorName: "TypeError",
      errorMessage: "x is not a function",
    });
    expect(parsed.route).toBe("/dashboard");
    expect(parsed.errorName).toBe("TypeError");
  });

  it("accepts a fully-populated payload", () => {
    const parsed = ErrorReportInputSchema.parse({
      digest: "abc123",
      route: "/dashboard",
      errorName: "TypeError",
      errorMessage: "x is not a function",
      errorStack: "TypeError: x is not a function\n  at foo",
      componentStack: "  at SomeComponent",
      userNote: "I clicked the button",
      clientTs: new Date().toISOString(),
      userAgent: "Mozilla/5.0",
    });
    expect(parsed.digest).toBe("abc123");
    expect(parsed.userNote).toBe("I clicked the button");
  });

  it("rejects an over-sized errorStack", () => {
    const result = ErrorReportInputSchema.safeParse({
      route: "/r",
      errorName: "Error",
      errorMessage: "msg",
      errorStack: "a".repeat(ERROR_REPORT_LIMITS.errorStack + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-sized errorMessage", () => {
    const result = ErrorReportInputSchema.safeParse({
      route: "/r",
      errorName: "Error",
      errorMessage: "a".repeat(ERROR_REPORT_LIMITS.errorMessage + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-sized digest", () => {
    const result = ErrorReportInputSchema.safeParse({
      route: "/r",
      errorName: "Error",
      errorMessage: "msg",
      digest: "a".repeat(ERROR_REPORT_LIMITS.digest + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO clientTs", () => {
    const result = ErrorReportInputSchema.safeParse({
      route: "/r",
      errorName: "Error",
      errorMessage: "msg",
      clientTs: "yesterday",
    });
    expect(result.success).toBe(false);
  });

  it("output schema requires uuid trackingId + literal status", () => {
    const ok = ErrorReportOutputSchema.safeParse({
      trackingId: "00000000-0000-4000-8000-000000000000",
      status: "received",
    });
    expect(ok.success).toBe(true);

    const badStatus = ErrorReportOutputSchema.safeParse({
      trackingId: "00000000-0000-4000-8000-000000000000",
      status: "queued",
    });
    expect(badStatus.success).toBe(false);

    const badId = ErrorReportOutputSchema.safeParse({
      trackingId: "not-a-uuid",
      status: "received",
    });
    expect(badId.success).toBe(false);
  });
});
