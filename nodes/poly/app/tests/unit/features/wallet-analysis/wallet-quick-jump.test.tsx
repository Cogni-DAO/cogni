// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@features/wallet-analysis/components/WalletQuickJump` tests
 * Purpose: Pin the three behaviours of the paste-any-wallet search box — valid-addr navigation, invalid-addr rejection, and enter-key submission.
 * Scope: React-testing-library component test; mocks `useRouter`. Does not hit network or render a page route.
 * Invariants: Navigation target is always lowercased before push.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0335.wallet-analysis-clickable-search.md
 * @internal
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { WalletQuickJump } from "@/features/wallet-analysis/components/WalletQuickJump";

describe("WalletQuickJump", () => {
  afterEach(() => {
    pushMock.mockReset();
    cleanup();
  });

  it("submits a valid address, lowercased", () => {
    render(<WalletQuickJump />);
    const input = screen.getByLabelText(/wallet address/i);
    fireEvent.change(input, {
      target: { value: "0x331BF91C132AF9D921E1908CA0979363FC47193F" },
    });
    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
    expect(pushMock).toHaveBeenCalledWith(
      "/research/w/0x331bf91c132af9d921e1908ca0979363fc47193f"
    );
  });

  it("rejects garbage input with an inline error and does not navigate", () => {
    render(<WalletQuickJump />);
    const input = screen.getByLabelText(/wallet address/i);
    fireEvent.change(input, { target: { value: "not-an-address" } });
    fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/valid 0x address/i);
  });

  it("presses Enter to submit", () => {
    render(<WalletQuickJump />);
    const input = screen.getByLabelText(/wallet address/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB" },
    });
    fireEvent.submit(input.closest("form")!);
    expect(pushMock).toHaveBeenCalledWith(
      "/research/w/0x7a3347d25a69e735f6e3a793ecbdca08f97a0aeb"
    );
  });

  it("Analyze button is disabled when input is empty", () => {
    render(<WalletQuickJump />);
    const btn = screen.getByRole("button", { name: /analyze/i });
    expect(btn).toBeDisabled();
  });
});
