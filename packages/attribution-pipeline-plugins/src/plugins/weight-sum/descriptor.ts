// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/plugins/weight-sum/descriptor`
 * Purpose: Weight-sum allocator descriptor — wraps existing computeProposedAllocations from attribution-ledger.
 * Scope: Pure descriptor binding. Does not perform I/O or modify allocation logic.
 * Invariants:
 * - ALLOCATOR_NEEDS_DECLARED: requiredEvaluationRefs validated by dispatchAllocator before compute.
 * - ALLOCATION_ALGO_VERSIONED: delegates to versioned weight-sum-v0 implementation.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import { computeProposedAllocations } from "@cogni/attribution-ledger";
import type { AllocatorDescriptor } from "@cogni/attribution-pipeline-contracts";

/** Algorithm ref for the weight-sum allocator. */
export const WEIGHT_SUM_ALGO_REF = "weight-sum-v0";

/**
 * Weight-sum allocator descriptor.
 * Wraps `computeProposedAllocations("weight-sum-v0", ...)` from attribution-ledger.
 * Requires the echo evaluation (for event count validation) but does not
 * consume evaluation payloads — allocation is computed from events + weights.
 */
export const WEIGHT_SUM_ALLOCATOR: AllocatorDescriptor = {
  algoRef: WEIGHT_SUM_ALGO_REF,
  requiredEvaluationRefs: ["cogni.echo.v0"],
  compute: async (context) => {
    return computeProposedAllocations(
      WEIGHT_SUM_ALGO_REF,
      context.events,
      context.weightConfig
    );
  },
};
