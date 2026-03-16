// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/allocator`
 * Purpose: Unit tests for dispatchAllocator — registry lookup, dependency validation, context passing.
 * Scope: Tests allocator dispatch logic. Does not test I/O.
 * Invariants: ALLOCATOR_NEEDS_DECLARED, PROFILE_SELECTS_ALLOCATOR.
 * Side-effects: none
 * Links: packages/attribution-pipeline/src/allocator.ts
 * @internal
 */

import type { ReceiptUnitWeight } from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AllocationContext, AllocatorDescriptor } from "../src/allocator";
import { dispatchAllocator } from "../src/allocator";

const mockResult: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 1000n }];
const outputSchema = z.array(
  z.object({
    receiptId: z.string(),
    units: z.bigint(),
  })
);

const mockAllocator: AllocatorDescriptor = {
  algoRef: "test-algo-v0",
  requiredEvaluationRefs: [],
  outputSchema,
  compute: async () => mockResult,
};

function makeContext(
  overrides?: Partial<AllocationContext>
): AllocationContext {
  return {
    receipts: [],
    weightConfig: {},
    evaluations: new Map(),
    profileConfig: null,
    ...overrides,
  };
}

describe("dispatchAllocator", () => {
  it("dispatches to the correct allocator and returns results", async () => {
    const registry = new Map([["test-algo-v0", mockAllocator]]);
    const result = await dispatchAllocator(
      registry,
      "test-algo-v0",
      makeContext()
    );
    expect(result).toEqual(mockResult);
  });

  it("throws for unknown allocator", async () => {
    const registry = new Map<string, AllocatorDescriptor>();
    await expect(
      dispatchAllocator(registry, "test-algo-v0", makeContext())
    ).rejects.toThrow(/Unknown allocator: "test-algo-v0"/);
  });

  it("throws when required evaluations are missing (ALLOCATOR_NEEDS_DECLARED)", async () => {
    const allocatorWithDeps: AllocatorDescriptor = {
      algoRef: "test-algo-v0",
      requiredEvaluationRefs: ["cogni.echo.v0", "cogni.claimant_shares.v0"],
      outputSchema,
      compute: async () => [],
    };
    const registry = new Map([["test-algo-v0", allocatorWithDeps]]);

    await expect(
      dispatchAllocator(registry, "test-algo-v0", makeContext())
    ).rejects.toThrow(
      /requires evaluations \[cogni\.echo\.v0, cogni\.claimant_shares\.v0\]/
    );
  });

  it("passes when all required evaluations are present", async () => {
    const allocatorWithDeps: AllocatorDescriptor = {
      algoRef: "test-algo-v0",
      requiredEvaluationRefs: ["cogni.echo.v0"],
      outputSchema,
      compute: async () => mockResult,
    };
    const registry = new Map([["test-algo-v0", allocatorWithDeps]]);
    const evaluations = new Map([["cogni.echo.v0", { totalEvents: 5 }]]);

    const result = await dispatchAllocator(
      registry,
      "test-algo-v0",
      makeContext({ evaluations })
    );
    expect(result).toEqual(mockResult);
  });

  it("passes context to compute function", async () => {
    let capturedContext: AllocationContext | null = null;
    const capturingAllocator: AllocatorDescriptor = {
      algoRef: "test-algo-v0",
      requiredEvaluationRefs: [],
      outputSchema,
      compute: async (ctx) => {
        capturedContext = ctx;
        return [];
      },
    };
    const registry = new Map([["test-algo-v0", capturingAllocator]]);
    const ctx = makeContext({ profileConfig: { key: "value" } });

    await dispatchAllocator(registry, "test-algo-v0", ctx);
    expect(capturedContext).toBe(ctx);
  });

  it("throws when allocator output does not match outputSchema", async () => {
    const invalidAllocator: AllocatorDescriptor = {
      algoRef: "test-algo-v0",
      requiredEvaluationRefs: [],
      outputSchema,
      compute: async () => [
        { receiptId: "r1", units: "1000" as unknown as bigint },
      ],
    };

    await expect(
      dispatchAllocator(
        new Map([["test-algo-v0", invalidAllocator]]),
        "test-algo-v0",
        makeContext()
      )
    ).rejects.toThrow();
  });
});
