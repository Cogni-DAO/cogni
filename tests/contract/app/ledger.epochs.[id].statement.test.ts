// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/ledger.epochs.[id].statement`
 * Purpose: Contract test for public ledger epoch statement endpoint.
 * Scope: Validates Zod output schema against representative data shapes. Does not test runtime behavior.
 * Invariants: ALL_MATH_BIGINT, consistent 200 response (statement or null).
 * Side-effects: none
 * Links: contracts/ledger.epoch-statement.v1.contract
 * @public
 */

import { describe, expect, it } from "vitest";
import { epochStatementOperation } from "@/contracts/ledger.epoch-statement.v1.contract";

describe("ledger.epoch-statement.v1 contract", () => {
  it("should validate a well-formed statement response", () => {
    const data = {
      statement: {
        id: "stmt-1",
        epochId: "1",
        allocationSetHash: "abc123",
        poolTotalCredits: "10000",
        payouts: [
          {
            user_id: "user-1",
            total_units: "8000",
            share: "0.800000",
            amount_credits: "8000",
          },
        ],
        supersedesPayoutId: null,
        createdAt: "2026-02-08T00:00:00.000Z",
      },
    };

    expect(() => epochStatementOperation.output.parse(data)).not.toThrow();
  });

  it("should validate null statement (no statement yet)", () => {
    const data = { statement: null };
    const parsed = epochStatementOperation.output.parse(data);
    expect(parsed.statement).toBeNull();
  });

  it("should reject bare null (must be wrapped in object)", () => {
    expect(() => epochStatementOperation.output.parse(null)).toThrow();
  });
});
