// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/observation-helpers` tests
 * Purpose: Pin DEDUPE_BEFORE_UPSERT semantics (last-write-wins by composite key).
 * Scope: Pure-fn unit coverage.
 * @internal
 */

import { describe, expect, it } from "vitest";
import { dedupeByKey } from "@/features/wallet-analysis/server/observation-helpers";

describe("dedupeByKey", () => {
  it("returns the input unchanged when no duplicates", () => {
    const out = dedupeByKey(
      [
        { t: 1, p: 1 },
        { t: 2, p: 2 },
      ],
      (r) => r.t
    );
    expect(out).toEqual([
      { t: 1, p: 1 },
      { t: 2, p: 2 },
    ]);
  });

  it("keeps the LAST occurrence on duplicate keys (bug.5011 — current bucket twice)", () => {
    const out = dedupeByKey(
      [
        { t: 1, p: 1 },
        { t: 2, p: 2 },
        { t: 2, p: 99 },
      ],
      (r) => r.t
    );
    expect(out).toEqual([
      { t: 1, p: 1 },
      { t: 2, p: 99 },
    ]);
  });

  it("supports composite keys via tuple-shaped keyFn", () => {
    const out = dedupeByKey(
      [
        { wallet: "A", fidelity: "1h", ts: 100, p: 1 },
        { wallet: "A", fidelity: "1d", ts: 100, p: 2 },
        { wallet: "A", fidelity: "1h", ts: 100, p: 99 },
      ],
      (r) => `${r.wallet}|${r.fidelity}|${r.ts}`
    );
    expect(out).toEqual([
      { wallet: "A", fidelity: "1d", ts: 100, p: 2 },
      { wallet: "A", fidelity: "1h", ts: 100, p: 99 },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(dedupeByKey([], (r) => r)).toEqual([]);
  });
});
