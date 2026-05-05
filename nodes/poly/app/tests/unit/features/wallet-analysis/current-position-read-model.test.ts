// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/wallet-analysis/current-position-read-model
 * Purpose: Pin realized-PnL surfacing for closed positions. Earlier
 *   regression: closed rows force-zeroed `pnlUsd` / `pnlPct` even though
 *   `cost_basis_usdc` and `current_value_usdc` are persisted, producing the
 *   "history shows straight zeros" dashboard bug.
 * Scope: Pure read-model unit test backed by a fake `db.execute`.
 */

import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readCurrentWalletPositionModel } from "@/features/wallet-analysis/server/current-position-read-model";

const WALLET = "0xfeedface00000000000000000000000000000001";
const NOW = new Date("2026-05-05T12:00:00.000Z");

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    condition_id:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token_id: "token-1",
    shares: "10",
    cost_basis_usdc: "8",
    current_value_usdc: "10",
    avg_price: "0.8",
    last_observed_at: NOW,
    first_observed_at: NOW,
    raw: { title: "test market" },
    cursor_last_success_at: NOW,
    cursor_status: "ok",
    redeem_status: null,
    redeem_lifecycle_state: null,
    market_outcome: null,
    metadata_market_title: null,
    metadata_market_slug: null,
    metadata_event_title: null,
    metadata_event_slug: null,
    metadata_end_date: null,
    ...overrides,
  };
}

function fakeDb(rows: ReturnType<typeof makeRow>[]) {
  return {
    execute: async (_query: SQL) => ({ rows }),
  };
}

describe("readCurrentWalletPositionModel — realized PnL on closed positions", () => {
  it("surfaces realized loss for a chain-resolved loser", async () => {
    const result = await readCurrentWalletPositionModel({
      db: fakeDb([
        makeRow({
          shares: "20",
          cost_basis_usdc: "12",
          current_value_usdc: "0",
          market_outcome: "loser",
        }),
      ]),
      walletAddress: WALLET,
      capturedAt: NOW,
    });

    expect(result.positions).toHaveLength(1);
    const [position] = result.positions;
    expect(position.status).toBe("closed");
    expect(position.currentValue).toBe(0);
    expect(position.pnlUsd).toBe(-12);
    expect(position.pnlPct).toBe(-100);
  });

  it("surfaces realized profit for a redeem-job-terminal winner whose Data API row still mid-prices", async () => {
    const result = await readCurrentWalletPositionModel({
      db: fakeDb([
        makeRow({
          shares: "10",
          cost_basis_usdc: "4",
          current_value_usdc: "10",
          redeem_lifecycle_state: "redeemed",
        }),
      ]),
      walletAddress: WALLET,
      capturedAt: NOW,
    });

    const [position] = result.positions;
    expect(position.status).toBe("closed");
    expect(position.currentValue).toBe(0);
    expect(position.pnlUsd).toBe(6);
    expect(position.pnlPct).toBe(150);
  });

  it("preserves open-position pnl semantics (regression guard)", async () => {
    const result = await readCurrentWalletPositionModel({
      db: fakeDb([
        makeRow({
          shares: "20",
          cost_basis_usdc: "10",
          current_value_usdc: "16",
        }),
      ]),
      walletAddress: WALLET,
      capturedAt: NOW,
    });

    const [position] = result.positions;
    expect(position.status).toBe("open");
    expect(position.currentValue).toBe(16);
    expect(position.pnlUsd).toBe(6);
    expect(position.pnlPct).toBe(60);
  });
});
