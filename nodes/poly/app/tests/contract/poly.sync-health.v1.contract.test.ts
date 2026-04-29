// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/poly.sync-health.v1.contract`
 * Purpose: Validates Zod schema for the sync-health response shape.
 * Scope: Pure Zod schema validation. No DB, no HTTP transport.
 * Invariants: SYNC_HEALTH_IS_PUBLIC — stable shape; all four fields present. Field renamed oldest_synced_row_age_ms (task.0328 rev1).
 * Side-effects: none
 * Links: nodes/poly/packages/node-contracts/src/poly.sync-health.v1.contract.ts (task.0328 CP4)
 * @internal
 */

import { PolySyncHealthResponseSchema } from "@cogni/poly-node-contracts";
import { describe, expect, it } from "vitest";

describe("PolySyncHealthResponseSchema", () => {
  it("parses a valid response with all fields populated", () => {
    const input = {
      oldest_synced_row_age_ms: 12345,
      rows_stale_over_60s: 3,
      rows_never_synced: 7,
      reconciler_last_tick_at: "2025-04-18T10:00:00.000Z",
    };
    const result = PolySyncHealthResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(input);
    }
  });

  it("parses a response with nullable fields set to null", () => {
    const input = {
      oldest_synced_row_age_ms: null,
      rows_stale_over_60s: 0,
      rows_never_synced: 0,
      reconciler_last_tick_at: null,
    };
    const result = PolySyncHealthResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects negative oldest_synced_row_age_ms", () => {
    const input = {
      oldest_synced_row_age_ms: -1,
      rows_stale_over_60s: 0,
      rows_never_synced: 0,
      reconciler_last_tick_at: null,
    };
    expect(PolySyncHealthResponseSchema.safeParse(input).success).toBe(false);
  });

  it("rejects non-integer rows_stale_over_60s", () => {
    const input = {
      oldest_synced_row_age_ms: null,
      rows_stale_over_60s: 1.5,
      rows_never_synced: 0,
      reconciler_last_tick_at: null,
    };
    expect(PolySyncHealthResponseSchema.safeParse(input).success).toBe(false);
  });

  it("rejects non-datetime string for reconciler_last_tick_at", () => {
    const input = {
      oldest_synced_row_age_ms: null,
      rows_stale_over_60s: 0,
      rows_never_synced: 0,
      reconciler_last_tick_at: "not-a-datetime",
    };
    expect(PolySyncHealthResponseSchema.safeParse(input).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(PolySyncHealthResponseSchema.safeParse({}).success).toBe(false);
  });
});
