// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/polymarket-ctf`
 * Purpose: Unit tests for Polygon condition id normalization used before CTF redeem.
 * Scope: `normalizePolygonConditionId` only. Does not hit RPC or chain.
 * Invariants: Valid ids are 32-byte hex.
 * Side-effects: none
 * Links: packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  normalizePolygonConditionId,
  polymarketCtfRedeemAbi,
} from "../src/adapters/polymarket/polymarket.ctf.js";

describe("normalizePolygonConditionId", () => {
  const valid =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("accepts 0x-prefixed 32-byte hex", () => {
    expect(normalizePolygonConditionId(valid)).toBe(valid);
  });

  it("adds 0x when missing", () => {
    expect(normalizePolygonConditionId(valid.slice(2))).toBe(valid);
  });

  it("throws on wrong length", () => {
    expect(() => normalizePolygonConditionId("0xabc")).toThrow(
      /expected 32-byte hex/
    );
  });
});

describe("polymarketCtfRedeemAbi", () => {
  it("exposes payoutNumerators(bytes32, uint256) view returning uint256", () => {
    const fragment = polymarketCtfRedeemAbi.find(
      (x) => x.type === "function" && x.name === "payoutNumerators"
    );
    expect(fragment).toBeDefined();
    if (!fragment || fragment.type !== "function") throw new Error("bad");
    expect(fragment.stateMutability).toBe("view");
    expect(fragment.inputs.map((i) => i.type)).toEqual(["bytes32", "uint256"]);
    expect(fragment.outputs.map((o) => o.type)).toEqual(["uint256"]);
  });

  it("retains balanceOf and redeemPositions fragments", () => {
    const names = polymarketCtfRedeemAbi
      .filter((x) => x.type === "function")
      .map((x) => (x as { name: string }).name);
    expect(names).toContain("balanceOf");
    expect(names).toContain("redeemPositions");
    expect(names).toContain("payoutNumerators");
  });
});
