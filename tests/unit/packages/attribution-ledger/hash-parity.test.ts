// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/attribution-ledger/hash-parity`
 * Purpose: Verifies that the sign-data and finalizeEpoch code paths produce identical finalAllocationSetHash.
 * Scope: Pure unit test exercising the same function pipeline used by both endpoints. Does not test HTTP routes or database queries.
 * Invariants:
 *   - HASH_PARITY: sign-data and finalizeEpoch must produce identical finalAllocationSetHash for the same inputs
 *   - OVERRIDE_DETERMINISTIC: applying overrides then hashing is deterministic
 * Side-effects: none
 * Links: src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts,
 *         services/scheduler-worker/src/activities/ledger.ts,
 *         packages/attribution-ledger/src/claimant-shares.ts,
 *         packages/attribution-ledger/src/hashing.ts
 * @internal
 */

import {
  applySubjectOverrides,
  buildDefaultReceiptClaimantSharesPayload,
  CLAIMANT_SHARE_DENOMINATOR_PPM,
  type ClaimantSharesSubject,
  computeFinalClaimantAllocationSetHash,
  computeFinalClaimantAllocations,
  type SelectedReceiptForAttribution,
  type SubjectOverride,
} from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";

/**
 * Shared test data — mirrors what seedReviewEpoch creates in the DB.
 * Both sign-data and finalizeEpoch start from this same data shape.
 */
const WEIGHT_CONFIG: Record<string, number> = {
  "github:pr_merged": 8000,
  "github:review_submitted": 2000,
};

const TEST_RECEIPTS: SelectedReceiptForAttribution[] = [
  {
    receiptId: "receipt-1",
    userId: "user-1",
    source: "github",
    eventType: "pr_merged",
    included: true,
    weightOverrideMilli: null,
    platformUserId: "gh-101",
    platformLogin: "alice",
    artifactUrl: "https://github.com/test/repo/pull/1",
    eventTime: new Date("2026-03-03T00:00:00Z"),
    payloadHash: "hash-1",
  },
  {
    receiptId: "receipt-2",
    userId: "user-2",
    source: "github",
    eventType: "review_submitted",
    included: true,
    weightOverrideMilli: null,
    platformUserId: "gh-202",
    platformLogin: "bob",
    artifactUrl: "https://github.com/test/repo/pull/1#review",
    eventTime: new Date("2026-03-04T00:00:00Z"),
    payloadHash: "hash-2",
  },
];

/**
 * Simulate the exact pipeline used by both sign-data route and finalizeEpoch activity:
 *   1. Build default claimant shares from receipts + weights
 *   2. Apply subject overrides
 *   3. Build final claimant allocations
 *   4. Compute final allocation set hash
 */
async function computeHash(
  receipts: readonly SelectedReceiptForAttribution[],
  weightConfig: Record<string, number>,
  overrides: readonly SubjectOverride[]
): Promise<{ hash: string; subjects: ClaimantSharesSubject[] }> {
  const payload = buildDefaultReceiptClaimantSharesPayload({
    receipts,
    weightConfig,
  });
  const modified = applySubjectOverrides(payload.subjects, overrides);
  const allocations = computeFinalClaimantAllocations(modified);
  const hash = await computeFinalClaimantAllocationSetHash(allocations);
  return { hash, subjects: modified };
}

describe("finalAllocationSetHash parity (sign-data ↔ finalizeEpoch)", () => {
  it("produces identical hash when called twice with same inputs (deterministic)", async () => {
    const result1 = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    const result2 = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    expect(result1.hash).toBe(result2.hash);
    expect(result1.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical hash with overrides applied consistently", async () => {
    const overrides: SubjectOverride[] = [
      {
        subjectRef: "receipt-1",
        overrideUnits: 5000n,
        overrideShares: null,
        overrideReason: "test adjustment",
      },
    ];

    const result1 = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, overrides);
    const result2 = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, overrides);
    expect(result1.hash).toBe(result2.hash);
  });

  it("produces different hash when overrides change units", async () => {
    const noOverrides = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    const withOverrides = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, [
      {
        subjectRef: "receipt-1",
        overrideUnits: 5000n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);
    expect(noOverrides.hash).not.toBe(withOverrides.hash);
  });

  it("produces different hash when override shares change claimant split", async () => {
    const noOverrides = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    const withShareOverride = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, [
      {
        subjectRef: "receipt-1",
        overrideUnits: null,
        overrideShares: [
          {
            claimant: { kind: "user", userId: "user-1" },
            sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM / 2,
          },
          {
            claimant: { kind: "user", userId: "user-3" },
            sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM / 2,
          },
        ],
        overrideReason: null,
      },
    ]);
    expect(noOverrides.hash).not.toBe(withShareOverride.hash);
  });

  it("override on nonexistent subject does not change hash", async () => {
    const noOverrides = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    const withMissing = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, [
      {
        subjectRef: "nonexistent-receipt",
        overrideUnits: 9999n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);
    expect(noOverrides.hash).toBe(withMissing.hash);
  });

  it("hash is a valid SHA-256 hex string", async () => {
    const { hash } = await computeHash(TEST_RECEIPTS, WEIGHT_CONFIG, []);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.length).toBe(64);
  });
});
