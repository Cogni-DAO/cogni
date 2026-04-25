// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `tests/unit/bootstrap/poly-ctf-redeem-decision`
 * Purpose: Drive `decideRedeem` from the captured Polymarket+Polygon
 *   decision-table fixture (one assertion per row) plus synthetic edges.
 * Scope: Pure decision function only. No RPC, no mocks.
 * Side-effects: reads JSON fixture from disk at test time.
 * Links: work/items/bug.0383
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decideRedeem } from "@/bootstrap/capabilities/poly-trade-executor";

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

describe("decideRedeem against real-Polygon-mainnet fixture (bug.0383)", () => {
  const fixture = loadFixture("2026-04-25");

  it("snapshot meta is sane", () => {
    expect(fixture.summary.total).toBe(fixture.cases.length);
    expect(fixture.summary.total).toBeGreaterThan(0);
    expect(fixture.summary.byAction.redeem).toBeGreaterThan(0);
    expect(fixture.summary.byAction.skip).toBeGreaterThan(0);
    expect(fixture.summary.winnersDetected.length).toBe(
      fixture.summary.byAction.redeem
    );
  });

  for (const c of fixture.cases) {
    it(`[fixture] ${c.expected.action.padEnd(6)} ${c.expected.skipReason ?? "         "} negRisk=${String(c.negativeRisk).padEnd(5)} idx=${c.outcomeIndex}  ${c.title}`, () => {
      const verdict = decideRedeem({
        balance:
          c.inputs.balanceOf_funder_heldAsset === null
            ? null
            : BigInt(c.inputs.balanceOf_funder_heldAsset),
        payoutNumerator:
          c.inputs.payoutNumerator_heldIdx === null
            ? null
            : BigInt(c.inputs.payoutNumerator_heldIdx),
        outcomeIndex: c.outcomeIndex,
      });
      if (c.expected.action === "redeem") {
        expect(verdict.ok).toBe(true);
      } else {
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) {
          expect(verdict.reason).toBe(c.expected.skipReason);
        }
      }
    });
  }

  it("winning positions in the fixture are exactly: Shanghai Haigang + Querétaro (both neg-risk)", () => {
    const winners = fixture.cases.filter((c) => c.expected.action === "redeem");
    expect(winners.map((w) => w.title).sort()).toEqual([
      "Will Querétaro FC win on 2026-04-24?",
      "Will Shanghai Haigang FC win on 2026-04-25?",
    ]);
    expect(winners.every((w) => w.negativeRisk)).toBe(true);
  });
});

// Synthetic cases for scenarios the captured snapshot doesn't cover. These
// stay in code (not fixture) because they need fabricated reads, not
// real-chain ones.
describe("decideRedeem synthetic cases not in snapshot", () => {
  it("missing outcomeIndex → skip:missing_outcome_index", () => {
    const v = decideRedeem({
      balance: 100n,
      payoutNumerator: 1n,
      outcomeIndex: undefined,
    });
    expect(v).toEqual({ ok: false, reason: "missing_outcome_index" });
  });

  it("null outcomeIndex → skip:missing_outcome_index", () => {
    const v = decideRedeem({
      balance: 100n,
      payoutNumerator: 1n,
      outcomeIndex: null,
    });
    expect(v).toEqual({ ok: false, reason: "missing_outcome_index" });
  });

  it("balance read failed → skip:read_failed", () => {
    const v = decideRedeem({
      balance: null,
      payoutNumerator: 1n,
      outcomeIndex: 0,
    });
    expect(v).toEqual({ ok: false, reason: "read_failed" });
  });

  it("payoutNumerator read failed → skip:read_failed", () => {
    const v = decideRedeem({
      balance: 100n,
      payoutNumerator: null,
      outcomeIndex: 0,
    });
    expect(v).toEqual({ ok: false, reason: "read_failed" });
  });

  it("zero balance → skip:zero_balance", () => {
    const v = decideRedeem({
      balance: 0n,
      payoutNumerator: 1n,
      outcomeIndex: 0,
    });
    expect(v).toEqual({ ok: false, reason: "zero_balance" });
  });

  it("happy path: balance>0 + winner → ok", () => {
    const v = decideRedeem({
      balance: 100n,
      payoutNumerator: 1n,
      outcomeIndex: 0,
    });
    expect(v).toEqual({ ok: true });
  });
});
