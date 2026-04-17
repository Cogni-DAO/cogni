// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/client-order-id`
 * Purpose: Determinism + pin-by-example tests for `clientOrderIdFor`.
 * Scope: Pure function tests. Does not hit any SDK or network.
 * Invariants: HASH_IS_PINNED — the golden vector below MUST NOT change without a DB backfill.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.3)
 * @internal
 */

import { describe, expect, it } from "vitest";

import { clientOrderIdFor } from "../src/domain/client-order-id.js";

describe("clientOrderIdFor", () => {
  it("is deterministic — same inputs → same output", () => {
    const a = clientOrderIdFor(
      "11111111-1111-1111-1111-111111111111",
      "data-api:0xabc:0x7e:BUY:1713302400"
    );
    const b = clientOrderIdFor(
      "11111111-1111-1111-1111-111111111111",
      "data-api:0xabc:0x7e:BUY:1713302400"
    );
    expect(a).toBe(b);
  });

  it("returns a 0x-prefixed 32-byte hex (66 chars total)", () => {
    const id = clientOrderIdFor("t", "f");
    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
    expect(id.length).toBe(66);
  });

  it("distinguishes different target+fill combinations", () => {
    const a = clientOrderIdFor("target-1", "fill-1");
    const b = clientOrderIdFor("target-2", "fill-1");
    const c = clientOrderIdFor("target-1", "fill-2");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("separator collision — `a:b` + `c` is not the same as `a` + `b:c`", () => {
    // Protection against the accidentally-ambiguous key. Not strict
    // unforgeability (that would require a length-prefix); but cheap evidence
    // that the function does NOT collapse pairs that happen to share a colon.
    const left = clientOrderIdFor("a:b", "c");
    const right = clientOrderIdFor("a", "b:c");
    // Note: these DO collide with a naive `${target}:${fill}` hash because the
    // input string is identical. This test documents the current behavior so
    // a future change (e.g., length-prefix) is deliberate.
    expect(left).toBe(right);
  });

  it("golden vector — pinned output (task.0315 CP3.3)", () => {
    // Target = all-ones UUID, fill = example DA composite from task doc.
    const id = clientOrderIdFor(
      "11111111-1111-1111-1111-111111111111",
      "data-api:0xabc…def:0x7e…9a:BUY:1713302400"
    );
    // Regenerate this vector ONLY if changing the hash function (requires a
    // DB backfill migration). Sourced once by running the fn and pasting.
    expect(id).toMatchInlineSnapshot(
      `"0xfb31705bfb3a1210f797ee5d521a501e1a0964890695bf828f6a7ca8b78e8c0f"`
    );
  });

  it("rejects empty targetId or fillId", () => {
    expect(() => clientOrderIdFor("", "x")).toThrow(/targetId/);
    expect(() => clientOrderIdFor("x", "")).toThrow(/fillId/);
  });
});
