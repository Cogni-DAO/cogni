// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/wallet-analysis/derive-current-position-status
 * Purpose: Lock the bug.5008 invariant — `deriveCurrentPositionStatus` is
 *   chain-driven via `poly_market_outcomes.outcome` (winner | loser) plus
 *   ledger `lifecycleState`; it never consults Polymarket Data-API
 *   `raw.redeemable`. The function signature itself enforces this — there is
 *   no `redeemable: boolean` parameter to pass.
 * Scope: Pure helper unit test. No I/O.
 * Links: docs/spec/poly-copy-trade-execution.md, bug.5008
 */

import { describe, expect, it } from "vitest";

import { deriveCurrentPositionStatus } from "@/features/wallet-analysis/server/current-position-read-model";

describe("deriveCurrentPositionStatus (bug.5008)", () => {
  it("returns 'closed' when chain says loser, regardless of currentValue", () => {
    expect(
      deriveCurrentPositionStatus({
        currentValue: 25,
        marketOutcome: "loser",
        lifecycleState: null,
      })
    ).toBe("closed");
  });

  it("returns 'redeemable' when chain says winner", () => {
    expect(
      deriveCurrentPositionStatus({
        currentValue: 100,
        marketOutcome: "winner",
        lifecycleState: null,
      })
    ).toBe("redeemable");
  });

  it("treats winner via ledger lifecycle as redeemable when chain row missing", () => {
    expect(
      deriveCurrentPositionStatus({
        currentValue: 100,
        marketOutcome: null,
        lifecycleState: "winner",
      })
    ).toBe("redeemable");
  });

  it("returns 'closed' for position-terminal lifecycles regardless of marketOutcome=null", () => {
    for (const lifecycleState of [
      "redeemed",
      "loser",
      "dust",
      "closed",
    ] as const) {
      expect(
        deriveCurrentPositionStatus({
          currentValue: 100,
          marketOutcome: null,
          lifecycleState,
        })
      ).toBe("closed");
    }
  });

  it("treats lifecycleState='abandoned' as job-state, NOT position-terminal (bug.5040)", () => {
    // The redeem-job pipeline gave up on a tx flow (e.g. 3 transient submission
    // failures), but the SHARES ARE STILL ON CHAIN. Dashboard must not zero
    // currentValue on this signal alone — chain authority decides.
    //
    // No chain outcome yet: still-held shares fall through to "open".
    expect(
      deriveCurrentPositionStatus({
        currentValue: 74.27,
        marketOutcome: null,
        lifecycleState: "abandoned",
      })
    ).toBe("open");

    // Chain says winner + job abandoned: REDEEMABLE — user owns the cash,
    // worker just couldn't submit the tx. This is the case that hid \$500
    // of real winnings on dashboard before the fix.
    expect(
      deriveCurrentPositionStatus({
        currentValue: 74.27,
        marketOutcome: "winner",
        lifecycleState: "abandoned",
      })
    ).toBe("redeemable");

    // Chain says loser + job abandoned: shares are worthless, dashboard
    // correctly closes them. Chain authority dominates.
    expect(
      deriveCurrentPositionStatus({
        currentValue: 0,
        marketOutcome: "loser",
        lifecycleState: "abandoned",
      })
    ).toBe("closed");
  });

  it("chain winner + lifecycleState='redeemed' = closed (PayoutRedemption observed)", () => {
    // Once the on-chain `PayoutRedemption` event fires for our funder, the
    // subscriber sets lifecycleState='redeemed'. The cash is now in the
    // wallet's pUSD/USDC.e balance — position is genuinely gone.
    expect(
      deriveCurrentPositionStatus({
        currentValue: 0,
        marketOutcome: "winner",
        lifecycleState: "redeemed",
      })
    ).toBe("closed");
  });

  it("returns 'open' when nothing has resolved and lifecycle is null", () => {
    expect(
      deriveCurrentPositionStatus({
        currentValue: 12.5,
        marketOutcome: null,
        lifecycleState: null,
      })
    ).toBe("open");
  });

  it("returns 'closed' when currentValue is zero and no resolution evidence", () => {
    expect(
      deriveCurrentPositionStatus({
        currentValue: 0,
        marketOutcome: null,
        lifecycleState: null,
      })
    ).toBe("closed");
  });

  it("treats marketOutcome='unknown' as no chain evidence — does NOT mark redeemable", () => {
    // Reaffirms that only 'winner' triggers redeemable; 'unknown' (zero balance,
    // read failure) must fall through to lifecycle/value rules.
    expect(
      deriveCurrentPositionStatus({
        currentValue: 50,
        marketOutcome: "unknown",
        lifecycleState: null,
      })
    ).toBe("open");
  });

  it("loser outcome wins over lifecycleState='winner' (chain is authoritative)", () => {
    // Defensive: if the redeem job lifecycle was somehow written as winner but
    // the chain UPSERT later corrected to loser, the chain row must win.
    expect(
      deriveCurrentPositionStatus({
        currentValue: 100,
        marketOutcome: "loser",
        lifecycleState: "winner",
      })
    ).toBe("closed");
  });
});
