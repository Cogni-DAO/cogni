// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/plugins/weight-sum/descriptor`
 * Purpose: Unit tests for weight-sum allocator descriptor — delegation to computeProposedAllocations.
 * Scope: Tests allocator descriptor delegation. Does not test the allocation algorithm itself.
 * Invariants: ALLOCATOR_NEEDS_DECLARED, ALLOCATION_ALGO_VERSIONED.
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/plugins/weight-sum/descriptor.ts
 * @internal
 */

import type { SelectedReceiptForAllocation } from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

import {
  WEIGHT_SUM_ALGO_REF,
  WEIGHT_SUM_ALLOCATOR,
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

  it("delegates to computeProposedAllocations and returns results", async () => {
    const events: SelectedReceiptForAllocation[] = [
      {
        receiptId: "r1",
        userId: "user-1",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
      {
        receiptId: "r2",
        userId: "user-2",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
    ];

    const weightConfig = { "github:pull_request": 1000 };

    const result = await WEIGHT_SUM_ALLOCATOR.compute({
      events,
      weightConfig,
      evaluations: new Map(),
      profileConfig: null,
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.userId).sort()).toEqual(["user-1", "user-2"]);
    for (const alloc of result) {
      expect(alloc.proposedUnits).toBe(1000n);
      expect(alloc.activityCount).toBe(1);
    }
  });

  it("filters excluded events", async () => {
    const events: SelectedReceiptForAllocation[] = [
      {
        receiptId: "r1",
        userId: "user-1",
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
      },
      {
        receiptId: "r2",
        userId: "user-2",
        source: "github",
        eventType: "pull_request",
        included: false,
        weightOverrideMilli: null,
      },
    ];

    const result = await WEIGHT_SUM_ALLOCATOR.compute({
      events,
      weightConfig: { "github:pull_request": 1000 },
      evaluations: new Map(),
      profileConfig: null,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe("user-1");
  });
});
