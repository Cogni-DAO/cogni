// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/tests/artifact-envelope`
 * Purpose: Unit tests for artifact envelope validation and enricher inputs hashing.
 * Scope: Tests validation rules for artifact refs and envelopes. Does not test store or I/O.
 * Invariants: ARTIFACT_REF_NAMESPACED, CANONICAL_JSON
 * Side-effects: none
 * Links: packages/ledger-core/src/artifact-envelope.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  validateArtifactEnvelope,
  validateArtifactRef,
} from "../src/artifact-envelope";
import { computeEnricherInputsHash } from "../src/enricher-inputs";

// ── validateArtifactRef ─────────────────────────────────────────

describe("validateArtifactRef", () => {
  it("accepts valid namespaced refs", () => {
    expect(() => validateArtifactRef("cogni.echo.v0")).not.toThrow();
    expect(() => validateArtifactRef("cogni.work_item_links.v0")).not.toThrow();
    expect(() => validateArtifactRef("cogni.ai_scores.v1")).not.toThrow();
    expect(() => validateArtifactRef("x.y.v99")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateArtifactRef("")).toThrow("Invalid artifactRef");
  });

  it("rejects unnamespaced ref", () => {
    expect(() => validateArtifactRef("echo")).toThrow("Invalid artifactRef");
  });

  it("rejects ref without version", () => {
    expect(() => validateArtifactRef("cogni.echo")).toThrow(
      "Invalid artifactRef"
    );
  });

  it("rejects uppercase", () => {
    expect(() => validateArtifactRef("Cogni.Echo.v0")).toThrow(
      "Invalid artifactRef"
    );
  });

  it("rejects version without number", () => {
    expect(() => validateArtifactRef("cogni.echo.v")).toThrow(
      "Invalid artifactRef"
    );
  });
});

// ── validateArtifactEnvelope ────────────────────────────────────

describe("validateArtifactEnvelope", () => {
  const hash64 = "0123456789abcdef".repeat(4);

  const validParams = {
    artifactRef: "cogni.echo.v0",
    algoRef: "echo-v0",
    inputsHash: hash64,
    payloadHash: hash64,
    payloadJson: { totalEvents: 5 },
  };

  it("accepts valid envelope", () => {
    expect(() => validateArtifactEnvelope(validParams)).not.toThrow();
  });

  it("rejects empty algoRef", () => {
    expect(() =>
      validateArtifactEnvelope({ ...validParams, algoRef: "" })
    ).toThrow("Invalid algoRef");
  });

  it("rejects whitespace-only algoRef", () => {
    expect(() =>
      validateArtifactEnvelope({ ...validParams, algoRef: "   " })
    ).toThrow("Invalid algoRef");
  });

  it("rejects non-hex inputsHash", () => {
    expect(() =>
      validateArtifactEnvelope({ ...validParams, inputsHash: "not-a-hash" })
    ).toThrow("Invalid inputsHash");
  });

  it("rejects uppercase hex in payloadHash", () => {
    expect(() =>
      validateArtifactEnvelope({
        ...validParams,
        payloadHash: "A".repeat(64),
      })
    ).toThrow("Invalid payloadHash");
  });

  it("rejects null payloadJson", () => {
    expect(() =>
      validateArtifactEnvelope({
        ...validParams,
        payloadJson: null as unknown as Record<string, unknown>,
      })
    ).toThrow("Invalid payloadJson");
  });

  it("rejects array payloadJson", () => {
    expect(() =>
      validateArtifactEnvelope({
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
      events: [
        { eventId: "ev1", eventPayloadHash: "hash1" },
        { eventId: "ev2", eventPayloadHash: "hash2" },
      ],
    };

    const hash1 = await computeEnricherInputsHash(params);
    const hash2 = await computeEnricherInputsHash(params);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sorts by eventId — different order same hash", async () => {
    const hash1 = await computeEnricherInputsHash({
      epochId: 1n,
      events: [
        { eventId: "b", eventPayloadHash: "h2" },
        { eventId: "a", eventPayloadHash: "h1" },
      ],
    });
    const hash2 = await computeEnricherInputsHash({
      epochId: 1n,
      events: [
        { eventId: "a", eventPayloadHash: "h1" },
        { eventId: "b", eventPayloadHash: "h2" },
      ],
    });
    expect(hash1).toBe(hash2);
  });

  it("different events produce different hash", async () => {
    const hash1 = await computeEnricherInputsHash({
      epochId: 1n,
      events: [{ eventId: "a", eventPayloadHash: "h1" }],
    });
    const hash2 = await computeEnricherInputsHash({
      epochId: 1n,
      events: [{ eventId: "a", eventPayloadHash: "h2" }],
    });
    expect(hash1).not.toBe(hash2);
  });

  it("includes extensions in hash", async () => {
    const base = {
      epochId: 1n,
      events: [{ eventId: "a", eventPayloadHash: "h1" }],
    };
    const hashWithout = await computeEnricherInputsHash(base);
    const hashWith = await computeEnricherInputsHash({
      ...base,
      extensions: { frontmatterHashes: ["xyz"] },
    });
    expect(hashWithout).not.toBe(hashWith);
  });

  it("handles empty events array", async () => {
    const hash = await computeEnricherInputsHash({
      epochId: 1n,
      events: [],
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
