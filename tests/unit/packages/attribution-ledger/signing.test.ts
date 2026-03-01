// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/attribution-ledger/signing`
 * Purpose: Unit tests for buildCanonicalMessage (deprecated), buildEIP712TypedData, and computeApproverSetHash.
 * Scope: Asserts exact byte output, deterministic hashing, and EIP-712 typed data structure. Does not test on-chain verification.
 * Invariants: SIGNATURE_SCOPE_BOUND, APPROVERS_PINNED_AT_REVIEW, EIP712_DETERMINISTIC.
 * Side-effects: none
 * Links: packages/attribution-ledger/src/signing.ts
 * @internal
 */

import { createHash } from "node:crypto";
import {
  buildCanonicalMessage,
  buildEIP712TypedData,
  computeApproverSetHash,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  PAYOUT_STATEMENT_TYPES,
} from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

describe("buildCanonicalMessage", () => {
  const params = {
    nodeId: "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d",
    scopeId: "a28a8b1e-1f9d-5cd5-9329-569e4819feda",
    epochId: "42",
    allocationSetHash: "abc123def456",
    poolTotalCredits: "10000",
  };

  it("starts with version header", () => {
    const msg = buildCanonicalMessage(params);
    expect(msg.startsWith("Cogni Payout Statement v1\n")).toBe(true);
  });

  it("uses \\n only (no \\r)", () => {
    const msg = buildCanonicalMessage(params);
    expect(msg).not.toContain("\r");
  });

  it("includes all SIGNATURE_SCOPE_BOUND fields", () => {
    const msg = buildCanonicalMessage(params);
    expect(msg).toContain(`Node: ${params.nodeId}`);
    expect(msg).toContain(`Scope: ${params.scopeId}`);
    expect(msg).toContain(`Epoch: ${params.epochId}`);
    expect(msg).toContain(`Allocation Hash: ${params.allocationSetHash}`);
    expect(msg).toContain(`Pool Total: ${params.poolTotalCredits}`);
  });

  it("produces exact expected output", () => {
    const msg = buildCanonicalMessage(params);
    const expected = [
      "Cogni Payout Statement v1",
      "Node: 4ff8eac1-4eba-4ed0-931b-b1fe4f64713d",
      "Scope: a28a8b1e-1f9d-5cd5-9329-569e4819feda",
      "Epoch: 42",
      "Allocation Hash: abc123def456",
      "Pool Total: 10000",
    ].join("\n");
    expect(msg).toBe(expected);
  });

  it("has exactly 6 lines (header + 5 fields)", () => {
    const msg = buildCanonicalMessage(params);
    expect(msg.split("\n")).toHaveLength(6);
  });

  it("is deterministic — same input produces same output", () => {
    const a = buildCanonicalMessage(params);
    const b = buildCanonicalMessage(params);
    expect(a).toBe(b);
  });
});

describe("computeApproverSetHash", () => {
  it("returns a hex SHA-256 hash", () => {
    const hash = computeApproverSetHash([
      "0x1234567890abcdef1234567890abcdef12345678",
    ]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case-insensitive (lowercase normalizes)", () => {
    const upper = computeApproverSetHash([
      "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    ]);
    const lower = computeApproverSetHash([
      "0xabcdef1234567890abcdef1234567890abcdef12",
    ]);
    expect(upper).toBe(lower);
  });

  it("is order-independent (sorted before hashing)", () => {
    const a = computeApproverSetHash(["0xaaa", "0xbbb", "0xccc"]);
    const b = computeApproverSetHash(["0xccc", "0xaaa", "0xbbb"]);
    expect(a).toBe(b);
  });

  it("produces expected hash for known input", () => {
    const hash = computeApproverSetHash(["0xaaa", "0xbbb"]);
    const expected = createHash("sha256").update("0xaaa,0xbbb").digest("hex");
    expect(hash).toBe(expected);
  });

  it("is deterministic", () => {
    const addrs = [
      "0x1234567890abcdef1234567890abcdef12345678",
      "0xfedcba0987654321fedcba0987654321fedcba09",
    ];
    const a = computeApproverSetHash(addrs);
    const b = computeApproverSetHash(addrs);
    expect(a).toBe(b);
  });

  it("different sets produce different hashes", () => {
    const a = computeApproverSetHash(["0xaaa"]);
    const b = computeApproverSetHash(["0xbbb"]);
    expect(a).not.toBe(b);
  });
});

describe("buildEIP712TypedData", () => {
  const params = {
    nodeId: "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d",
    scopeId: "a28a8b1e-1f9d-5cd5-9329-569e4819feda",
    epochId: "42",
    allocationSetHash: "abc123def456",
    poolTotalCredits: "10000",
    chainId: 8453,
  };

  it("returns correct domain with name, version, and chainId", () => {
    const data = buildEIP712TypedData(params);
    expect(data.domain).toEqual({
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: 8453,
    });
  });

  it("returns PayoutStatement as primaryType", () => {
    const data = buildEIP712TypedData(params);
    expect(data.primaryType).toBe("PayoutStatement");
  });

  it("includes all SIGNATURE_SCOPE_BOUND fields in message", () => {
    const data = buildEIP712TypedData(params);
    expect(data.message).toEqual({
      nodeId: params.nodeId,
      scopeId: params.scopeId,
      epochId: params.epochId,
      allocationSetHash: params.allocationSetHash,
      poolTotalCredits: params.poolTotalCredits,
    });
  });

  it("exports correct type definitions matching viem expectations", () => {
    const data = buildEIP712TypedData(params);
    expect(data.types).toBe(PAYOUT_STATEMENT_TYPES);
    expect(data.types.PayoutStatement).toHaveLength(5);
    const fieldNames = data.types.PayoutStatement.map((f) => f.name);
    expect(fieldNames).toEqual([
      "nodeId",
      "scopeId",
      "epochId",
      "allocationSetHash",
      "poolTotalCredits",
    ]);
  });

  it("is deterministic — same input produces identical output", () => {
    const a = buildEIP712TypedData(params);
    const b = buildEIP712TypedData(params);
    expect(a).toEqual(b);
  });

  it("different chainId produces different domain", () => {
    const a = buildEIP712TypedData({ ...params, chainId: 8453 });
    const b = buildEIP712TypedData({ ...params, chainId: 11155111 });
    expect(a.domain.chainId).not.toBe(b.domain.chainId);
    // message is same — only domain differs
    expect(a.message).toEqual(b.message);
  });

  it("different epochId produces different message", () => {
    const a = buildEIP712TypedData({ ...params, epochId: "42" });
    const b = buildEIP712TypedData({ ...params, epochId: "43" });
    expect(a.message.epochId).not.toBe(b.message.epochId);
    // domain is same — only message differs
    expect(a.domain).toEqual(b.domain);
  });
});
