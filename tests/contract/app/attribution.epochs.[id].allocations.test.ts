// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/attribution.epochs.[id].allocations`
 * Purpose: Contract test for public ledger epoch allocations endpoint.
 * Scope: Validates Zod output schema against representative data shapes. Does not test runtime behavior.
 * Invariants: ALL_MATH_BIGINT, PUBLIC_READS_CLOSED_ONLY.
 * Side-effects: none
 * Links: contracts/attribution.epoch-allocations.v1.contract
 * @public
 */

import { describe, expect, it } from "vitest";
import { epochAllocationsOperation } from "@/contracts/attribution.epoch-allocations.v1.contract";

describe("ledger.epoch-allocations.v1 contract", () => {
  it("should validate a well-formed allocations response", () => {
    const data = {
      allocations: [
        {
          id: "alloc-1",
          userId: "user-uuid",
          proposedUnits: "8000",
          finalUnits: "7500",
          overrideReason: "Adjusted for quality",
          activityCount: 12,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-02T00:00:00.000Z",
        },
      ],
      epochId: "1",
    };

    expect(() => epochAllocationsOperation.output.parse(data)).not.toThrow();
  });

  it("should allow nullable finalUnits and overrideReason", () => {
    const data = {
      allocations: [
        {
          id: "alloc-2",
          userId: "user-uuid",
          proposedUnits: "5000",
          finalUnits: null,
          overrideReason: null,
          activityCount: 3,
          createdAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      epochId: "2",
    };

    const parsed = epochAllocationsOperation.output.parse(data);
    expect(parsed.allocations[0].finalUnits).toBeNull();
  });
});
