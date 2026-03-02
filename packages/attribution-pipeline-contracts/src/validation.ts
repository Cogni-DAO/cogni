// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/validation`
 * Purpose: Evaluation write validation — asserts all required fields are present.
 * Scope: Pure functions. Does not perform I/O or hold state.
 * Invariants:
 * - EVALUATION_WRITE_VALIDATED: every evaluation write must include evaluationRef, algoRef, inputsHash, schemaRef, payloadHash.
 * - FRAMEWORK_NO_IO: this module contains zero I/O.
 * Side-effects: none
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import type { EnricherEvaluationResult } from "./enricher";

/**
 * Validate that an evaluation result has all required fields populated.
 * Throws on first missing or empty field.
 *
 * EVALUATION_WRITE_VALIDATED: every evaluation write includes
 * evaluationRef, algoRef, inputsHash, schemaRef, payloadHash.
 */
export function validateEvaluationWrite(
  result: EnricherEvaluationResult
): void {
  const requiredStringFields: ReadonlyArray<
    keyof Pick<
      EnricherEvaluationResult,
      | "evaluationRef"
      | "algoRef"
      | "schemaRef"
      | "inputsHash"
      | "payloadHash"
      | "nodeId"
    >
  > = [
    "evaluationRef",
    "algoRef",
    "schemaRef",
    "inputsHash",
    "payloadHash",
    "nodeId",
  ];

  for (const field of requiredStringFields) {
    const value = result[field];
    if (!value || value.length === 0) {
      throw new Error(
        `Evaluation write validation failed: "${field}" is required but was ${value === "" ? "empty" : "missing"}`
      );
    }
  }

  if (result.status !== "draft" && result.status !== "locked") {
    throw new Error(
      `Evaluation write validation failed: "status" must be "draft" or "locked", got "${String(result.status)}"`
    );
  }
}
