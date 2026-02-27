// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/validated-store`
 * Purpose: Thin wrapper around AttributionStore that enforces validateEvaluationEnvelope at write time.
 * Scope: Wraps store methods. Does not contain business logic beyond validation.
 * Invariants:
 * - ENVELOPE_VALIDATED_ON_WRITE: All evaluation writes pass through validateEvaluationEnvelope.
 * Side-effects: none (delegates to inner store)
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @public
 */

import { validateEvaluationEnvelope } from "./artifact-envelope";
import type { AttributionStore } from "./store";

/**
 * Wrap an AttributionStore with envelope validation on evaluation writes.
 * Plugins cannot bypass validation by swapping adapters.
 */
export function createValidatedAttributionStore(
  inner: AttributionStore
): AttributionStore {
  return {
    ...inner,
    upsertDraftEvaluation: async (params) => {
      validateEvaluationEnvelope(params);
      return inner.upsertDraftEvaluation(params);
    },
    closeIngestionWithEvaluations: async (params) => {
      for (const e of params.evaluations) {
        validateEvaluationEnvelope(e);
      }
      return inner.closeIngestionWithEvaluations(params);
    },
  };
}
