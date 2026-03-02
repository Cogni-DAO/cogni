// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/packages/attribution-ledger/claimant-shares`
 * Purpose: Verifies claimant-share payload building and deterministic unit splitting.
 * Scope: Pure domain tests only. Does not perform I/O or store interactions.
 * Invariants:
 * - DEFAULT_RECEIPT_CLAIMS_SINGLE_TARGET: default payload builder emits one full-share claimant per included receipt.
 * - CLAIMANT_SHARE_SPLIT_DETERMINISTIC: equal remainders are resolved in stable claimant-key order.
 * Side-effects: none
 * Links: packages/attribution-ledger/src/claimant-shares.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import {
  applySubjectOverrides,
  buildDefaultReceiptClaimantSharesPayload,
  buildReviewOverrideSnapshots,
  CLAIMANT_SHARE_DENOMINATOR_PPM,
  computeAttributionStatementLines,
  computeFinalClaimantAllocations,
  expandClaimantUnits,
  parseClaimantSharesPayload,
} from "../src/claimant-shares";

describe("buildDefaultReceiptClaimantSharesPayload", () => {
  it("builds a single unresolved identity claimant by default", () => {
    const payload = buildDefaultReceiptClaimantSharesPayload({
      weightConfig: { "github:pr_merged": 1000 },
      receipts: [
        {
          receiptId: "github:pr:test/repo:1",
          userId: null,
          source: "github",
          eventType: "pr_merged",
          included: true,
          weightOverrideMilli: null,
          platformUserId: "58641509",
          platformLogin: "derekg1729",
          artifactUrl: "https://github.com/test/repo/pull/1",
          eventTime: new Date("2026-02-20T12:00:00Z"),
          payloadHash: "hash-1",
        },
      ],
    });

    expect(payload.version).toBe(1);
    expect(payload.subjects).toHaveLength(1);
    expect(payload.subjects[0]?.units).toBe("1000");
    expect(payload.subjects[0]?.claimantShares[0]).toEqual({
      claimant: {
        kind: "identity",
        provider: "github",
        externalId: "58641509",
        providerLogin: "derekg1729",
      },
      sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM,
    });
  });

  it("skips excluded or zero-unit receipts", () => {
    const payload = buildDefaultReceiptClaimantSharesPayload({
      weightConfig: { "github:pr_merged": 0 },
      receipts: [
        {
          receiptId: "excluded",
          userId: "user-1",
          source: "github",
          eventType: "pr_merged",
          included: false,
          weightOverrideMilli: null,
          platformUserId: "1",
          platformLogin: "u1",
          artifactUrl: null,
          eventTime: new Date("2026-02-20T12:00:00Z"),
          payloadHash: "hash-a",
        },
        {
          receiptId: "zero",
          userId: "user-2",
          source: "github",
          eventType: "pr_merged",
          included: true,
          weightOverrideMilli: null,
          platformUserId: "2",
          platformLogin: "u2",
          artifactUrl: null,
          eventTime: new Date("2026-02-20T12:00:00Z"),
          payloadHash: "hash-b",
        },
      ],
    });

    expect(payload.subjects).toHaveLength(0);
  });
});

