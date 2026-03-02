// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/profiles/cogni-v0.0`
 * Purpose: Unit tests for cogni-v0.0 profile — shape validation, PROFILE_IS_DATA invariant.
 * Scope: Tests profile data shape. Does not test I/O.
 * Invariants: PROFILE_IS_DATA, PROFILE_SELECTS_ENRICHERS, PROFILE_SELECTS_ALLOCATOR.
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/profiles/cogni-v0.0.ts
 * @internal
 */

import { validateEnricherOrder } from "@cogni/attribution-pipeline-contracts";
import { describe, expect, it } from "vitest";

import { COGNI_V0_PROFILE } from "../../src/profiles/cogni-v0.0";

describe("cogni-v0.0 profile", () => {
  it("has correct profileId", () => {
    expect(COGNI_V0_PROFILE.profileId).toBe("cogni-v0.0");
  });

  it("selects weight-sum-v0 allocator", () => {
    expect(COGNI_V0_PROFILE.allocatorRef).toBe("weight-sum-v0");
  });

  it("selects echo as the only enricher (no core/plugin split)", () => {
    const refs = COGNI_V0_PROFILE.enricherRefs.map((r) => r.enricherRef);
    expect(refs).toEqual(["cogni.echo.v0"]);
  });

  it("has activity epochKind", () => {
    expect(COGNI_V0_PROFILE.epochKind).toBe("activity");
  });

  it("provides defaultWeightConfig with GitHub event weights", () => {
    expect(COGNI_V0_PROFILE.defaultWeightConfig).toEqual({
      "github:pr_merged": 1000,
      "github:review_submitted": 500,
      "github:issue_closed": 300,
    });
  });

  it("is a plain readonly object (PROFILE_IS_DATA)", () => {
    expect(COGNI_V0_PROFILE.constructor).toBe(Object);
    expect(typeof COGNI_V0_PROFILE.profileId).toBe("string");
    expect(Array.isArray(COGNI_V0_PROFILE.enricherRefs)).toBe(true);
  });

  it("enricher ordering is valid (ENRICHER_ORDER_EXPLICIT)", () => {
    expect(() =>
      validateEnricherOrder(COGNI_V0_PROFILE.enricherRefs)
    ).not.toThrow();
  });
});
