// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/tests/artifact-envelope`
 * Purpose: Unit tests for evaluation envelope validation and enricher inputs hashing.
 * Scope: Tests validation rules for evaluation refs and envelopes. Does not test store or I/O.
 * Invariants: EVALUATION_REF_NAMESPACED, CANONICAL_JSON
 * Side-effects: none
 * Links: packages/attribution-ledger/src/artifact-envelope.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  validateEvaluationEnvelope,
  validateEvaluationRef,
} from "../src/artifact-envelope";
import { computeEnricherInputsHash } from "../src/enricher-inputs";

// ── validateEvaluationRef ─────────────────────────────────────────

describe("validateEvaluationRef", () => {
  it("accepts valid namespaced refs", () => {
    expect(() => validateEvaluationRef("cogni.echo.v0")).not.toThrow();
    expect(() =>
      validateEvaluationRef("cogni.work_item_links.v0")
    ).not.toThrow();
    expect(() => validateEvaluationRef("cogni.ai_scores.v1")).not.toThrow();
    expect(() => validateEvaluationRef("x.y.v99")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateEvaluationRef("")).toThrow("Invalid evaluationRef");
  });

  it("rejects unnamespaced ref", () => {
    expect(() => validateEvaluationRef("echo")).toThrow(
      "Invalid evaluationRef"
    );
  });

  it("rejects ref without version", () => {
    expect(() => validateEvaluationRef("cogni.echo")).toThrow(
      "Invalid evaluationRef"
    );
  });

  it("rejects uppercase", () => {
    expect(() => validateEvaluationRef("Cogni.Echo.v0")).toThrow(
      "Invalid evaluationRef"
    );
  });

  it("rejects version without number", () => {
    expect(() => validateEvaluationRef("cogni.echo.v")).toThrow(
      "Invalid evaluationRef"
    );
  });
});

// ── validateEvaluationEnvelope ────────────────────────────────────

describe("validateEvaluationEnvelope", () => {
  const hash64 = "0123456789abcdef".repeat(4);

  const validParams = {
    evaluationRef: "cogni.echo.v0",
    algoRef: "echo-v0",
    inputsHash: hash64,
    payloadHash: hash64,
    payloadJson: { totalEvents: 5 },
  };

  it("accepts valid envelope", () => {
    expect(() => validateEvaluationEnvelope(validParams)).not.toThrow();
  });

  it("rejects empty algoRef", () => {
    expect(() =>
      validateEvaluationEnvelope({ ...validParams, algoRef: "" })
    ).toThrow("Invalid algoRef");
  });

  it("rejects whitespace-only algoRef", () => {
    expect(() =>
      validateEvaluationEnvelope({ ...validParams, algoRef: "   " })
    ).toThrow("Invalid algoRef");
  });

  it("rejects non-hex inputsHash", () => {
    expect(() =>
      validateEvaluationEnvelope({ ...validParams, inputsHash: "not-a-hash" })
    ).toThrow("Invalid inputsHash");
  });

  it("rejects uppercase hex in payloadHash", () => {
    expect(() =>
      validateEvaluationEnvelope({
        ...validParams,
        payloadHash: "A".repeat(64),
      })
    ).toThrow("Invalid payloadHash");
  });

  it("rejects null payloadJson", () => {
    expect(() =>
      validateEvaluationEnvelope({
        ...validParams,
        payloadJson: null as unknown as Record<string, unknown>,
      })
    ).toThrow("Invalid payloadJson");
  });

  it("rejects array payloadJson", () => {
    expect(() =>
      validateEvaluationEnvelope({
        ...validParams,
        payloadJson: [] as unknown as Record<string, unknown>,
      })
    ).toThrow("Invalid payloadJson");
  });
});

// ── computeEnricherInputsHash ───────────────────────────────────

describe("computeEnricherInputsHash", () => {
  it("produces deterministic hash for same inputs", async () => {
    const params = {
      epochId: 1n,
      receipts: [
        { receiptId: "ev1", receiptPayloadHash: "hash1" },
        { receiptId: "ev2", receiptPayloadHash: "hash2" },
      ],
    };

    const hash1 = await computeEnricherInputsHash(params);
    const hash2 = await computeEnricherInputsHash(params);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sorts by receiptId — different order same hash", async () => {
    const hash1 = await computeEnricherInputsHash({
      epochId: 1n,
      receipts: [
        { receiptId: "b", receiptPayloadHash: "h2" },
        { receiptId: "a", receiptPayloadHash: "h1" },
      ],
    });
    const hash2 = await computeEnricherInputsHash({
      epochId: 1n,
      receipts: [
        { receiptId: "a", receiptPayloadHash: "h1" },
        { receiptId: "b", receiptPayloadHash: "h2" },
      ],
    });
    expect(hash1).toBe(hash2);
  });

  it("different receipts produce different hash", async () => {
    const hash1 = await computeEnricherInputsHash({
      epochId: 1n,
      receipts: [{ receiptId: "a", receiptPayloadHash: "h1" }],
    });
    const hash2 = await computeEnricherInputsHash({
      epochId: 1n,
      receipts: [{ receiptId: "a", receiptPayloadHash: "h2" }],
    });
    expect(hash1).not.toBe(hash2);
  });

  it("includes extensions in hash", async () => {
    const base = {
      epochId: 1n,
      receipts: [{ receiptId: "a", receiptPayloadHash: "h1" }],
    };
    const hashWithout = await computeEnricherInputsHash(base);
    const hashWith = await computeEnricherInputsHash({
      ...base,
      extensions: { frontmatterHashes: ["xyz"] },
    });
    expect(hashWithout).not.toBe(hashWith);
  });

  it("handles empty receipts array", async () => {
    const hash = await computeEnricherInputsHash({
      epochId: 1n,
      receipts: [],
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
