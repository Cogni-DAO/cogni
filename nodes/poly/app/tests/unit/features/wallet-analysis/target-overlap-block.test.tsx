// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@tests/unit/features/wallet-analysis/target-overlap-block`
 * Purpose: Pin Target overlap solo-vs-shared chart labeling.
 * Scope: React component test; no network, timers, or chart library.
 * Invariants: SOLO_BUCKETS_ARE_OWNER_ONLY.
 * Side-effects: none
 * @internal
 */

import type { PolyResearchTargetOverlapResponse } from "@cogni/poly-node-contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TargetOverlapBlock } from "@/features/wallet-analysis/components/TargetOverlapBlock";

const DATA = {
  window: "1D",
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
    {
      key: "rn1_only",
      label: "RN1 only",
      marketCount: 10,
      positionCount: 10,
      currentValueUsdc: 10,
      costBasisUsdc: 8,
      pnlUsdc: 2,
      fillVolumeUsdc: 100,
      rn1: {
        marketCount: 10,
        positionCount: 10,
        currentValueUsdc: 10,
        pnlUsdc: 2,
        fillVolumeUsdc: 100,
      },
      swisstony: {
        marketCount: 0,
        positionCount: 0,
        currentValueUsdc: 0,
        pnlUsdc: 0,
        fillVolumeUsdc: 7,
      },
    },
    {
      key: "shared",
      label: "Shared",
      marketCount: 3,
      positionCount: 6,
      currentValueUsdc: 70,
      costBasisUsdc: 60,
      pnlUsdc: 10,
      fillVolumeUsdc: 70,
      rn1: {
        marketCount: 3,
        positionCount: 3,
        currentValueUsdc: 30,
        pnlUsdc: 4,
        fillVolumeUsdc: 30,
      },
      swisstony: {
        marketCount: 3,
        positionCount: 3,
        currentValueUsdc: 40,
        pnlUsdc: 6,
        fillVolumeUsdc: 40,
      },
    },
    {
      key: "swisstony_only",
      label: "swisstony only",
      marketCount: 8,
      positionCount: 8,
      currentValueUsdc: 80,
      costBasisUsdc: 75,
      pnlUsdc: 5,
      fillVolumeUsdc: 80,
      rn1: {
        marketCount: 0,
        positionCount: 0,
        currentValueUsdc: 0,
        pnlUsdc: 0,
        fillVolumeUsdc: 5,
      },
      swisstony: {
        marketCount: 8,
        positionCount: 8,
        currentValueUsdc: 80,
        pnlUsdc: 5,
        fillVolumeUsdc: 80,
      },
    },
  ],
  policy: {
    signal: "shared_outperforms",
    sharedPnlPerDollar: 0.16,
    soloPnlPerDollar: 0.08,
    note: "Shared active markets are outperforming solo exposure.",
  },
} satisfies PolyResearchTargetOverlapResponse;

describe("TargetOverlapBlock", () => {
  it("renders solo buckets as owner-only rows and shared as a two-account row", () => {
    const { container } = render(<TargetOverlapBlock data={DATA} />);

    expect(screen.getAllByText("RN1")).toHaveLength(2);
    expect(screen.getAllByText("swisstony")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /fill volume/i }));

    const text = container.textContent ?? "";
    expect(text).toContain("RN1 only");
    expect(text).toContain("$100USDC");
    expect(text).toContain("Shared");
    expect(text).toContain("$30 / $40USDC");
    expect(text).toContain("swisstony only");
    expect(text).toContain("$80USDC");
    expect(text).not.toContain("$7");
    expect(text).not.toContain("$5");
  });
});
