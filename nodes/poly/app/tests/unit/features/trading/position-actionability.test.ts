// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/position-actionability`
 * Purpose: Unit coverage for the position authority ladder that decides
 *   whether ledger-backed Polymarket positions remain dashboard-actionable.
 * Scope: Pure feature tests with injected read functions. No DB, CLOB, RPC, or
 *   route handlers.
 * Invariants:
 *   - Data API omission does not close a row until CTF balance is zero.
 *   - CLOB market minimum classifies non-sellable balances as dust.
 * Side-effects: none
 * Links: src/features/trading/position-actionability.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";
import { classifyPositionActionability } from "@/features/trading";

describe("classifyPositionActionability", () => {
  it("uses Data API current value only when shares meet the CLOB market floor", async () => {
    const readOnchainShares = vi.fn();
    const readMarketConstraints = vi.fn().mockResolvedValue({ minShares: 1 });

    await expect(
      classifyPositionActionability({
        tokenId: "token-1",
        dataApiPositions: [{ asset: "token-1", size: 10, currentValue: 6.5 }],
        readOnchainShares,
        readMarketConstraints,
      })
    ).resolves.toEqual({
      kind: "data_api_current",
      currentValueUsdc: 6.5,
    });
    expect(readMarketConstraints).toHaveBeenCalledWith("token-1");
    expect(readOnchainShares).not.toHaveBeenCalled();
  });

  it("checks chain before classifying Data API current shares below the CLOB market floor as dust", async () => {
    const readOnchainShares = vi.fn().mockResolvedValue(0.67);
    const readMarketConstraints = vi.fn().mockResolvedValue({ minShares: 1 });

    await expect(
      classifyPositionActionability({
        tokenId: "token-1",
        dataApiPositions: [
          { asset: "token-1", size: 0.67, currentValue: 0.33 },
        ],
        readOnchainShares,
        readMarketConstraints,
      })
    ).resolves.toEqual({
      kind: "onchain_dust",
      shares: 0.67,
      minShares: 1,
    });
    expect(readOnchainShares).toHaveBeenCalledWith("token-1");
  });

  it("reads on-chain balance when Data API omits the ledger token", async () => {
    const readOnchainShares = vi.fn().mockResolvedValue(4.2);
    const readMarketConstraints = vi.fn().mockResolvedValue({ minShares: 1 });

    await expect(
      classifyPositionActionability({
        tokenId: "token-legacy",
        dataApiPositions: [],
        readOnchainShares,
        readMarketConstraints,
      })
    ).resolves.toEqual({
      kind: "onchain_actionable",
      shares: 4.2,
      minShares: 1,
    });
  });

  it("classifies omitted zero-balance tokens as on-chain zero", async () => {
    await expect(
      classifyPositionActionability({
        tokenId: "token-stale",
        dataApiPositions: [],
        readOnchainShares: vi.fn().mockResolvedValue(0),
        readMarketConstraints: vi.fn(),
      })
    ).resolves.toEqual({
      kind: "onchain_zero",
      shares: 0,
    });
  });

  it("keeps positions unclassified when an authority read fails", async () => {
    await expect(
      classifyPositionActionability({
        tokenId: "token-rpc-failure",
        dataApiPositions: [],
        readOnchainShares: vi.fn().mockRejectedValue(new Error("rpc down")),
        readMarketConstraints: vi.fn(),
      })
    ).resolves.toEqual({
      kind: "upstream_error",
      message: "rpc down",
    });
  });
});
