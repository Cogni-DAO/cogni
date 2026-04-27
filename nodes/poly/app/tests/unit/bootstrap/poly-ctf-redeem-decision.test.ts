// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `tests/unit/bootstrap/poly-ctf-redeem-decision`
 * Purpose: Drive the new `decideRedeem` policy
 *   (`@cogni/market-provider/policy/redeem`) from the captured Polymarket +
 *   Polygon decision-table fixture (one assertion per real-chain row).
 *   Ensures the policy reproduces the exact decisions for the historical
 *   snapshot — the bug.0383 corpus in real-chain form.
 * Scope: Pure decision function only. No RPC, no mocks. Imports from the
 *   policy package (not the executor) to assert the call-site refactor in
 *   task.0387 keeps the same per-row decisions on identical inputs.
 * Side-effects: reads JSON fixture from disk at test time.
 * Links: work/items/bug.0383, work/items/task.0387
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideRedeem,
  REDEEM_PARENT_COLLECTION_ID_ZERO,
  type RedeemDecision,
} from "@cogni/market-provider/policy";
import { describe, expect, it } from "vitest";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/poly-ctf-redeem"
);

interface DecisionCase {
  conditionId: string;
  asset: string;
  outcomeIndex: number;
  negativeRisk: boolean;
  title: string;
  inputs: {
    balanceOf_funder_heldAsset: number | null;
    payoutNumerator_heldIdx: number | null;
    payoutDenominator: number | null;
  };
  expected: {
    action: "redeem" | "skip";
    skipReason: "zero_balance" | "losing_outcome" | "read_failed" | null;
  };
}

interface DecisionFixture {
  _meta: { snapshot: string; funder: string; block: number };
  summary: {
    total: number;
    byAction: { redeem?: number; skip?: number };
    winnersDetected: string[];
  };
  cases: DecisionCase[];
}

function loadFixture(date: string): DecisionFixture {
  const path = join(FIXTURE_DIR, `expected-decisions.snapshot-${date}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as DecisionFixture;
}

/** Derive the new-shape expected decision from the legacy fixture row.
 *
 * Encoded knowledge (NOT a re-implementation of the policy — these are the
 * documented behavioral promises the policy commits to and the call-site
 * refactor must preserve):
 *   - balance === 0 ⇒ skip:zero_balance (regardless of resolution state)
 *   - payoutDenominator === 0 ⇒ skip:market_not_resolved
 *     (this is the SEMANTIC SHIFT vs. legacy decideRedeem, which collapsed
 *      `payD=0,payN=0` rows into `losing_outcome`; the new policy classifies
 *      them as "CTF has not yet recorded resolution despite Data-API hint")
 *   - balance > 0, payD > 0, payN === 0 ⇒ skip:losing_outcome
 *   - balance > 0, payD > 0, payN > 0 ⇒ redeem
 *     - negativeRisk:true ⇒ flavor=neg-risk-parent, indexSet=[1<<outcomeIndex]
 *     - negativeRisk:false, slotCount=2 ⇒ flavor=binary, indexSet=[1n,2n]
 */
function expectedForFixtureCase(c: DecisionCase): RedeemDecision {
  const bal = BigInt(c.inputs.balanceOf_funder_heldAsset ?? 0);
  const num = BigInt(c.inputs.payoutNumerator_heldIdx ?? 0);
  const den = BigInt(c.inputs.payoutDenominator ?? 0);

  if (bal === 0n) return { kind: "skip", reason: "zero_balance" };
  if (den === 0n) return { kind: "skip", reason: "market_not_resolved" };
  if (num === 0n) return { kind: "skip", reason: "losing_outcome" };

  const expectedShares = bal;
  const expectedPayoutUsdc = (bal * num) / den;

  if (c.negativeRisk) {
    return {
      kind: "redeem",
      flavor: "neg-risk-parent",
      parentCollectionId: REDEEM_PARENT_COLLECTION_ID_ZERO,
      indexSet: [1n << BigInt(c.outcomeIndex)],
      expectedShares,
      expectedPayoutUsdc,
    };
  }

  // Binary fixture: every non-neg-risk row is `outcomeSlotCount === 2`.
  return {
    kind: "redeem",
    flavor: "binary",
    parentCollectionId: REDEEM_PARENT_COLLECTION_ID_ZERO,
    indexSet: [1n, 2n],
    expectedShares,
    expectedPayoutUsdc,
  };
}

describe("decideRedeem against real-Polygon-mainnet fixture (bug.0383 + task.0387)", () => {
  const fixture = loadFixture("2026-04-25");

  it("snapshot meta is sane", () => {
    expect(fixture.summary.total).toBe(fixture.cases.length);
    expect(fixture.summary.total).toBeGreaterThan(0);
    expect(fixture.summary.byAction.redeem).toBeGreaterThan(0);
    expect(fixture.summary.byAction.skip).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`[fixture] negRisk=${String(c.negativeRisk).padEnd(5)} idx=${c.outcomeIndex} payD=${c.inputs.payoutDenominator}  ${c.title}`, () => {
      // Binary CTF (incl. neg-risk children) always has outcomeSlotCount=2.
      const decision = decideRedeem({
        balance:
          c.inputs.balanceOf_funder_heldAsset === null
            ? null
            : BigInt(c.inputs.balanceOf_funder_heldAsset),
        payoutNumerator:
          c.inputs.payoutNumerator_heldIdx === null
            ? null
            : BigInt(c.inputs.payoutNumerator_heldIdx),
        payoutDenominator:
          c.inputs.payoutDenominator === null
            ? null
            : BigInt(c.inputs.payoutDenominator),
        outcomeIndex: c.outcomeIndex,
        outcomeSlotCount: 2,
        negativeRisk: c.negativeRisk,
      });
      const expected = expectedForFixtureCase(c);
      expect(decision).toEqual(expected);
    });
  }

  it("all winners in fixture are neg-risk and emit flavor=neg-risk-parent (bug.0384 fix)", () => {
    const winnerDecisions = fixture.cases
      .filter((c) => c.expected.action === "redeem")
      .map((c) => ({
        title: c.title,
        decision: decideRedeem({
          balance: BigInt(c.inputs.balanceOf_funder_heldAsset ?? 0),
          payoutNumerator: BigInt(c.inputs.payoutNumerator_heldIdx ?? 0),
          payoutDenominator: BigInt(c.inputs.payoutDenominator ?? 0),
          outcomeIndex: c.outcomeIndex,
          outcomeSlotCount: 2,
          negativeRisk: c.negativeRisk,
        }),
      }));
    expect(winnerDecisions.length).toBeGreaterThan(0);
    for (const w of winnerDecisions) {
      if (w.decision.kind !== "redeem") {
        throw new Error(`expected redeem for ${w.title}`);
      }
      expect(w.decision.flavor).toBe("neg-risk-parent");
      // The bleed: legacy code emitted [1n, 2n] here. The new policy must NOT.
      expect(w.decision.indexSet).not.toEqual([1n, 2n]);
      expect(w.decision.indexSet.length).toBe(1);
    }
  });
});
