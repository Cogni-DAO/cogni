// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/enricher-context`
 * Purpose: Compile-time guard for EnricherContext store scoping.
 * Scope: Verifies enrichers depend on the narrow evaluation + read-only selection view and does NOT cover runtime registry wiring.
 * Invariants: FRAMEWORK_NO_IO.
 * Side-effects: none
 * Links: packages/attribution-pipeline-contracts/src/enricher.ts
 * @internal
 */

import type {
  EvaluationStore,
  SelectionReader,
  SelectionWriter,
} from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

import type { EnricherContext } from "../src/enricher";

type Assert<T extends true> = T;

type _ScopedStoreMatchesContext = Assert<
  EnricherContext["attributionStore"] extends EvaluationStore & SelectionReader
    ? true
    : false
>;

type _ContextAcceptsScopedStore = Assert<
  EvaluationStore & SelectionReader extends EnricherContext["attributionStore"]
    ? true
    : false
>;

// Enrichers must NOT have access to selection write methods.
type _SelectionWriterExcluded = Assert<
  EnricherContext["attributionStore"] extends SelectionWriter ? false : true
>;

describe("EnricherContext", () => {
  it("keeps attributionStore scoped to evaluation and read-only selection methods", () => {
    expect(true).toBe(true);
  });
});
