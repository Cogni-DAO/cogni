// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins`
 * Purpose: Built-in enricher/allocator implementations, profiles, and registry construction for the attribution pipeline.
 * Scope: Plugin implementations and profile data. Does not define contracts (those live in @cogni/attribution-pipeline-contracts).
 * Invariants:
 * - ENRICHER_DESCRIPTOR_PURE: descriptors are constants + pure functions.
 * - PROFILE_IS_DATA: profiles are plain readonly objects.
 * - FRAMEWORK_STABLE_PLUGINS_CHURN: this package churns; framework stays stable.
 * - PLUGIN_NO_LEDGER_CORE_LEAK: never imported by @cogni/attribution-ledger.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

export { createEchoAdapter } from "./plugins/echo/adapter";
// Echo plugin
export {
  buildEchoPayload,
  ECHO_ALGO_REF,
  ECHO_DESCRIPTOR,
  ECHO_EVALUATION_REF,
  ECHO_SCHEMA_REF,
} from "./plugins/echo/descriptor";

// Weight-sum allocator
export {
  WEIGHT_SUM_ALGO_REF,
  WEIGHT_SUM_ALLOCATOR,
} from "./plugins/weight-sum/descriptor";

// Profiles
export { COGNI_V0_PROFILE } from "./profiles/cogni-v0.0";

// Registry
export {
  createDefaultRegistries,
  type DefaultRegistries,
} from "./registry";
