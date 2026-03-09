// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/plugins/weight-sum/descriptor`
 * Purpose: Unit tests for weight-sum allocator descriptor — delegation to computeReceiptWeights.
 * Scope: Tests allocator descriptor delegation. Does not test the allocation algorithm itself.
 * Invariants: ALLOCATOR_NEEDS_DECLARED, ALLOCATION_ALGO_VERSIONED.
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/plugins/weight-sum/descriptor.ts
 * @internal
 */

import type { ReceiptForWeighting } from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

import {
  WEIGHT_SUM_ALGO_REF,
  WEIGHT_SUM_ALLOCATOR,
  WeightSumOutputSchema,
} from "../../../src/plugins/weight-sum/descriptor";

describe("weight-sum allocator descriptor", () => {
  it("has correct algoRef", () => {
    expect(WEIGHT_SUM_ALLOCATOR.algoRef).toBe("weight-sum-v0");
    expect(WEIGHT_SUM_ALGO_REF).toBe("weight-sum-v0");
  });

  it("requires echo evaluation", () => {
    expect(WEIGHT_SUM_ALLOCATOR.requiredEvaluationRefs).toContain(
      "cogni.echo.v0"
    );
  });

  it("exports the runtime output schema", () => {
    expect(WEIGHT_SUM_ALLOCATOR.outputSchema).toBe(WeightSumOutputSchema);
  });

  it("delegates to computeReceiptWeights and returns per-receipt results", async () => {
    const receipts: ReceiptForWeighting[] = [
      {
        receiptId: "r1",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
      {
        receiptId: "r2",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
    ];

    const weightConfig = { "github:pull_request": 1000 };

    const result = await WEIGHT_SUM_ALLOCATOR.compute({
      receipts,
      weightConfig,
      evaluations: new Map(),
      profileConfig: null,
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.receiptId).sort()).toEqual(["r1", "r2"]);
    for (const weight of result) {
      expect(weight.units).toBe(1000n);
    }
  });

  it("filters excluded receipts", async () => {
    const receipts: ReceiptForWeighting[] = [
      {
        receiptId: "r1",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
      {
        receiptId: "r2",
        source: "github",
        eventType: "pull_request",
        included: false,
        weightOverrideMilli: null,
      },
    ];

    const result = await WEIGHT_SUM_ALLOCATOR.compute({
      receipts,
      weightConfig: { "github:pull_request": 1000 },
      evaluations: new Map(),
      profileConfig: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.receiptId).toBe("r1");
  });

  it("output schema accepts valid allocator results", () => {
    expect(() =>
      WeightSumOutputSchema.parse([{ receiptId: "r1", units: 1000n }])
    ).not.toThrow();
  });
});
