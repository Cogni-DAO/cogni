// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/packages/attribution-ledger/claimant-shares`
 * Purpose: Verifies claimant types, receipt-weight pipeline, and statement computation.
 * Scope: Pure domain tests only. Does not perform I/O or store interactions.
 * Invariants:
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
  buildReceiptWeightOverrideSnapshots,
  CLAIMANT_SHARE_DENOMINATOR_PPM,
  computeAttributionStatementLines,
  explodeToClaimants,
  type SubjectOverride,
} from "../src/claimant-shares";

// ---------------------------------------------------------------------------
// computeAttributionStatementLines
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeReceiptWeights
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

// ---------------------------------------------------------------------------
// explodeToClaimants
// ---------------------------------------------------------------------------

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

  it("uses PPM-based split when overrideShares is present", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 1000n }];
    const claimants = [makeClaimantRecord("r1", ["user:alice", "user:bob"])];
    const overrides: SubjectOverride[] = [
      {
        subjectRef: "r1",
        overrideUnits: null,
        overrideShares: [
          {
            claimant: { kind: "user", userId: "alice" },
            sharePpm: 700_000,
          },
          {
            claimant: { kind: "user", userId: "bob" },
            sharePpm: 300_000,
          },
        ],
        overrideReason: "rebalanced",
      },
    ];

    const result = explodeToClaimants(weights, claimants, overrides);

    expect(result).toHaveLength(2);
    expect(result[0]?.claimant).toEqual({ kind: "user", userId: "alice" });
    expect(result[0]?.finalUnits).toBe(700n);
    expect(result[1]?.claimant).toEqual({ kind: "user", userId: "bob" });
    expect(result[1]?.finalUnits).toBe(300n);
  });

  it("PPM split uses largest-remainder rounding", () => {
    // 10 units split 333333/333334/333333 PPM among 3 claimants
    // floor: 10*333333/1000000 = 3, 10*333334/1000000 = 3, 10*333333/1000000 = 3 → sum=9
    // remainder: 333330, 333340, 333330 → bob gets the extra 1
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 10n }];
    const claimants = [
      makeClaimantRecord("r1", ["user:alice", "user:bob", "user:charlie"]),
    ];
    const overrides: SubjectOverride[] = [
      {
        subjectRef: "r1",
        overrideUnits: null,
        overrideShares: [
          {
            claimant: { kind: "user", userId: "alice" },
            sharePpm: 333_333,
          },
          {
            claimant: { kind: "user", userId: "bob" },
            sharePpm: 333_334,
          },
          {
            claimant: { kind: "user", userId: "charlie" },
            sharePpm: 333_333,
          },
        ],
        overrideReason: null,
      },
    ];

    const result = explodeToClaimants(weights, claimants, overrides);

    // Total must equal 10
    const total = result.reduce((s, r) => s + r.finalUnits, 0n);
    expect(total).toBe(10n);
    // bob has the highest remainder (333340 vs 333330) so gets the extra unit
    expect(
      result.find(
        (r) => r.claimant.kind === "user" && r.claimant.userId === "bob"
      )?.finalUnits
    ).toBe(4n);
  });

  it("mixed receipts: some with share overrides, some without", () => {
    const weights: ReceiptUnitWeight[] = [
      { receiptId: "r1", units: 1000n },
      { receiptId: "r2", units: 600n },
    ];
    const claimants = [
      makeClaimantRecord("r1", ["user:alice", "user:bob"]),
      makeClaimantRecord("r2", ["user:alice", "user:bob"]),
    ];
    const overrides: SubjectOverride[] = [
      {
        subjectRef: "r1",
        overrideUnits: null,
        overrideShares: [
          {
            claimant: { kind: "user", userId: "alice" },
            sharePpm: 800_000,
          },
          {
            claimant: { kind: "user", userId: "bob" },
            sharePpm: 200_000,
          },
        ],
        overrideReason: null,
      },
      // r2 has no overrideShares — equal split
    ];

    const result = explodeToClaimants(weights, claimants, overrides);

    // r1: alice=800, bob=200 (PPM split)
    // r2: alice=300, bob=300 (equal split)
    // Total: alice=1100, bob=500
    expect(result[0]?.claimant).toEqual({ kind: "user", userId: "alice" });
    expect(result[0]?.finalUnits).toBe(1100n);
    expect(result[1]?.claimant).toEqual({ kind: "user", userId: "bob" });
    expect(result[1]?.finalUnits).toBe(500n);
  });

  it("explicit 0 PPM gives claimant 0 units", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 1000n }];
    const claimants = [makeClaimantRecord("r1", ["user:alice", "user:bob"])];
    const overrides: SubjectOverride[] = [
      {
        subjectRef: "r1",
        overrideUnits: null,
        overrideShares: [
          {
            claimant: { kind: "user", userId: "alice" },
            sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM,
          },
          {
            claimant: { kind: "user", userId: "bob" },
            sharePpm: 0,
          },
        ],
        overrideReason: "bob excluded",
      },
    ];

    const result = explodeToClaimants(weights, claimants, overrides);

    expect(result[0]?.finalUnits).toBe(1000n); // alice gets everything
    expect(result[1]?.finalUnits).toBe(0n); // bob gets nothing
  });

  it("backward compat: no overrides arg behaves like equal split", () => {
    const weights: ReceiptUnitWeight[] = [{ receiptId: "r1", units: 100n }];
    const claimants = [makeClaimantRecord("r1", ["user:alice", "user:bob"])];

    const withoutArg = explodeToClaimants(weights, claimants);
    const withEmptyOverrides = explodeToClaimants(weights, claimants, []);

    expect(withoutArg).toEqual(withEmptyOverrides);
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

  const lockedClaimants = [
    makeClaimantRecord("r1", ["user:alice"]),
    makeClaimantRecord("r2", ["user:bob"]),
  ];

  it("captures original and override units", () => {
    const snapshots = buildReceiptWeightOverrideSnapshots(
      baseWeights,
      lockedClaimants,
      [
        {
          subjectRef: "r1",
          overrideUnits: 200n,
          overrideShares: null,
          overrideReason: "reduced",
        },
      ]
    );

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
    const snapshots = buildReceiptWeightOverrideSnapshots(
      baseWeights,
      lockedClaimants,
      [
        {
          subjectRef: "nonexistent",
          overrideUnits: 100n,
          overrideShares: null,
          overrideReason: null,
        },
      ]
    );

    expect(snapshots).toHaveLength(0);
  });

  it("returns empty when no overrides", () => {
    expect(
      buildReceiptWeightOverrideSnapshots(baseWeights, lockedClaimants, [])
    ).toEqual([]);
  });

  it("sorts by subject_ref", () => {
    const snapshots = buildReceiptWeightOverrideSnapshots(
      baseWeights,
      lockedClaimants,
      [
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
      ]
    );

    expect(snapshots[0]?.subject_ref).toBe("r1");
    expect(snapshots[1]?.subject_ref).toBe("r2");
  });

  it("computes original_shares when overrideShares is present", () => {
    const multiClaimants = [
      makeClaimantRecord("r1", ["user:alice", "user:bob"]),
    ];

    const snapshots = buildReceiptWeightOverrideSnapshots(
      baseWeights,
      multiClaimants,
      [
        {
          subjectRef: "r1",
          overrideUnits: null,
          overrideShares: [
            {
              claimant: { kind: "user", userId: "alice" },
              sharePpm: 800_000,
            },
            {
              claimant: { kind: "user", userId: "bob" },
              sharePpm: 200_000,
            },
          ],
          overrideReason: "rebalanced",
        },
      ]
    );

    expect(snapshots).toHaveLength(1);
    // original_shares should be equal split: 500000/500000
    expect(snapshots[0]?.original_shares).toEqual([
      {
        claimant: { kind: "user", userId: "alice" },
        sharePpm: 500_000,
      },
      {
        claimant: { kind: "user", userId: "bob" },
        sharePpm: 500_000,
      },
    ]);
    expect(snapshots[0]?.override_shares).toEqual([
      {
        claimant: { kind: "user", userId: "alice" },
        sharePpm: 800_000,
      },
      {
        claimant: { kind: "user", userId: "bob" },
        sharePpm: 200_000,
      },
    ]);
  });
});
