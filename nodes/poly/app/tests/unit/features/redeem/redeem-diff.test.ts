// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-diff
 * Purpose: Pin the Layer-3 position-diff predicate. Steady state must be
 *   the empty set (chain-log catchup already classified every condition);
 *   fresh funders must self-bootstrap (known = ∅ ⇒ diff = api); stale
 *   `unresolved`/`resolving` rows must reappear in the diff so the lagged
 *   Data-API resolution case is recovered. (bug.5028)
 * Scope: Pure logic. No IO, no DB, no chain.
 * Links: src/features/redeem/redeem-diff.ts, work/items/bug.5028
 */

import { describe, expect, it } from "vitest";

import { computeRedeemDiff } from "@/features/redeem/redeem-diff";
import type { KnownRedeemCondition } from "@/ports";

const C = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const known = (
  conditionId: `0x${string}`,
  lifecycleState: KnownRedeemCondition["lifecycleState"],
  enqueuedAtMs: number
): KnownRedeemCondition => ({
  conditionId,
  lifecycleState,
  enqueuedAt: new Date(enqueuedAtMs),
});

describe("computeRedeemDiff", () => {
  it("returns empty when api ⊆ known and no stale-unresolved", () => {
    const now = new Date("2026-05-06T00:00:00Z");
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2), C(3)]),
      known: [
        known(C(1), "winner", now.getTime() - 1000),
        known(C(2), "loser", now.getTime() - 2000),
        known(C(3), "redeemed", now.getTime() - 3000),
      ],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff.size).toBe(0);
  });

  it("self-bootstraps a fresh funder (known = ∅ ⇒ diff = api)", () => {
    const now = new Date();
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2), C(3)]),
      known: [],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff).toEqual(new Set([C(1), C(2), C(3)]));
  });

  it("includes only the new conditions (api ∖ known)", () => {
    const now = new Date();
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2), C(3), C(4)]),
      known: [
        known(C(1), "winner", now.getTime() - 1000),
        known(C(2), "loser", now.getTime() - 1000),
      ],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff).toEqual(new Set([C(3), C(4)]));
  });

  it("re-includes stale unresolved rows older than threshold", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    const sevenHoursAgoMs = now.getTime() - 7 * 60 * 60 * 1000;
    const oneHourAgoMs = now.getTime() - 1 * 60 * 60 * 1000;
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2)]),
      known: [
        // Stale-unresolved → must be re-classified
        known(C(1), "unresolved", sevenHoursAgoMs),
        // Recent-unresolved → not stuck yet, leave alone
        known(C(2), "resolving", oneHourAgoMs),
      ],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff).toEqual(new Set([C(1)]));
  });

  it("includes both new and stale-unresolved (union)", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    const eightHoursAgoMs = now.getTime() - 8 * 60 * 60 * 1000;
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2), C(3)]),
      known: [known(C(1), "unresolved", eightHoursAgoMs)],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff).toEqual(new Set([C(1), C(2), C(3)]));
  });

  it("does not include terminal lifecycle rows even if old", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    const tenDaysAgoMs = now.getTime() - 10 * 24 * 60 * 60 * 1000;
    const diff = computeRedeemDiff({
      apiConditionIds: new Set([C(1), C(2), C(3)]),
      known: [
        known(C(1), "winner", tenDaysAgoMs),
        known(C(2), "loser", tenDaysAgoMs),
        known(C(3), "redeemed", tenDaysAgoMs),
      ],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(diff.size).toBe(0);
  });

  it("returns empty when api is empty even with stale-unresolved present", () => {
    // Funder has no current positions; nothing to (re)classify.
    // Stale rows are still stale but their condition is no longer held.
    const now = new Date("2026-05-06T12:00:00Z");
    const eightHoursAgoMs = now.getTime() - 8 * 60 * 60 * 1000;
    const diff = computeRedeemDiff({
      apiConditionIds: new Set(),
      known: [known(C(1), "unresolved", eightHoursAgoMs)],
      staleUnresolvedMs: 6 * 60 * 60 * 1000,
      now,
    });
    // Stale-unresolved still adds C(1) to the diff — that is intentional;
    // we want to re-classify a stuck condition even after it falls out of
    // the active position list (e.g. fully exited but never redeemed).
    expect(diff).toEqual(new Set([C(1)]));
  });
});
