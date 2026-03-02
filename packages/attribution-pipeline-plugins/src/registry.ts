// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/registry`
 * Purpose: Default registry construction — assembles built-in enrichers, allocators, and profiles.
 * Scope: Registry factory function. Does not perform I/O or contain side effects.
 * Invariants:
 * - ENRICHER_ORDER_EXPLICIT: profile enricher ordering validated at construction.
 * - FRAMEWORK_STABLE_PLUGINS_CHURN: plugins package owns registry construction; framework stays stable.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import type {
  AllocatorRegistry,
  EnricherAdapterRegistry,
  ProfileRegistry,
} from "@cogni/attribution-pipeline-contracts";

import { createClaimantSharesAdapter } from "./plugins/claimant-shares/adapter";
import { createEchoAdapter } from "./plugins/echo/adapter";
import { WEIGHT_SUM_ALLOCATOR } from "./plugins/weight-sum/descriptor";
import { COGNI_V0_PROFILE } from "./profiles/cogni-v0.0";

/**
 * Result from createDefaultRegistries.
 */
export interface DefaultRegistries {
  readonly profiles: ProfileRegistry;
  readonly enrichers: EnricherAdapterRegistry;
  readonly allocators: AllocatorRegistry;
}

/**
 * Create the default registries with all built-in plugins and profiles.
 * Returns immutable maps keyed by ref strings.
 */
export function createDefaultRegistries(): DefaultRegistries {
  const echoAdapter = createEchoAdapter();
  const claimantSharesAdapter = createClaimantSharesAdapter();

  const profiles: ProfileRegistry = new Map([
    [COGNI_V0_PROFILE.profileId, COGNI_V0_PROFILE],
  ]);

  const enrichers: EnricherAdapterRegistry = new Map([
    [echoAdapter.evaluationRef, echoAdapter],
    [claimantSharesAdapter.evaluationRef, claimantSharesAdapter],
  ]);

  const allocators: AllocatorRegistry = new Map([
    [WEIGHT_SUM_ALLOCATOR.algoRef, WEIGHT_SUM_ALLOCATOR],
  ]);

  return { profiles, enrichers, allocators };
}
