// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/profile`
 * Purpose: PipelineProfile type, registry, and resolution.
 * Scope: Types and pure functions. Does not perform I/O or hold state.
 * Invariants:
 * - PROFILE_IS_DATA: profiles are plain readonly objects — no classes, no methods, no I/O.
 * - PROFILE_IMMUTABLE_PUBLISH_NEW: profiles are semver'd and never mutated after publication.
 * - PROFILE_SELECTS_PLUGIN_ENRICHERS: pluginEnricherRefs selects optional/plugin enrichers only.
 * - PROFILE_SELECTS_ALLOCATOR: allocatorRef is the sole authority for which allocator runs.
 * - FRAMEWORK_NO_IO: this module contains zero I/O.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

/**
 * A single enricher reference within a profile, with optional dependency declarations.
 */
export interface EnricherRef {
  /** The evaluationRef that identifies this enricher (e.g., "cogni.echo.v0"). */
  readonly evaluationRef: string;

  /**
   * Evaluation refs this enricher depends on (must complete before this one runs).
   * Empty array = no dependencies, can run first.
   */
  readonly dependsOn: readonly string[];
}

/**
 * A pipeline profile is a plain readonly object selecting plugin enrichers and allocator.
 * Keyed by credit_estimate_algo from repo-spec.yaml.
 * Profiles are semver'd and NEVER mutated — publish a new version instead.
 */
export interface PipelineProfile {
  /** Semver'd profile ID (e.g., "cogni-v0.0"). Immutable once published. */
  readonly profileId: string;

  /** Human-readable label for logging/UI. */
  readonly label: string;

  /**
   * Ordered list of optional/plugin enricher refs to run.
   * Core evaluations are added separately by the framework.
   */
  readonly pluginEnricherRefs: readonly EnricherRef[];

  /** The allocation algorithm ref (pinned on epoch at closeIngestion). */
  readonly allocatorRef: string;

  /**
   * Epoch kind discriminator for the epochs table.
   * Default: "activity". Quarterly review: "quarterly_review".
   */
  readonly epochKind: string;
}

/** Registry mapping profileId → PipelineProfile. */
export type ProfileRegistry = ReadonlyMap<string, PipelineProfile>;

/**
 * Resolve a profile by credit_estimate_algo key, or throw.
 * Replaces deriveAllocationAlgoRef().
 */
export function resolveProfile(
  registry: ProfileRegistry,
  creditEstimateAlgo: string
): PipelineProfile {
  const profile = registry.get(creditEstimateAlgo);
  if (!profile) {
    const available = [...registry.keys()].join(", ");
    throw new Error(
      `Unknown credit_estimate_algo: "${creditEstimateAlgo}". Available profiles: [${available}]`
    );
  }
  return profile;
}
