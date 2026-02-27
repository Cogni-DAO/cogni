// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/tests/hashing`
 * Purpose: Unit tests for canonical JSON serialization and artifact hashing.
 * Scope: Tests canonicalJsonStringify determinism, BigInt handling, and computeArtifactsHash sorting. Does not test store or I/O.
 * Invariants: CANONICAL_JSON — sorted keys, no whitespace, BigInt as string.
 * Side-effects: none
 * Links: packages/ledger-core/src/hashing.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJsonStringify,
  computeArtifactsHash,
  sha256OfCanonicalJson,
} from "../src/hashing";

describe("canonicalJsonStringify", () => {
  it("sorts keys at every depth", () => {
    const obj = { z: 1, a: { c: 3, b: 2 } };
    const result = canonicalJsonStringify(obj);
    expect(result).toBe('{"a":{"b":2,"c":3},"z":1}');
  });

  it("serializes BigInt as string", () => {
    const obj = { amount: BigInt("12345678901234567890") };
    const result = canonicalJsonStringify(obj);
    expect(result).toBe('{"amount":"12345678901234567890"}');
  });

  it("produces identical output regardless of key insertion order", () => {
    const a = { foo: 1, bar: 2, baz: 3 };
    const b = { baz: 3, foo: 1, bar: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it("handles arrays without sorting elements", () => {
    const arr = [3, 1, 2];
    expect(canonicalJsonStringify(arr)).toBe("[3,1,2]");
  });

  it("handles null values", () => {
    expect(canonicalJsonStringify({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it("handles nested arrays of objects", () => {
    const obj = { items: [{ z: 1, a: 2 }] };
    expect(canonicalJsonStringify(obj)).toBe('{"items":[{"a":2,"z":1}]}');
  });

  it("handles empty objects and arrays", () => {
    expect(canonicalJsonStringify({})).toBe("{}");
    expect(canonicalJsonStringify([])).toBe("[]");
  });
});

describe("sha256OfCanonicalJson", () => {
  it("returns deterministic hash", async () => {
    const hash1 = await sha256OfCanonicalJson({ b: 2, a: 1 });
    const hash2 = await sha256OfCanonicalJson({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("computeArtifactsHash", () => {
  it("produces deterministic hash sorted by artifactType", async () => {
    const artifacts = [
      {
        artifactType: "cogni.work_item_links.v0",
        algoRef: "work-item-linker-v0",
        inputsHash: "hash1",
        payloadHash: "hash2",
      },
      {
        artifactType: "cogni.ai_scores.v0",
        algoRef: "ai-scorer-v0",
        inputsHash: "hash3",
        payloadHash: "hash4",
      },
    ];

    const hash1 = await computeArtifactsHash(artifacts);
    const hash2 = await computeArtifactsHash([...artifacts].reverse());
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns different hash for different inputs", async () => {
    const hash1 = await computeArtifactsHash([
      {
        artifactType: "a",
        algoRef: "b",
        inputsHash: "c",
        payloadHash: "d",
      },
    ]);
    const hash2 = await computeArtifactsHash([
      {
        artifactType: "a",
        algoRef: "b",
        inputsHash: "c",
        payloadHash: "e",
      },
    ]);
    expect(hash1).not.toBe(hash2);
  });
});
