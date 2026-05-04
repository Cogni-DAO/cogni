// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@tests/unit/features/wallet-analysis/distribution-comparison-block`
 * Purpose: Pin Research comparison loading isolation for Target overlap.
 * Scope: React component test; no network or chart library.
 * Invariants: TARGET_OVERLAP_DOES_NOT_WAIT_FOR_POLYMARKET_QUERIES.
 * Side-effects: none
 * @internal
 */

import type { PolyResearchTargetOverlapResponse } from "@cogni/poly-node-contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DistributionComparisonBlock } from "@/features/wallet-analysis/components/DistributionsBlock";

const TARGET_OVERLAP = {
  window: "ALL",
  computedAt: "2026-05-04T00:00:00.000Z",
  wallets: {
    rn1: {
      label: "RN1",
      address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
      observed: true,
    },
    swisstony: {
      label: "swisstony",
      address: "0x204f72f35326db932158cba6adff0b9a1da95e14",
      observed: true,
    },
  },
  buckets: [
    bucket("rn1_only", "RN1 only", 10, 0),
    bucket("shared", "Shared", 3, 4),
    bucket("swisstony_only", "swisstony only", 0, 8),
  ],
  policy: {
    signal: "insufficient",
    sharedPnlPerDollar: null,
    soloPnlPerDollar: null,
    note: "Need active shared and solo exposure before policy comparison.",
  },
} satisfies PolyResearchTargetOverlapResponse;

function bucket(
  key: PolyResearchTargetOverlapResponse["buckets"][number]["key"],
  label: string,
  rn1Value: number,
  swisstonyValue: number
): PolyResearchTargetOverlapResponse["buckets"][number] {
  return {
    key,
    label,
    marketCount: rn1Value + swisstonyValue > 0 ? 1 : 0,
    positionCount: rn1Value + swisstonyValue,
    currentValueUsdc: rn1Value + swisstonyValue,
    costBasisUsdc: rn1Value + swisstonyValue,
    pnlUsdc: 0,
    fillVolumeUsdc: rn1Value + swisstonyValue,
    rn1: {
      marketCount: rn1Value > 0 ? 1 : 0,
      positionCount: rn1Value,
      currentValueUsdc: rn1Value,
      pnlUsdc: 0,
      fillVolumeUsdc: rn1Value,
    },
    swisstony: {
      marketCount: swisstonyValue > 0 ? 1 : 0,
      positionCount: swisstonyValue,
      currentValueUsdc: swisstonyValue,
      pnlUsdc: 0,
      fillVolumeUsdc: swisstonyValue,
    },
  };
}

describe("DistributionComparisonBlock", () => {
  it("renders Target overlap while trader/distribution comparison data is still loading", () => {
    render(
      <DistributionComparisonBlock
        activeView="targetOverlap"
        onTargetOverlapIntervalChange={vi.fn()}
        onTraderIntervalChange={vi.fn()}
        series={[{ label: "RN1", isLoading: true }]}
        targetOverlap={TARGET_OVERLAP}
        targetOverlapInterval="ALL"
        traderComparisonLoading
        traderInterval="1W"
      />
    );

    expect(screen.getByText("RN1 only")).toBeTruthy();
    expect(screen.getByText("Shared")).toBeTruthy();
    expect(screen.getByText("swisstony only")).toBeTruthy();
  });
});
