// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-analysis/target-overlap-service`
 * Purpose: Unit coverage for the shared-vs-solo policy signal.
 * Scope: Pure calculation only; no DB, timers, or external I/O.
 * Invariants: SHARED_OUTPERFORMS_IS_A_POLICY_SIGNAL.
 * Side-effects: none
 * @internal
 */

import type { PolyResearchTargetOverlapBucket } from "@cogni/poly-node-contracts";
import { describe, expect, it } from "vitest";
import { buildTargetOverlapPolicy } from "@/features/wallet-analysis/server/target-overlap-service";

function bucket(
  key: PolyResearchTargetOverlapBucket["key"],
  currentValueUsdc: number,
  costBasisUsdc: number,
  pnlUsdc: number
): PolyResearchTargetOverlapBucket {
  return {
    key,
    label: key,
    marketCount: currentValueUsdc > 0 ? 1 : 0,
    positionCount: currentValueUsdc > 0 ? 1 : 0,
    currentValueUsdc,
    costBasisUsdc,
    pnlUsdc,
    fillVolumeUsdc: 0,
    rn1: {
      marketCount: 0,
      positionCount: 0,
      currentValueUsdc: 0,
      pnlUsdc: 0,
      fillVolumeUsdc: 0,
    },
    swisstony: {
      marketCount: 0,
      positionCount: 0,
      currentValueUsdc: 0,
      pnlUsdc: 0,
      fillVolumeUsdc: 0,
    },
  };
}

describe("buildTargetOverlapPolicy", () => {
  it("flags shared active markets when they outperform solo markets on PnL per cost dollar", () => {
    const policy = buildTargetOverlapPolicy([
      bucket("rn1_only", 90, 100, -10),
      bucket("shared", 130, 100, 30),
      bucket("swisstony_only", 52, 50, 2),
    ]);

    expect(policy.signal).toBe("shared_outperforms");
    expect(policy.sharedPnlPerDollar).toBe(0.3);
    expect(policy.soloPnlPerDollar).toBeCloseTo(-8 / 150);
  });

  it("does not emit a policy signal until both shared and solo exposure exist", () => {
    const policy = buildTargetOverlapPolicy([
      bucket("rn1_only", 90, 100, -10),
      bucket("shared", 0, 0, 0),
      bucket("swisstony_only", 52, 50, 2),
    ]);

    expect(policy.signal).toBe("insufficient");
  });
});
