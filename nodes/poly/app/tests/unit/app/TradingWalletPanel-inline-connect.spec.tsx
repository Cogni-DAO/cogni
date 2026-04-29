// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/TradingWalletPanel-inline-connect.spec`
 * Purpose: Lock the Money-page contract after task.0361 — when a signed-in
 *   user has no trading-wallet connection, `TradingWalletPanel` renders the
 *   wallet create flow inline (not a "go to Profile" link). Also asserts the
 *   disconnected state does NOT render a link to `/profile`.
 * Scope: Unit / jsdom with mocked fetch + session. Does not drive the connect
 *   POST — that belongs to `TradingWalletConnectFlow` itself.
 * Invariants:
 *   - PROFILE_IS_IDENTITY_ONLY (task.0361): no `/profile` escape hatch from
 *     the Money page for wallet creation.
 *   - ENABLE_TRADING_VISIBLE: this test does not regress that branch because
 *     it only exercises the disconnected state.
 * Side-effects: none (mocked fetch + session).
 * Links: nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx,
 *        work/items/task.0361.poly-first-user-onboarding-flow-v0.md
 * @vitest-environment jsdom
 */

import type { PolyWalletStatusOutput } from "@cogni/poly-node-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingWalletPanel } from "@/app/(app)/credits/TradingWalletPanel";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-onboarding-test" } },
    status: "authenticated",
  }),
}));

function withClient(ui: ReactElement): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function mockStatus(status: Partial<PolyWalletStatusOutput>): void {
  const full: PolyWalletStatusOutput = {
    configured: true,
    connected: false,
    connection_id: null,
    funder_address: null,
    trading_ready: false,
    ...status,
  } as PolyWalletStatusOutput;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/wallet/status")) {
      return { ok: true, json: async () => full } as Response;
    }
    if (url.includes("/wallet/balances")) {
      return {
        ok: true,
        json: async () => ({ usdc_e: 0, pol: 0, errors: [] }),
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("TradingWalletPanel disconnected state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the inline create-wallet flow and never links to /profile", async () => {
    mockStatus({ configured: true, connected: false });
    render(withClient(<TradingWalletPanel />));

    // Inline connect flow is present (it owns the CTA button).
    await screen.findByRole("button", {
      name: /create trading wallet/i,
    });

    // No bounce to /profile: the old dead-end is gone.
    expect(
      screen.queryByRole("link", { name: /profile/i })
    ).not.toBeInTheDocument();
  });
});