describe("parseClaimantSharesPayload", () => {
  it("parses a valid payload", () => {
    const parsed = parseClaimantSharesPayload({
      version: 1,
      subjects: [
        {
          subjectRef: "plugin.task_ref:task.0100",
          subjectKind: "plugin.task_ref",
          units: "1200",
          source: null,
          eventType: null,
          receiptIds: ["r1", "r2"],
          claimantShares: [
            {
              claimant: { kind: "user", userId: "user-1" },
              sharePpm: 500000,
            },
            {
              claimant: {
                kind: "identity",
                provider: "github",
                externalId: "42",
                providerLogin: "alice",
              },
              sharePpm: 500000,
            },
          ],
          metadata: null,
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.subjects).toHaveLength(1);
  });

  it("rejects payloads whose shares do not sum to 100%", () => {
    const parsed = parseClaimantSharesPayload({
      version: 1,
      subjects: [
        {
          subjectRef: "bad",
          subjectKind: "manual",
          units: "100",
          source: null,
          eventType: null,
          receiptIds: [],
          claimantShares: [
            {
              claimant: { kind: "user", userId: "user-1" },
              sharePpm: 100,
            },
          ],
          metadata: null,
        },
      ],
    });

    expect(parsed).toBeNull();
  });
});

describe("expandClaimantUnits", () => {
  it("splits units deterministically using largest remainder", () => {
    const expanded = expandClaimantUnits({
      version: 1,
      subjects: [
        {
          subjectRef: "task.0100",
          subjectKind: "plugin.task_ref",
          units: "5",
          source: null,
          eventType: null,
          receiptIds: ["r1", "r2"],
          claimantShares: [
            {
              claimant: { kind: "user", userId: "user-b" },
              sharePpm: 500000,
            },
            {
              claimant: { kind: "user", userId: "user-a" },
              sharePpm: 500000,
            },
          ],
          metadata: null,
        },
      ],
    });

    expect(expanded).toHaveLength(2);
    expect(expanded[0]?.units).toBe(3n);
    expect(expanded[0]?.claimant).toEqual({ kind: "user", userId: "user-a" });
    expect(expanded[1]?.units).toBe(2n);
    expect(expanded.reduce((sum, item) => sum + item.units, 0n)).toBe(5n);
  });
});

describe("computeAttributionStatementLines", () => {
  it("aggregates credits by claimant and preserves receipt ids", () => {
    const items = computeAttributionStatementLines(
      [
        {
          claimant: { kind: "user", userId: "user-1" },
          finalUnits: 3n,
          receiptIds: ["r2", "r1"],
        },
        {
          claimant: { kind: "user", userId: "user-1" },
          finalUnits: 2n,
          receiptIds: ["r3"],
        },
        {
          claimant: {
            kind: "identity",
            provider: "github",
            externalId: "42",
            providerLogin: "alice",
          },
          finalUnits: 5n,
          receiptIds: ["r4"],
        },
      ],
      1000n
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      claimantKey: "identity:github:42",
      claimant: {
        kind: "identity",
        provider: "github",
        externalId: "42",
        providerLogin: "alice",
      },
      finalUnits: 5n,
      poolShare: "0.500000",
      creditAmount: 500n,
      receiptIds: ["r4"],
    });
    expect(items[1]).toEqual({
      claimantKey: "user:user-1",
      claimant: { kind: "user", userId: "user-1" },
      finalUnits: 5n,
      poolShare: "0.500000",
      creditAmount: 500n,
      receiptIds: ["r1", "r2", "r3"],
    });
  });

  it("throws on negative final units", () => {
    expect(() =>
      computeAttributionStatementLines(
        [
          {
            claimant: { kind: "user", userId: "user-1" },
            finalUnits: -1n,
          },
        ],
        100n
      )
    ).toThrow(RangeError);
  });
});

describe("computeFinalClaimantAllocations", () => {
  it("groups expanded claimant units across subjects", () => {
    const allocations = computeFinalClaimantAllocations([
      {
        subjectRef: "receipt-1",
        subjectKind: "receipt",
        units: "10",
        source: "github",
        eventType: "pr_merged",
        receiptIds: ["r1"],
        claimantShares: [
          {
            claimant: { kind: "user", userId: "user-1" },
            sharePpm: 1_000_000,
          },
        ],
        metadata: null,
      },
      {
        subjectRef: "receipt-2",
        subjectKind: "receipt",
        units: "6",
        source: "github",
        eventType: "pr_merged",
        receiptIds: ["r2"],
        claimantShares: [
          {
            claimant: {
              kind: "identity",
              provider: "github",
              externalId: "42",
              providerLogin: "alice",
            },
            sharePpm: 1_000_000,
          },
        ],
        metadata: null,
      },
    ]);

    expect(allocations).toEqual([
      {
        claimant: {
          kind: "identity",
          provider: "github",
          externalId: "42",
          providerLogin: "alice",
        },
        finalUnits: 6n,
        receiptIds: ["r2"],
      },
      {
        claimant: { kind: "user", userId: "user-1" },
        finalUnits: 10n,
        receiptIds: ["r1"],
      },
    ]);
  });
});

describe("applySubjectOverrides", () => {
  const baseSubjects = [
    {
      subjectRef: "receipt-1",
      subjectKind: "receipt",
      units: "1000",
      source: "github",
      eventType: "pr_merged",
      receiptIds: ["r1"],
      claimantShares: [
        {
          claimant: { kind: "user" as const, userId: "user-1" },
          sharePpm: 600_000,
        },
        {
          claimant: { kind: "user" as const, userId: "user-2" },
          sharePpm: 400_000,
        },
      ],
      metadata: null,
    },
    {
      subjectRef: "receipt-2",
      subjectKind: "receipt",
      units: "500",
      source: "github",
      eventType: "pr_merged",
      receiptIds: ["r2"],
      claimantShares: [
        {
          claimant: { kind: "user" as const, userId: "user-1" },
          sharePpm: 1_000_000,
        },
      ],
      metadata: null,
    },
  ];

  it("overrides units for a subject", () => {
    const result = applySubjectOverrides(baseSubjects, [
      {
        subjectRef: "receipt-1",
        overrideUnits: 500n,
        overrideShares: null,
        overrideReason: "halved",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.units).toBe("500");
    expect(result[0]?.claimantShares).toEqual(baseSubjects[0]?.claimantShares);
    expect(result[1]?.units).toBe("500"); // unchanged
  });

  it("overrides shares for a subject", () => {
    const newShares = [
      {
        claimant: { kind: "user" as const, userId: "user-1" },
        sharePpm: 300_000,
      },
      {
        claimant: { kind: "user" as const, userId: "user-2" },
        sharePpm: 700_000,
      },
    ];
    const result = applySubjectOverrides(baseSubjects, [
      {
        subjectRef: "receipt-1",
        overrideUnits: null,
        overrideShares: newShares,
        overrideReason: "rebalanced",
      },
    ]);

    expect(result[0]?.units).toBe("1000"); // unchanged
    expect(result[0]?.claimantShares).toEqual(newShares);
  });

  it("overrides both units and shares", () => {
    const newShares = [
      {
        claimant: { kind: "user" as const, userId: "user-1" },
        sharePpm: 500_000,
      },
      {
        claimant: { kind: "user" as const, userId: "user-2" },
        sharePpm: 500_000,
      },
    ];
    const result = applySubjectOverrides(baseSubjects, [
      {
        subjectRef: "receipt-1",
        overrideUnits: 200n,
        overrideShares: newShares,
        overrideReason: "adjusted",
      },
    ]);

    expect(result[0]?.units).toBe("200");
    expect(result[0]?.claimantShares).toEqual(newShares);
  });

  it("skips overrides for nonexistent subjects", () => {
    const result = applySubjectOverrides(baseSubjects, [
      {
        subjectRef: "nonexistent",
        overrideUnits: 100n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(result).toEqual(baseSubjects);
  });

  it("returns unmodified copy when no overrides", () => {
    const result = applySubjectOverrides(baseSubjects, []);
    expect(result).toEqual(baseSubjects);
    expect(result).not.toBe(baseSubjects);
  });
});

describe("buildReviewOverrideSnapshots", () => {
  const baseSubjects = [
    {
      subjectRef: "receipt-1",
      subjectKind: "receipt",
      units: "1000",
      source: "github",
      eventType: "pr_merged",
      receiptIds: ["r1"],
      claimantShares: [
        {
          claimant: { kind: "user" as const, userId: "user-1" },
          sharePpm: 1_000_000,
        },
      ],
      metadata: null,
    },
  ];

  it("pairs overrides with original values", () => {
    const snapshots = buildReviewOverrideSnapshots(baseSubjects, [
      {
        subjectRef: "receipt-1",
        overrideUnits: 500n,
        overrideShares: null,
        overrideReason: "halved weight",
      },
    ]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      subject_ref: "receipt-1",
      original_units: "1000",
      override_units: "500",
      original_shares: baseSubjects[0]?.claimantShares,
      override_shares: null,
      reason: "halved weight",
    });
  });

  it("excludes overrides for nonexistent subjects", () => {
    const snapshots = buildReviewOverrideSnapshots(baseSubjects, [
      {
        subjectRef: "nonexistent",
        overrideUnits: 100n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(snapshots).toHaveLength(0);
  });

  it("returns empty array when no overrides", () => {
    const snapshots = buildReviewOverrideSnapshots(baseSubjects, []);
    expect(snapshots).toHaveLength(0);
  });

  it("sorts snapshots by subject_ref", () => {
    const base = baseSubjects[0];
    if (!base) throw new Error("test setup: missing base subject");
    const subjects = [
      { ...base, subjectRef: "z-receipt" },
      { ...base, subjectRef: "a-receipt" },
    ];
    const snapshots = buildReviewOverrideSnapshots(subjects, [
      {
        subjectRef: "z-receipt",
        overrideUnits: 1n,
        overrideShares: null,
        overrideReason: null,
      },
      {
        subjectRef: "a-receipt",
        overrideUnits: 2n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(snapshots[0]?.subject_ref).toBe("a-receipt");
    expect(snapshots[1]?.subject_ref).toBe("z-receipt");
  });
});
