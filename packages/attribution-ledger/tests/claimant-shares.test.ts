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

import {
  computeReceiptWeights,
  type ReceiptClaimantsRecord,
  type ReceiptForWeighting,
  type ReceiptUnitWeight,
} from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";
import {
  applyReceiptWeightOverrides,
  applySubjectOverrides,
  buildDefaultReceiptClaimantSharesPayload,
  buildReceiptWeightOverrideSnapshots,
  buildReviewOverrideSnapshots,
  CLAIMANT_SHARE_DENOMINATOR_PPM,
  computeAttributionStatementLines,
  computeFinalClaimantAllocations,
  expandClaimantUnits,
  explodeToClaimants,
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

// ---------------------------------------------------------------------------
// Receipt-weight allocation model tests
// ---------------------------------------------------------------------------

describe("computeReceiptWeights", () => {
  const weightConfig = {
    "github:pr_merged": 1000,
    "github:issue_closed": 500,
  };

  it("computes per-receipt weights for included receipts", () => {
    const receipts: ReceiptForWeighting[] = [
      {
        receiptId: "r2",
        source: "github",
        eventType: "issue_closed",
        included: true,
        weightOverrideMilli: null,
      },
      {
        receiptId: "r1",
        source: "github",
        eventType: "pr_merged",
        included: true,
        weightOverrideMilli: null,
      },
    ];

    const result = computeReceiptWeights(
      "weight-sum-v0",
      receipts,
      weightConfig
    );

    expect(result).toHaveLength(2);
    // Sorted by receiptId
    expect(result[0]?.receiptId).toBe("r1");
    expect(result[0]?.units).toBe(1000n);
    expect(result[1]?.receiptId).toBe("r2");
    expect(result[1]?.units).toBe(500n);
  });

  it("filters out excluded receipts", () => {
    const receipts: ReceiptForWeighting[] = [
      {
        receiptId: "r1",
        source: "github",
        eventType: "pr_merged",
        included: false,
        weightOverrideMilli: null,
      },
    ];

    const result = computeReceiptWeights(
      "weight-sum-v0",
      receipts,
      weightConfig
    );
    expect(result).toHaveLength(0);
  });

  it("uses weightOverrideMilli when provided", () => {
    const receipts: ReceiptForWeighting[] = [
      {
        receiptId: "r1",
        source: "github",
        eventType: "pr_merged",
        included: true,
        weightOverrideMilli: 9999n,
      },
    ];

    const result = computeReceiptWeights(
      "weight-sum-v0",
      receipts,
      weightConfig
    );
    expect(result[0]?.units).toBe(9999n);
  });

  it("throws for unknown algoRef", () => {
    expect(() => computeReceiptWeights("unknown", [], {})).toThrow(
      "Unknown allocation algorithm: unknown"
    );
  });
});

describe("explodeToClaimants", () => {
  function makeClaimantRecord(
    receiptId: string,
    claimantKeys: string[]
  ): ReceiptClaimantsRecord {
    return {
      id: `id-${receiptId}`,
      nodeId: "node-1",
      epochId: 1n,
      receiptId,
      status: "locked",
      resolverRef: "cogni.default-author.v0",
      algoRef: "default-author-v0",
      inputsHash: "hash",
      claimantKeys,
      createdAt: new Date(),
      createdBy: "system",
    };
  }

  it("joins single-claimant receipts and sums across receipts", () => {
    const weights: ReceiptUnitWeight[] = [
      { receiptId: "r1", units: 1000n },
      { receiptId: "r2", units: 500n },
    ];
    const claimants = [
      makeClaimantRecord("r1", ["user:alice"]),
      makeClaimantRecord("r2", ["user:alice"]),
    ];

    const result = explodeToClaimants(weights, claimants);

    expect(result).toHaveLength(1);
    expect(result[0]?.claimant).toEqual({ kind: "user", userId: "alice" });
    expect(result[0]?.finalUnits).toBe(1500n);
    expect(result[0]?.receiptIds).toEqual(["r1", "r2"]);
  });

  it("splits equally among multiple claimants with largest-remainder", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 10n }];
    const claimants = [
      makeClaimantRecord("r1", ["user:bob", "user:alice", "user:charlie"]),
    ];

    const result = explodeToClaimants(weights, claimants);

    // 10 / 3 = 3 each with 1 remainder → first key alphabetically gets extra
    expect(result).toHaveLength(3);
    // Sorted by claimant key: user:alice, user:bob, user:charlie
    expect(result[0]?.claimant).toEqual({ kind: "user", userId: "alice" });
    expect(result[0]?.finalUnits).toBe(4n); // 3 + 1 remainder
    expect(result[1]?.claimant).toEqual({ kind: "user", userId: "bob" });
    expect(result[1]?.finalUnits).toBe(3n);
    expect(result[2]?.claimant).toEqual({ kind: "user", userId: "charlie" });
    expect(result[2]?.finalUnits).toBe(3n);
  });

  it("handles identity claimant keys", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 1000n }];
    const claimants = [makeClaimantRecord("r1", ["identity:github:42"])];

    const result = explodeToClaimants(weights, claimants);

    expect(result).toHaveLength(1);
    expect(result[0]?.claimant).toEqual({
      kind: "identity",
      provider: "github",
      externalId: "42",
      providerLogin: null,
    });
    expect(result[0]?.finalUnits).toBe(1000n);
  });

  it("throws when receipt has no matching claimants record", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 1000n }];

    expect(() => explodeToClaimants(weights, [])).toThrow(
      'receipt "r1" has no matching claimants record'
    );
  });

  it("returns deterministic sorted output", () => {
    const weights: ReceiptUnitWeight[] = [
      { receiptId: "r1", units: 100n },
      { receiptId: "r2", units: 200n },
    ];
    const claimants = [
      makeClaimantRecord("r1", ["user:zara"]),
      makeClaimantRecord("r2", ["user:alice"]),
    ];

    const result = explodeToClaimants(weights, claimants);

    // Sorted by claimant key
    expect(result[0]?.claimant).toEqual({ kind: "user", userId: "alice" });
    expect(result[1]?.claimant).toEqual({ kind: "user", userId: "zara" });
  });
});

