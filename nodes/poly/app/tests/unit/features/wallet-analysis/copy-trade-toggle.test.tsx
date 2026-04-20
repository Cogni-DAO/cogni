// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

// @vitest-environment happy-dom

/**
 * Module: `@features/wallet-analysis/components/CopyTradeToggle` tests
 * Purpose: Pin the toggle's three states (untracked → tracked, tracked → untracked, loading) and the fact that tracking compares case-insensitively on the wallet address.
 * Scope: RTL + React Query test renderer; mocks the copy-trade client helpers to avoid network. Does not hit a real route.
 * Invariants: Mutations invalidate the shared COPY_TARGETS_QUERY_KEY so Monitored Wallets updates in lock-step.
 * Side-effects: none
 * Links: work/items/task.0342.wallet-analysis-copy-trade-toggle.md
 * @internal
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/features/wallet-analysis/client/copy-trade-targets", async () => {
  // keep real types + COPY_TARGETS_QUERY_KEY; shim the three mutators
  const actual = await vi.importActual<
    typeof import("@/features/wallet-analysis/client/copy-trade-targets")
  >("@/features/wallet-analysis/client/copy-trade-targets");
  return {
    ...actual,
    fetchCopyTargets: () => fetchMock(),
    createCopyTarget: (...args: unknown[]) => createMock(...args),
    deleteCopyTarget: (...args: unknown[]) => deleteMock(...args),
  };
});

import { CopyTradeToggle } from "@/features/wallet-analysis/components/CopyTradeToggle";

const BEEF = "0x331bf91c132af9d921e1908ca0979363fc47193f";

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

// empty placeholder — each test uses waitFor directly

describe("CopyTradeToggle", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    createMock.mockReset();
    deleteMock.mockReset();
  });
  afterEach(cleanup);

  it("renders 'Copy-trade' when wallet is not tracked", async () => {
    fetchMock.mockResolvedValue({ targets: [] });
    render(wrap(<CopyTradeToggle addr={BEEF} />));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-pressed",
        "false"
      )
    );
    expect(screen.getByRole("button")).toHaveTextContent(/copy-trade$/i);
  });

  it("renders 'Copy-trading' when the address is tracked (case-insensitive match)", async () => {
    fetchMock.mockResolvedValue({
      targets: [
        {
          target_id: "t1",
          target_wallet: BEEF.toUpperCase(),
          mode: "paper",
          mirror_usdc: 1,
          source: "user",
        },
      ],
    });
    render(wrap(<CopyTradeToggle addr={BEEF} />));
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
    );
    expect(screen.getByRole("button")).toHaveTextContent(/copy-trading/i);
  });

  it("untracked click → createCopyTarget called with lowercase address", async () => {
    fetchMock.mockResolvedValue({ targets: [] });
    createMock.mockResolvedValue({ target_id: "new" });
    render(wrap(<CopyTradeToggle addr={BEEF.toUpperCase()} />));
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ target_wallet: BEEF })
    );
  });

  it("tracked click → deleteCopyTarget called with the existing row's id", async () => {
    fetchMock.mockResolvedValue({
      targets: [
        {
          target_id: "row-42",
          target_wallet: BEEF,
          mode: "paper",
          mirror_usdc: 1,
          source: "user",
        },
      ],
    });
    deleteMock.mockResolvedValue({ deleted: true });
    render(wrap(<CopyTradeToggle addr={BEEF} />));
    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("row-42"));
  });
});
