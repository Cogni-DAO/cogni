// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/core/redeem/error-classification
 * Purpose: Unit coverage for the redeem-tx error classifier.
 * Scope: Pure logic. No DB, no chain, no time.
 * Links: src/core/redeem/error-classification.ts, work/items/bug.5041
 */

import { describe, expect, it } from "vitest";

import { classifyRedeemError } from "@/core";

describe("classifyRedeemError: chain reverts (consume retry budget)", () => {
  it("classifies execution-reverted with empty data as chain_revert", () => {
    expect(
      classifyRedeemError({
        reason: "execution reverted",
        data: "0x",
        shortMessage: 'The contract function "redeemPositions" reverted.',
      })
    ).toBe("chain_revert");
  });

  it("classifies decoded Error(string) revert data as chain_revert", () => {
    expect(
      classifyRedeemError({
        reason: "result mismatch",
        data: "0x08c379a0000000000000000000000000",
        shortMessage: "ContractFunctionRevertedError",
      })
    ).toBe("chain_revert");
  });

  it("classifies revert with reason but no data as chain_revert", () => {
    expect(
      classifyRedeemError({
        reason: "execution reverted",
        data: null,
        shortMessage: "redeemPositions reverted on chain",
      })
    ).toBe("chain_revert");
  });

  it('classifies viem shortMessage "The contract function ... reverted" as chain_revert when reason missing', () => {
    expect(
      classifyRedeemError({
        reason: null,
        data: null,
        shortMessage: 'The contract function "redeemPositions" reverted.',
      })
    ).toBe("chain_revert");
  });
});

describe("classifyRedeemError: rpc_transient (no structured chain-revert signals)", () => {
  it('classifies Alchemy "Missing or invalid parameters" as rpc_transient', () => {
    expect(
      classifyRedeemError({
        reason: null,
        data: null,
        shortMessage:
          "Missing or invalid parameters.\nDouble check you have provided the correct parameters.",
      })
    ).toBe("rpc_transient");
  });

  it("classifies an empty error shape as rpc_transient", () => {
    expect(
      classifyRedeemError({
        reason: null,
        data: null,
        shortMessage: "",
      })
    ).toBe("rpc_transient");
  });

  it("classifies any non-chain-shaped error as rpc_transient", () => {
    expect(
      classifyRedeemError({
        reason: null,
        data: null,
        shortMessage: "an entirely new failure shape we have not seen yet",
      })
    ).toBe("rpc_transient");
  });
});

describe("classifyRedeemError: chain_revert wins over rpc-shaped messages", () => {
  it("classifies a tx with both decoded reason AND rpc-style shortMessage as chain_revert", () => {
    expect(
      classifyRedeemError({
        reason: "execution reverted",
        data: "0x",
        shortMessage: "Missing or invalid parameters.",
      })
    ).toBe("chain_revert");
  });
});