// ---------------------------------------------------------------------------
// applyReceiptWeightOverrides
// ---------------------------------------------------------------------------

describe("applyReceiptWeightOverrides", () => {
  const baseWeights: ReceiptUnitWeight[] = [
    { receiptId: "r1", units: 1000n },
    { receiptId: "r2", units: 500n },
    { receiptId: "r3", units: 2000n },
  ];

  it("replaces units for overridden receipts", () => {
    const result = applyReceiptWeightOverrides(baseWeights, [
      {
        subjectRef: "r1",
        overrideUnits: 0n,
        overrideShares: null,
        overrideReason: "zeroed out",
      },
    ]);

    expect(result.find((w) => w.receiptId === "r1")?.units).toBe(0n);
    expect(result.find((w) => w.receiptId === "r2")?.units).toBe(500n);
    expect(result.find((w) => w.receiptId === "r3")?.units).toBe(2000n);
  });

  it("ignores overrides with null overrideUnits", () => {
    const result = applyReceiptWeightOverrides(baseWeights, [
      {
        subjectRef: "r1",
        overrideUnits: null,
        overrideShares: null,
        overrideReason: "shares only",
      },
    ]);

    expect(result.find((w) => w.receiptId === "r1")?.units).toBe(1000n);
  });

  it("ignores overrides for nonexistent receipts", () => {
    const result = applyReceiptWeightOverrides(baseWeights, [
      {
        subjectRef: "nonexistent",
        overrideUnits: 999n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(result).toEqual(baseWeights);
  });

  it("returns unmodified copy when no overrides", () => {
    const result = applyReceiptWeightOverrides(baseWeights, []);
    expect(result).toEqual(baseWeights);
    expect(result).not.toBe(baseWeights);
  });

  it("returns sorted by receiptId", () => {
    const unsorted: ReceiptUnitWeight[] = [
      { receiptId: "r3", units: 300n },
      { receiptId: "r1", units: 100n },
    ];
    const result = applyReceiptWeightOverrides(unsorted, [
      {
        subjectRef: "r1",
        overrideUnits: 50n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(result[0]?.receiptId).toBe("r1");
    expect(result[1]?.receiptId).toBe("r3");
  });

  it("changes finalAllocationSetHash when override is applied", () => {
    // This is the key invariant: overrides must change the downstream hash
    const makeClaimant = (
      receiptId: string,
      keys: string[]
    ): ReceiptClaimantsRecord => ({
      id: `c-${receiptId}`,
      nodeId: "node-1",
      epochId: 1n,
      receiptId,
      status: "locked",
      resolverRef: "default",
      algoRef: "v0",
      inputsHash: "hash",
      claimantKeys: keys,
      createdAt: new Date(),
      createdBy: null,
    });

    const claimants = [
      makeClaimant("r1", ["user:alice"]),
      makeClaimant("r2", ["user:bob"]),
      makeClaimant("r3", ["user:alice"]),
    ];

    const withoutOverride = explodeToClaimants(baseWeights, claimants);
    const withOverride = explodeToClaimants(
      applyReceiptWeightOverrides(baseWeights, [
        {
          subjectRef: "r1",
          overrideUnits: 0n,
          overrideShares: null,
          overrideReason: "zeroed",
        },
      ]),
      claimants
    );

    // Alice's total should differ: 1000+2000=3000 vs 0+2000=2000
    const aliceWithout = withoutOverride.find(
      (a) => a.claimant.kind === "user" && a.claimant.userId === "alice"
    );
    const aliceWith = withOverride.find(
      (a) => a.claimant.kind === "user" && a.claimant.userId === "alice"
    );
    expect(aliceWithout?.finalUnits).toBe(3000n);
    expect(aliceWith?.finalUnits).toBe(2000n);
  });
});

// ---------------------------------------------------------------------------
// buildReceiptWeightOverrideSnapshots
// ---------------------------------------------------------------------------

describe("buildReceiptWeightOverrideSnapshots", () => {
  const baseWeights: ReceiptUnitWeight[] = [
    { receiptId: "r1", units: 1000n },
    { receiptId: "r2", units: 500n },
  ];

  it("captures original and override units", () => {
    const snapshots = buildReceiptWeightOverrideSnapshots(baseWeights, [
      {
        subjectRef: "r1",
        overrideUnits: 200n,
        overrideShares: null,
        overrideReason: "reduced",
      },
    ]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      subject_ref: "r1",
      original_units: "1000",
      override_units: "200",
      original_shares: [],
      override_shares: null,
      reason: "reduced",
    });
  });

  it("excludes overrides for nonexistent receipts", () => {
    const snapshots = buildReceiptWeightOverrideSnapshots(baseWeights, [
      {
        subjectRef: "nonexistent",
        overrideUnits: 100n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(snapshots).toHaveLength(0);
  });

  it("returns empty when no overrides", () => {
    expect(buildReceiptWeightOverrideSnapshots(baseWeights, [])).toEqual([]);
  });

  it("sorts by subject_ref", () => {
    const snapshots = buildReceiptWeightOverrideSnapshots(baseWeights, [
      {
        subjectRef: "r2",
        overrideUnits: 0n,
        overrideShares: null,
        overrideReason: null,
      },
      {
        subjectRef: "r1",
        overrideUnits: 0n,
        overrideShares: null,
        overrideReason: null,
      },
    ]);

    expect(snapshots[0]?.subject_ref).toBe("r1");
    expect(snapshots[1]?.subject_ref).toBe("r2");
  });
});
