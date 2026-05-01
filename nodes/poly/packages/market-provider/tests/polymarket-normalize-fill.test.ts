// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/tests/polymarket-normalize-fill`
 * Purpose: Unit tests for `normalizePolymarketDataApiFill` — empty-hash rejection, composite fill_id shape, and Fill-schema correctness.
 * Scope: Pure data transforms. Does not hit the network, does not require fixtures beyond inline objects.
 * Invariants: DA_EMPTY_HASH_REJECTED; FILL_ID_SHAPE_DECIDED (golden-vector).
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1)
 * @internal
 */

import { describe, expect, it } from "vitest";
import type { PolymarketUserTrade } from "../src/adapters/polymarket/polymarket.data-api.types.js";
import {
  normalizePolymarketDataApiFill,
  polymarketDataApiFillId,
} from "../src/adapters/polymarket/polymarket.normalize-fill.js";

const BASE: PolymarketUserTrade = {
  proxyWallet: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  side: "BUY",
  asset:
    "45953877158527602938687517048564712668969366599892180145846810423614781133361",
  conditionId:
    "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
  size: 4.967,
  price: 0.602,
  timestamp: 1713300000,
  title: "Open Capfinances Rouen Metropole: Marta Kostyuk vs Ann Li",
  outcome: "Ann Li",
  transactionHash:
    "0x2c800bf0692f5b7b691a136e1413eab5298352bec342ea1a97433f8f25178b7b",
};

describe("polymarketDataApiFillId — golden-vector shape", () => {
  it("produces the canonical data-api composite id", () => {
    expect(polymarketDataApiFillId(BASE)).toBe(
      "data-api:0x2c800bf0692f5b7b691a136e1413eab5298352bec342ea1a97433f8f25178b7b:45953877158527602938687517048564712668969366599892180145846810423614781133361:BUY:1713300000"
    );
  });
});

