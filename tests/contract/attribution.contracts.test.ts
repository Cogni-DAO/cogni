// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/attribution.contracts`
 * Purpose: Validates ledger Zod schemas parse and reject correctly at the contract boundary.
 * Scope: Tests Zod schema compliance for ledger write contracts. Does not test API endpoint behavior.
 * Invariants: ALL_MATH_BIGINT — bigint input strings are parsed to bigint at the contract boundary.
 * Side-effects: none
 * Links: @/contracts/attribution.update-allocations.v1.contract, @/contracts/attribution.record-pool-component.v1.contract
 * @internal
 */

import { describe, expect, it } from "vitest";
import { PoolComponentInputSchema } from "@/contracts/attribution.record-pool-component.v1.contract";
import { UpdateAllocationInputSchema } from "@/contracts/attribution.update-allocations.v1.contract";

describe("ledger.update-allocations.v1 contract", () => {
  const validPayload = {
    adjustments: [
      { userId: "user-1", finalUnits: "5000", overrideReason: "manual" },
      { userId: "user-2", finalUnits: "3000" },
    ],
  };

  it("parses valid finalUnits strings into bigint", () => {
    const result = UpdateAllocationInputSchema.parse(validPayload);
    expect(result.adjustments[0].finalUnits).toBe(5000n);
    expect(result.adjustments[1].finalUnits).toBe(3000n);
  });

  it("parses negative values", () => {
    const result = UpdateAllocationInputSchema.parse({
      adjustments: [{ userId: "u", finalUnits: "-100" }],
    });
    expect(result.adjustments[0].finalUnits).toBe(-100n);
  });

  it("parses zero", () => {
    const result = UpdateAllocationInputSchema.parse({
      adjustments: [{ userId: "u", finalUnits: "0" }],
    });
    expect(result.adjustments[0].finalUnits).toBe(0n);
  });

  it("rejects non-numeric string", () => {
    expect(() =>
      UpdateAllocationInputSchema.parse({
        adjustments: [{ userId: "u", finalUnits: "abc" }],
      })
    ).toThrow(/valid integer/i);
  });

  it("rejects floating point string", () => {
    expect(() =>
      UpdateAllocationInputSchema.parse({
        adjustments: [{ userId: "u", finalUnits: "10.5" }],
      })
    ).toThrow(/valid integer/i);
  });

  it("rejects empty string", () => {
    expect(() =>
      UpdateAllocationInputSchema.parse({
        adjustments: [{ userId: "u", finalUnits: "" }],
      })
    ).toThrow(/valid integer/i);
  });

  it("rejects number type (must be string)", () => {
    expect(() =>
      UpdateAllocationInputSchema.parse({
        adjustments: [{ userId: "u", finalUnits: 5000 }],
      })
    ).toThrow();
  });
});

describe("ledger.record-pool-component.v1 contract", () => {
  const validPayload = {
    componentId: "base_issuance",
    algorithmVersion: "config-constant-v0",
    inputsJson: { baseIssuanceCredits: "10000" },
    amountCredits: "10000",
  };

  it("parses valid amountCredits string into bigint", () => {
    const result = PoolComponentInputSchema.parse(validPayload);
    expect(result.amountCredits).toBe(10000n);
  });

  it("rejects non-numeric amountCredits", () => {
    expect(() =>
      PoolComponentInputSchema.parse({ ...validPayload, amountCredits: "abc" })
    ).toThrow(/valid integer/i);
  });

  it("rejects floating point amountCredits", () => {
    expect(() =>
      PoolComponentInputSchema.parse({
        ...validPayload,
        amountCredits: "100.50",
      })
    ).toThrow(/valid integer/i);
  });
});
