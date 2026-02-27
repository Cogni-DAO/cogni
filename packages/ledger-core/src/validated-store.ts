// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/validated-store`
 * Purpose: Thin wrapper around ActivityLedgerStore that enforces validateArtifactEnvelope at write time.
 * Scope: Wraps store methods. Does not contain business logic beyond validation.
 * Invariants:
 * - ENVELOPE_VALIDATED_ON_WRITE: All artifact writes pass through validateArtifactEnvelope.
 * Side-effects: none (delegates to inner store)
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @public
 */

import { validateArtifactEnvelope } from "./artifact-envelope";
import type { ActivityLedgerStore } from "./store";

/**
 * Wrap an ActivityLedgerStore with envelope validation on artifact writes.
 * Plugins cannot bypass validation by swapping adapters.
 */
export function createValidatedLedgerStore(
  inner: ActivityLedgerStore
): ActivityLedgerStore {
  return {
    ...inner,
    upsertDraftArtifact: async (params) => {
      validateArtifactEnvelope(params);
      return inner.upsertDraftArtifact(params);
    },
    closeIngestionWithArtifacts: async (params) => {
      for (const a of params.artifacts) {
        validateArtifactEnvelope(a);
      }
      return inner.closeIngestionWithArtifacts(params);
    },
  };
}