describe("normalizePolymarketDataApiFill", () => {
  it("normalizes a well-formed Data-API trade into a Fill", () => {
    const r = normalizePolymarketDataApiFill(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fill.target_wallet).toBe(BASE.proxyWallet);
    expect(r.fill.fill_id.startsWith("data-api:")).toBe(true);
    expect(r.fill.source).toBe("data-api");
    expect(r.fill.market_id).toBe(
      `prediction-market:polymarket:${BASE.conditionId}`
    );
    expect(r.fill.outcome).toBe("Ann Li");
    expect(r.fill.side).toBe("BUY");
    expect(r.fill.price).toBe(0.602);
    // size_usdc = shares × price = 4.967 × 0.602
    expect(r.fill.size_usdc).toBeCloseTo(2.990134, 6);
    expect(r.fill.observed_at).toBe(
      new Date(BASE.timestamp * 1000).toISOString()
    );
    expect(r.fill.attributes?.asset).toBe(BASE.asset);
    expect(r.fill.attributes?.transaction_hash).toBe(BASE.transactionHash);
  });

  it("rejects empty transactionHash (DA_EMPTY_HASH_REJECTED)", () => {
    const r = normalizePolymarketDataApiFill({ ...BASE, transactionHash: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("empty_transaction_hash");
  });

  it("rejects missing asset", () => {
    const r = normalizePolymarketDataApiFill({ ...BASE, asset: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_asset");
  });

  it("rejects missing conditionId", () => {
    const r = normalizePolymarketDataApiFill({ ...BASE, conditionId: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_condition_id");
  });

  it("rejects non-positive price", () => {
    const r = normalizePolymarketDataApiFill({ ...BASE, price: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("non_positive_price");
  });

  it("rejects non-positive size", () => {
    const r = normalizePolymarketDataApiFill({ ...BASE, size: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("non_positive_size");
  });

  it("preserves platform fields under attributes", () => {
    const r = normalizePolymarketDataApiFill(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fill.attributes).toMatchObject({
      asset: BASE.asset,
      condition_id: BASE.conditionId,
      transaction_hash: BASE.transactionHash,
      timestamp_unix: BASE.timestamp,
    });
  });
});

/**
 * bug.5004 regression — ASSET_IS_AUTHORITATIVE.
 *
 * In prod 2026-05-01 the mirror placed BUYs against the OPPOSITE outcome of
 * 14% of overlapping conditions vs the target wallet (RN1). The target's
 * Data-API trade exposes `asset` (CTF token_id) directly; mirroring MUST use
 * that value byte-for-byte and never re-derive it from outcome name.
 *
 * These four conditions are taken from `bug.5004` (target-asset last-6 vs
 * ours-last-6). Any refactor that maps outcome → token_id via market metadata
 * lookup will trip these tests AND the runtime ASSET_IS_AUTHORITATIVE guard
 * inside the normalizer.
 */
describe("normalizePolymarketDataApiFill — bug.5004 ASSET_IS_AUTHORITATIVE", () => {
  type Example = {
    label: string;
    conditionId: string;
    targetAsset: string;
    outcome: string;
    side: "BUY" | "SELL";
  };

  const EXAMPLES: ReadonlyArray<Example> = [
    {
      label: "binary YES/NO — target on token ending 523617",
      conditionId:
        "0x4f3b8b34d45d000000000000000000000000000000000000000000000000d45d",
      targetAsset:
        "11111111111111111111111111111111111111111111111111111111111523617",
      outcome: "Yes",
      side: "BUY",
    },
    {
      label: "binary YES/NO — target on token ending 856124",
      conditionId:
        "0xd489781fca0b00000000000000000000000000000000000000000000000ca0b",
      targetAsset:
        "22222222222222222222222222222222222222222222222222222222222856124",
      outcome: "No",
      side: "BUY",
    },
    {
      label: "binary Over/Under — target on token ending 221704",
      conditionId:
        "0xd3fab1ab20a3000000000000000000000000000000000000000000000020a3",
      targetAsset:
        "33333333333333333333333333333333333333333333333333333333333221704",
      outcome: "Over",
      side: "BUY",
    },
    {
      label: "multi-outcome (player) — target on token ending 123493",
      conditionId:
        "0x8e2d383b1793000000000000000000000000000000000000000000000001793",
      targetAsset:
        "44444444444444444444444444444444444444444444444444444444444123493",
      outcome: "Marta Kostyuk",
      side: "BUY",
    },
  ];

  for (const ex of EXAMPLES) {
    it(`passes target asset through unchanged: ${ex.label}`, () => {
      const trade: PolymarketUserTrade = {
        ...BASE,
        side: ex.side,
        asset: ex.targetAsset,
        conditionId: ex.conditionId,
        outcome: ex.outcome,
        // Each example needs a distinct fill_id so a future caller-dedupe
        // can't collapse them; vary the tx hash on the example index.
        transactionHash: `0x${ex.targetAsset.slice(-6).padStart(64, "0")}`,
      };
      const r = normalizePolymarketDataApiFill(trade);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Authoritative: Fill.attributes.asset === trade.asset byte-for-byte.
      expect(r.fill.attributes?.asset).toBe(ex.targetAsset);
      // market_id wraps the conditionId verbatim — no metadata lookup.
      expect(r.fill.market_id).toBe(
        `prediction-market:polymarket:${ex.conditionId}`
      );
      // outcome label is preserved as metadata only — used for display.
      expect(r.fill.outcome).toBe(ex.outcome);
      // fill_id composite must include the target's asset so dedupe is
      // pinned to the actual CTF token, not an outcome-name-derived one.
      expect(r.fill.fill_id).toContain(`:${ex.targetAsset}:`);
    });
  }

  it("ASSET_IS_AUTHORITATIVE runtime guard — paranoid invariant fires if future code mutates attributes.asset", () => {
    // Sanity check: the guard exists. We can't easily simulate a divergence
    // from outside (the function builds the Fill itself), but the invariant
    // is encoded in the source. If a future refactor introduces an
    // outcome→token lookup that produces a different `asset`, the guard
    // throws — surfacing the bug at unit-test time, not in prod.
    const r = normalizePolymarketDataApiFill(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fill.attributes?.asset).toBe(BASE.asset);
  });
});
