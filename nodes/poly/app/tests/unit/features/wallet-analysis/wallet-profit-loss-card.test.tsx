// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@features/wallet-analysis/components/WalletProfitLossCard` tests
 * Purpose: Pin the shared P/L panel behaviour for both empty and populated
 *          histories so we do not regress back to a null chart hole.
 * Scope: React-testing-library component test. No network, no route calls.
 * Invariants:
 *   - EMPTY_BASELINE: empty histories render the zero-state panel with "—",
 *     not a fake "$0.00" baseline.
 *   - WINDOWED_DELTA: populated histories show `last.pnl − first.pnl`, not the
 *     raw `last.pnl` (which is lifetime cumulative regardless of interval —
 *     task.0389).
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md
 * @internal
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeWindowedPnl,
  WalletProfitLossCard,
} from "@/features/wallet-analysis/components/WalletProfitLossCard";

describe("WalletProfitLossCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an honest zero-state panel when history is empty", () => {
    render(<WalletProfitLossCard history={[]} interval="ALL" />);

    expect(screen.getAllByText("Profit/Loss")).toHaveLength(2);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/no p\/l history yet/i)).toBeInTheDocument();
  });

  it("shows windowed delta (last − first) and forwards interval changes", () => {
    const onIntervalChange = vi.fn();

    // Cumulative-as-of-window-start = 100, cumulative-as-of-window-end = 103.5
    // → windowed delta = +3.5. Reading `last` alone would render +$103.50
    // (the same lifetime-cumulative number for any interval). Card must show +$3.50.
    render(
      <WalletProfitLossCard
        history={[
          { ts: "2026-04-20T00:00:00.000Z", pnl: 100 },
          { ts: "2026-04-21T00:00:00.000Z", pnl: 103.5 },
        ]}
        interval="ALL"
        onIntervalChange={onIntervalChange}
      />
    );

    expect(screen.getByText("+$3.50")).toBeInTheDocument();
    expect(screen.queryByText("+$103.50")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("1W"));
    expect(onIntervalChange).toHaveBeenCalledWith("1W");
  });
});

describe("computeWindowedPnl", () => {
  it("returns null for empty/undefined history", () => {
    expect(computeWindowedPnl(undefined)).toBeNull();
    expect(computeWindowedPnl([])).toBeNull();
  });

  it("returns null for a single point — delta not expressible", () => {
    expect(
      computeWindowedPnl([{ ts: "2026-04-20T00:00:00.000Z", pnl: 42 }])
    ).toBeNull();
  });

  it("returns last − first for multi-point histories", () => {
    expect(
      computeWindowedPnl([
        { ts: "2026-04-20T00:00:00.000Z", pnl: 100 },
        { ts: "2026-04-21T00:00:00.000Z", pnl: 103.5 },
      ])
    ).toBe(3.5);
  });

  it("returns a negative delta when the wallet lost over the window", () => {
    expect(
      computeWindowedPnl([
        { ts: "2026-04-20T00:00:00.000Z", pnl: 105_126.63 },
        { ts: "2026-04-21T00:00:00.000Z", pnl: 92_000 },
        { ts: "2026-04-22T00:00:00.000Z", pnl: 87_687.38 },
      ])
    ).toBeCloseTo(-17_439.25, 2);
  });
});
