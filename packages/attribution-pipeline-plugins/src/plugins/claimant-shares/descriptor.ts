// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/plugins/claimant-shares/descriptor`
 * Purpose: Claimant-shares enricher descriptor — re-exports ledger constants, adds schema ref.
 * Scope: Pure data only. Does not perform I/O or access any store.
 * Invariants:
 * - ENRICHER_DESCRIPTOR_PURE: constants only.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import {
  CLAIMANT_SHARES_ALGO_REF,
  CLAIMANT_SHARES_EVALUATION_REF,
} from "@cogni/attribution-ledger";
import type { EnricherDescriptor } from "@cogni/attribution-pipeline-contracts";

export { CLAIMANT_SHARES_ALGO_REF, CLAIMANT_SHARES_EVALUATION_REF };

/** Schema ref for the claimant-shares enricher payload shape. */
export const CLAIMANT_SHARES_SCHEMA_REF = "cogni.claimant_shares.v0/1.0.0";

/** Claimant-shares enricher descriptor — pure data. */
export const CLAIMANT_SHARES_DESCRIPTOR: EnricherDescriptor = {
  evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
  algoRef: CLAIMANT_SHARES_ALGO_REF,
  schemaRef: CLAIMANT_SHARES_SCHEMA_REF,
};
