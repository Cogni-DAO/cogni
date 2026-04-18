// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/poly-place-trade`
 * Purpose: Unit tests for the core__poly_place_trade tool — contract, input/output schemas, implementation factory, and stub behavior.
 * Scope: Shape + behavior of the tool contract and factory. Does not hit the CLOB, does not exercise the capability implementation.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_TYPED, REDACTION_REQUIRED, BUY_ONLY.
 * Side-effects: none
 * Links: src/tools/poly-place-trade.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import {
  createPolyPlaceTradeImplementation,
  POLY_PLACE_TRADE_NAME,
  PolyPlaceTradeInputSchema,
  type PolyPlaceTradeOutput,
  PolyPlaceTradeOutputSchema,
  type PolyTradeCapability,
  polyPlaceTradeBoundTool,
  polyPlaceTradeContract,
  polyPlaceTradeStubImplementation,
} from "../src/tools/poly-place-trade";

const VALID_INPUT = {
  conditionId:
    "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
  tokenId:
    "45953877158527602938687517048564712668969366599892180145846810423614781133361",
  outcome: "Yes",
  size_usdc: 5,
  limit_price: 0.6,
};

const RECEIPT: PolyPlaceTradeOutput = {
  order_id:
    "0xb14daf06cc2bd1858305dcbda9b4129387a444b0055a57f7dc0510b816207ca9",
  client_order_id:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  status: "open",
  filled_size_usdc: 0,
  submitted_at: "2026-04-17T17:34:36.074Z",
  profile_url:
    "https://polymarket.com/profile/0xdcca8d85603c2cc47dc6974a790df846f8695056",
};

describe("core__poly_place_trade contract", () => {
  it("has the namespaced tool ID", () => {
    expect(polyPlaceTradeContract.name).toBe("core__poly_place_trade");
    expect(POLY_PLACE_TRADE_NAME).toBe("core__poly_place_trade");
  });

  it("declares external_side_effect (real money moves)", () => {
    expect(polyPlaceTradeContract.effect).toBe("external_side_effect");
  });

  it("exposes the bound tool with a stub that refuses to run", async () => {
    expect(polyPlaceTradeBoundTool.contract.name).toBe(POLY_PLACE_TRADE_NAME);
    await expect(
      polyPlaceTradeStubImplementation.execute(VALID_INPUT, {})
    ).rejects.toThrow(/stub invoked/);
  });

  it("allowlist excludes none of the documented output fields", () => {
    const fields = Object.keys(PolyPlaceTradeOutputSchema.shape);
    for (const f of fields) {
      expect(polyPlaceTradeContract.allowlist).toContain(f);
    }
  });
});

describe("PolyPlaceTradeInputSchema", () => {
  it("accepts a well-formed input", () => {
    expect(PolyPlaceTradeInputSchema.parse(VALID_INPUT)).toEqual(VALID_INPUT);
  });

  it("rejects malformed conditionId (missing 0x or wrong length)", () => {
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, conditionId: "abc" })
    ).toThrow();
    expect(() =>
      PolyPlaceTradeInputSchema.parse({
        ...VALID_INPUT,
        conditionId: "0xdeadbeef",
      })
    ).toThrow();
  });

  it("rejects size_usdc above the 25 USDC prototype cap", () => {
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, size_usdc: 26 })
    ).toThrow();
  });

  it("rejects limit_price outside the strict (0,1) range", () => {
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, limit_price: 0 })
    ).toThrow();
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, limit_price: 1 })
    ).toThrow();
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, limit_price: 1.5 })
    ).toThrow();
  });

  it("rejects empty tokenId / outcome", () => {
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, tokenId: "" })
    ).toThrow();
    expect(() =>
      PolyPlaceTradeInputSchema.parse({ ...VALID_INPUT, outcome: "" })
    ).toThrow();
  });
});

describe("createPolyPlaceTradeImplementation", () => {
  function makeCapability(receipt: PolyPlaceTradeOutput = RECEIPT): {
    cap: PolyTradeCapability;
    placeTrade: ReturnType<typeof vi.fn>;
  } {
    const placeTrade = vi.fn().mockResolvedValue(receipt);
    return { cap: { placeTrade }, placeTrade };
  }

  it("forwards the input to the capability with BUY-only side — tool does NOT generate client_order_id", async () => {
    const { cap, placeTrade } = makeCapability();
    const impl = createPolyPlaceTradeImplementation({
      polyTradeCapability: cap,
    });

    const out = await impl.execute(VALID_INPUT, {});

    expect(placeTrade).toHaveBeenCalledOnce();
    const request = placeTrade.mock.calls[0]?.[0];
    expect(request.side).toBe("BUY");
    expect(request.conditionId).toBe(VALID_INPUT.conditionId);
    expect(request.tokenId).toBe(VALID_INPUT.tokenId);
    expect(request.outcome).toBe(VALID_INPUT.outcome);
    expect(request.size_usdc).toBe(VALID_INPUT.size_usdc);
    expect(request.limit_price).toBe(VALID_INPUT.limit_price);
    // client_order_id is NOT in the request — it's the capability's
    // responsibility to generate via the pinned clientOrderIdFor helper.
    expect("client_order_id" in request).toBe(false);
    expect(out).toEqual(RECEIPT);
  });

  it("output matches the PolyPlaceTradeOutputSchema", async () => {
    const { cap } = makeCapability();
    const impl = createPolyPlaceTradeImplementation({
      polyTradeCapability: cap,
    });
    const out = await impl.execute(VALID_INPUT, {});
    // Defensive — if the capability ever drifts (extra field, wrong type),
    // this catches it at the tool boundary rather than leaking to the agent.
    expect(() => PolyPlaceTradeOutputSchema.parse(out)).not.toThrow();
  });

  it("propagates capability errors to the caller", async () => {
    const placeTrade = vi
      .fn()
      .mockRejectedValue(new Error("CLOB rejected order"));
    const impl = createPolyPlaceTradeImplementation({
      polyTradeCapability: { placeTrade },
    });
    await expect(impl.execute(VALID_INPUT, {})).rejects.toThrow(
      /CLOB rejected/
    );
  });
});
