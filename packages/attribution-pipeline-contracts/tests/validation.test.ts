// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-contracts/tests/validation`
 * Purpose: Unit tests for validateEvaluationWrite — required field checks, status validation.
 * Scope: Tests evaluation write validation logic. Does not test I/O.
 * Invariants: EVALUATION_WRITE_VALIDATED.
 * Side-effects: none
 * Links: packages/attribution-pipeline/src/validation.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import type { EnricherEvaluationResult } from "../src/enricher";
import { validateEvaluationWrite } from "../src/validation";

function makeValidResult(
  overrides?: Partial<EnricherEvaluationResult>
): EnricherEvaluationResult {
  return {
    nodeId: "node-1",
    epochId: 1n,
    evaluationRef: "cogni.echo.v0",
    status: "draft",
    algoRef: "echo-v0",
    schemaRef: "cogni.echo.v0/1.0.0",
    inputsHash: "sha256:abc123",
    payloadHash: "sha256:def456",
    payloadJson: { test: true },
    ...overrides,
  };
}

describe("validateEvaluationWrite", () => {
  it("accepts a valid evaluation result", () => {
    expect(() => validateEvaluationWrite(makeValidResult())).not.toThrow();
  });

  it("accepts locked status", () => {
    expect(() =>
      validateEvaluationWrite(makeValidResult({ status: "locked" }))
    ).not.toThrow();
  });

  it.each([
    ["evaluationRef", { evaluationRef: "" }],
    ["algoRef", { algoRef: "" }],
    ["schemaRef", { schemaRef: "" }],
    ["inputsHash", { inputsHash: "" }],
    ["payloadHash", { payloadHash: "" }],
    ["nodeId", { nodeId: "" }],
  ] as const)("throws when %s is empty", (_field, override) => {
    expect(() => validateEvaluationWrite(makeValidResult(override))).toThrow(
      /validation failed/
    );
  });

  it("throws when status is invalid", () => {
    expect(() =>
      validateEvaluationWrite(
        makeValidResult({
          status: "invalid" as "draft",
        })
      )
    ).toThrow(/status/);
  });
});
