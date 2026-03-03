// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/registry`
 * Purpose: Unit tests for default registry construction.
 * Scope: Tests pure registry assembly. Does not test I/O.
 * Invariants: ENRICHER_ORDER_EXPLICIT, FRAMEWORK_STABLE_PLUGINS_CHURN.
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/registry.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import { ECHO_EVALUATION_REF } from "../src/plugins/echo/descriptor";
import { WEIGHT_SUM_ALGO_REF } from "../src/plugins/weight-sum/descriptor";
import { COGNI_V0_PROFILE } from "../src/profiles/cogni-v0.0";
import { createDefaultRegistries } from "../src/registry";

describe("createDefaultRegistries", () => {
  it("registers the built-in profile, enricher, and allocator", () => {
    const registries = createDefaultRegistries();

    expect(registries.profiles.get(COGNI_V0_PROFILE.profileId)).toBe(
      COGNI_V0_PROFILE
    );
    expect(
      registries.enrichers.get(ECHO_EVALUATION_REF)?.descriptor.evaluationRef
    ).toBe(ECHO_EVALUATION_REF);
    expect(
      registries.enrichers.get(ECHO_EVALUATION_REF)?.descriptor.outputSchema
    ).toBeDefined();
    expect(registries.allocators.get(WEIGHT_SUM_ALGO_REF)?.algoRef).toBe(
      WEIGHT_SUM_ALGO_REF
    );
    expect(
      registries.allocators.get(WEIGHT_SUM_ALGO_REF)?.outputSchema
    ).toBeDefined();
  });

  it("returns fresh registry maps on each call", () => {
    const a = createDefaultRegistries();
    const b = createDefaultRegistries();

    expect(a.profiles).not.toBe(b.profiles);
    expect(a.enrichers).not.toBe(b.enrichers);
    expect(a.allocators).not.toBe(b.allocators);
  });
});
