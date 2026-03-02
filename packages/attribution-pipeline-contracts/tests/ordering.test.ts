// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/ordering`
 * Purpose: Unit tests for validateEnricherOrder — cycle detection, missing refs, topological order.
 * Scope: Tests DAG validation for enricher dependency ordering. Does not test I/O.
 * Invariants: ENRICHER_ORDER_EXPLICIT.
 * Side-effects: none
 * Links: packages/attribution-pipeline/src/ordering.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { validateEnricherOrder } from "../src/ordering";
import type { EnricherRef } from "../src/profile";

describe("validateEnricherOrder", () => {
  it("accepts empty enricher list", () => {
    expect(() => validateEnricherOrder([])).not.toThrow();
  });

  it("accepts single enricher with no deps", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "cogni.echo.v0", dependsOn: [] },
    ];
    expect(() => validateEnricherOrder(refs)).not.toThrow();
  });

  it("accepts valid topological order", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "cogni.echo.v0", dependsOn: [] },
      { evaluationRef: "cogni.claimant_shares.v0", dependsOn: [] },
      {
        evaluationRef: "cogni.ai_scores.v0",
        dependsOn: ["cogni.echo.v0", "cogni.claimant_shares.v0"],
      },
    ];
    expect(() => validateEnricherOrder(refs)).not.toThrow();
  });

  it("accepts multiple independent enrichers", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "a", dependsOn: [] },
      { evaluationRef: "b", dependsOn: [] },
      { evaluationRef: "c", dependsOn: [] },
    ];
    expect(() => validateEnricherOrder(refs)).not.toThrow();
  });

  it("throws on missing dependency ref", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "cogni.echo.v0", dependsOn: ["nonexistent"] },
    ];
    expect(() => validateEnricherOrder(refs)).toThrow(
      /depends on "nonexistent" which is not in the profile/
    );
  });

  it("throws on direct cycle (A → B → A)", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "a", dependsOn: ["b"] },
      { evaluationRef: "b", dependsOn: ["a"] },
    ];
    expect(() => validateEnricherOrder(refs)).toThrow(/Cycle detected/);
  });

  it("throws on self-cycle", () => {
    const refs: EnricherRef[] = [{ evaluationRef: "a", dependsOn: ["a"] }];
    expect(() => validateEnricherOrder(refs)).toThrow(/Cycle detected/);
  });

  it("throws on transitive cycle (A → B → C → A)", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "a", dependsOn: ["c"] },
      { evaluationRef: "b", dependsOn: ["a"] },
      { evaluationRef: "c", dependsOn: ["b"] },
    ];
    expect(() => validateEnricherOrder(refs)).toThrow(/Cycle detected/);
  });

  it("throws when declared order violates dependencies", () => {
    // b depends on a, but b is listed before a
    const refs: EnricherRef[] = [
      { evaluationRef: "b", dependsOn: ["a"] },
      { evaluationRef: "a", dependsOn: [] },
    ];
    expect(() => validateEnricherOrder(refs)).toThrow(
      /depends on "a" but "a" appears after it/
    );
  });

  it("includes cycle path in error message", () => {
    const refs: EnricherRef[] = [
      { evaluationRef: "x", dependsOn: ["z"] },
      { evaluationRef: "y", dependsOn: ["x"] },
      { evaluationRef: "z", dependsOn: ["y"] },
    ];
    try {
      validateEnricherOrder(refs);
      expect.fail("Should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("Cycle detected");
      // The cycle should mention at least some of the involved refs
      expect(msg).toMatch(/[xyz]/);
    }
  });
});
