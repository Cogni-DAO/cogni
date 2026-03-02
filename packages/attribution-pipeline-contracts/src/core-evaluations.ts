// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/core-evaluations`
 * Purpose: Defines mandatory core pipeline evaluations that are not optional plugins.
 * Scope: Pure constants and helper functions. Does not perform I/O.
 * Invariants:
 * - CLAIMANT_SHARES_CORE_EVALUATION: claimant-shares is always present in the effective evaluation set.
 * - FRAMEWORK_NO_IO: this module contains zero I/O.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import {
  CLAIMANT_SHARES_ALGO_REF,
  CLAIMANT_SHARES_EVALUATION_REF,
} from "@cogni/attribution-ledger";

import type { EnricherDescriptor } from "./enricher";
import type { EnricherRef, PipelineProfile } from "./profile";

export const CLAIMANT_SHARES_SCHEMA_REF = "cogni.claimant_shares.v0/1.0.0";

export const CLAIMANT_SHARES_CORE_DESCRIPTOR: EnricherDescriptor = {
  evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
  algoRef: CLAIMANT_SHARES_ALGO_REF,
  schemaRef: CLAIMANT_SHARES_SCHEMA_REF,
};

export const CORE_EVALUATION_REFS: readonly EnricherRef[] = [
  {
    evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
    dependsOn: [],
  },
];

export function getEffectiveEnricherRefs(
  profile: Pick<PipelineProfile, "pluginEnricherRefs">
): readonly EnricherRef[] {
  return [...CORE_EVALUATION_REFS, ...profile.pluginEnricherRefs];
}
