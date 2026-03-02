// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/core-evaluations`
 * Purpose: Unit tests for mandatory core evaluation helpers.
 * Scope: Tests pure constants and helper composition. Does not test I/O.
 * Invariants: CLAIMANT_SHARES_CORE_EVALUATION, FRAMEWORK_NO_IO.
 * Side-effects: none
 * Links: packages/attribution-pipeline-contracts/src/core-evaluations.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  CLAIMANT_SHARES_CORE_DESCRIPTOR,
  CLAIMANT_SHARES_SCHEMA_REF,
  CORE_EVALUATION_REFS,
  getEffectiveEnricherRefs,
} from "../src/core-evaluations";

describe("core evaluations", () => {
  it("declares claimant-shares as a mandatory core descriptor", () => {
    expect(CLAIMANT_SHARES_CORE_DESCRIPTOR).toEqual({
      evaluationRef: "cogni.claimant_shares.v0",
      algoRef: "claimant-shares-v0",
      schemaRef: CLAIMANT_SHARES_SCHEMA_REF,
    });
  });

  it("prepends core evaluations ahead of plugin enrichers", () => {
    const effective = getEffectiveEnricherRefs({
      pluginEnricherRefs: [{ evaluationRef: "cogni.echo.v0", dependsOn: [] }],
    });

    expect(effective).toEqual([
      ...CORE_EVALUATION_REFS,
      { evaluationRef: "cogni.echo.v0", dependsOn: [] },
    ]);
  });

  it("returns a fresh array without mutating the core constant", () => {
    const effective = getEffectiveEnricherRefs({ pluginEnricherRefs: [] });

    expect(effective).toEqual(CORE_EVALUATION_REFS);
    expect(effective).not.toBe(CORE_EVALUATION_REFS);
  });
});
