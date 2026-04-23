// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@features/wallet-analysis/components/WalletProfitLossCard` tests
 * Purpose: Pin the shared P/L panel behaviour for both empty and populated
 *          histories so we do not regress back to a null chart hole.
 * Scope: React-testing-library component test. No network, no route calls.
 * Invariants:
 *   - EMPTY_BASELINE: empty histories render the zero-state panel.
 *   - REAL_VALUE_WINS: populated histories show the latest realized P/L.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md
 * @internal
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletProfitLossCard } from "@/features/wallet-analysis/components/WalletProfitLossCard";

describe("WalletProfitLossCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an honest zero-state panel when history is empty", () => {
    render(<WalletProfitLossCard history={[]} interval="ALL" />);

    expect(screen.getAllByText("Profit/Loss")).toHaveLength(2);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText(/no realized p\/l yet/i)).toBeInTheDocument();
  });

  it("shows the latest realized pnl and forwards interval changes", () => {
    const onIntervalChange = vi.fn();

    render(
      <WalletProfitLossCard
        history={[
          { ts: "2026-04-20T00:00:00.000Z", pnl: 0 },
          { ts: "2026-04-21T00:00:00.000Z", pnl: 3.5 },
        ]}
        interval="ALL"
        onIntervalChange={onIntervalChange}
      />
    );

    expect(screen.getByText("+$3.50")).toBeInTheDocument();

    fireEvent.click(screen.getByText("1W"));
    expect(onIntervalChange).toHaveBeenCalledWith("1W");
  });
});
