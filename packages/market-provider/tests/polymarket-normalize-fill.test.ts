// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/polymarket-normalize-fill`
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
