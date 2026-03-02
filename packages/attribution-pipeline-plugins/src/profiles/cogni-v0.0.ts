// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/profiles/cogni-v0.0`
 * Purpose: Built-in pipeline profile for weekly activity attribution (cogni-v0.0).
 * Scope: Plain readonly data object. Does not perform I/O or contain logic.
 * Invariants:
 * - PROFILE_IS_DATA: plain readonly object — no classes, no methods, no I/O.
 * - PROFILE_IMMUTABLE_PUBLISH_NEW: once published, never mutated.
 * - PROFILE_SELECTS_ENRICHERS: enricherRefs is sole authority for which enrichers run.
 * - PROFILE_SELECTS_ALLOCATOR: allocatorRef is sole authority for which allocator runs.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import type { PipelineProfile } from "@cogni/attribution-pipeline-contracts";

/**
 * cogni-v0.0 profile — weekly activity attribution.
 * Runs echo as the only enricher.
 */
export const COGNI_V0_PROFILE: PipelineProfile = {
  profileId: "cogni-v0.0",
  label: "Cogni Weekly Activity v0.0",
  enricherRefs: [{ enricherRef: "cogni.echo.v0", dependsOnEvaluations: [] }],
  allocatorRef: "weight-sum-v0",
  epochKind: "activity",
  defaultWeightConfig: {
    "github:pr_merged": 1000,
    "github:review_submitted": 500,
    "github:issue_closed": 300,
  },
};
