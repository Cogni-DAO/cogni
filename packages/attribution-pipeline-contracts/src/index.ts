// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts`
 * Purpose: Stable contracts for the attribution pipeline plugin architecture — interfaces, registries, dispatch, ordering, validation.
 * Scope: Types and pure functions only. Does not perform I/O or contain side effects (FRAMEWORK_NO_IO).
 * Invariants:
 * - FRAMEWORK_NO_IO: this package contains zero I/O, zero side effects, zero env reads.
 * - PROFILE_IS_DATA: profiles are plain readonly objects.
 * - ENRICHER_ORDER_EXPLICIT: enricher ordering validated at registration.
 * - EVALUATION_WRITE_VALIDATED: all required fields checked on every evaluation write.
 * - ALLOCATOR_NEEDS_DECLARED: required evaluations validated before compute().
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

// Allocator contracts + dispatch
export {
  type AllocationContext,
  type AllocatorDescriptor,
  type AllocatorRegistry,
  dispatchAllocator,
} from "./allocator";
// Core evaluations
export {
  CLAIMANT_SHARES_CORE_DESCRIPTOR,
  CLAIMANT_SHARES_SCHEMA_REF,
  CORE_EVALUATION_REFS,
  getEffectiveEnricherRefs,
} from "./core-evaluations";
// Enricher contracts
export type {
  EnricherAdapter,
  EnricherAdapterRegistry,
  EnricherContext,
  EnricherDescriptor,
  EnricherEvaluationResult,
  EnricherLogger,
} from "./enricher";
// Ordering validation
export { validateEnricherOrder } from "./ordering";
// Profile types + resolution
export {
  type EnricherRef,
  type PipelineProfile,
  type ProfileRegistry,
  resolveProfile,
} from "./profile";

// Evaluation write validation
export { validateEvaluationWrite } from "./validation";
