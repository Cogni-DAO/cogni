// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/profile`
 * Purpose: Unit tests for resolveProfile and PipelineProfile type contracts.
 * Scope: Tests profile resolution, error messages, PROFILE_IS_DATA invariant. Does not test I/O.
 * Invariants: PROFILE_IS_DATA, PROFILE_SELECTS_ENRICHERS, PROFILE_SELECTS_ALLOCATOR.
 * Side-effects: none
 * Links: packages/attribution-pipeline/src/profile.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import type { PipelineProfile } from "../src/profile";
import { resolveProfile } from "../src/profile";

const testProfile: PipelineProfile = {
  profileId: "test-v0.0",
  label: "Test Profile",
  enricherRefs: [{ enricherRef: "test.echo.v0", dependsOnEvaluations: [] }],
  allocatorRef: "weight-sum-v0",
  epochKind: "activity",
};

function makeRegistry(
  ...profiles: PipelineProfile[]
): ReadonlyMap<string, PipelineProfile> {
  return new Map(profiles.map((p) => [p.profileId, p]));
}

describe("resolveProfile", () => {
  it("returns the profile for a valid key", () => {
    const registry = makeRegistry(testProfile);
    const result = resolveProfile(registry, "test-v0.0");
    expect(result).toBe(testProfile);
  });

  it("throws for unknown attribution_pipeline", () => {
    const registry = makeRegistry(testProfile);
    expect(() => resolveProfile(registry, "unknown-v0.0")).toThrow(
      /Unknown attribution_pipeline: "unknown-v0.0"/
    );
  });

  it("lists available profiles in error message", () => {
    const profile2: PipelineProfile = {
      ...testProfile,
      profileId: "other-v0.0",
      label: "Other",
    };
    const registry = makeRegistry(testProfile, profile2);
    expect(() => resolveProfile(registry, "nope")).toThrow(
      /Available profiles: \[test-v0\.0, other-v0\.0\]/
    );
  });

  it("profiles are plain readonly data (PROFILE_IS_DATA)", () => {
    // Verify the profile is a plain object, not a class instance
    expect(testProfile.constructor).toBe(Object);
    expect(typeof testProfile.profileId).toBe("string");
    expect(Array.isArray(testProfile.enricherRefs)).toBe(true);
  });
});
