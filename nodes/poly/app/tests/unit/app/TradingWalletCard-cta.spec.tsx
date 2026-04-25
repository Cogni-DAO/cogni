// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/TradingWalletCard-cta.spec`
 * Purpose: Guard the three first-time-user CTA states on the dashboard
 *   `TradingWalletCard` introduced in task.0361 — no-wallet, trading-not-ready,
 *   and ready. Locks the link text + target so the onboarding nudges do not
 *   regress silently.
 * Scope: Unit / jsdom with mocked fetch. Does not exercise P/L chart internals.
 * Invariants: STATE_DRIVEN_UI (task.0361) — step lives in wallet state, UI reads it.
 * Side-effects: none (mocked fetch)
 * Links: nodes/poly/app/src/app/(app)/dashboard/_components/TradingWalletCard.tsx,
 *        work/items/task.0361.poly-first-user-onboarding-flow-v0.md
 * @vitest-environment jsdom
 */

import type {
  PolyWalletOverviewOutput,
  PolyWalletStatusOutput,
} from "@cogni/node-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TradingWalletCard } from "@/app/(app)/dashboard/_components/TradingWalletCard";

// Stub the P/L chart — it pulls recharts / DOM measurements that jsdom
// cannot satisfy and is orthogonal to the CTA branches under test.
vi.mock("@/features/wallet-analysis", () => ({
  BalanceBar: () => null,
  WalletProfitLossCard: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }): ReactElement => <a href={href}>{children}</a>,
}));

function withClient(ui: ReactElement): ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function mockFetch(
  overview: Partial<PolyWalletOverviewOutput>,
  status?: Partial<PolyWalletStatusOutput>
): void {
  const fullOverview: PolyWalletOverviewOutput = {
    configured: true,
    connected: false,
    address: null,
    interval: "ALL",
    capturedAt: new Date().toISOString(),
    pol_gas: null,
    usdc_available: null,
    usdc_locked: null,
    usdc_positions_mtm: null,
    usdc_total: null,
    open_orders: null,
    pnlHistory: [],
    warnings: [],
    ...overview,
  };
  const fullStatus: PolyWalletStatusOutput = {
    configured: true,
    connected: false,
    connection_id: null,
    funder_address: null,
    trading_ready: false,
    ...(status ?? {}),
  } as PolyWalletStatusOutput;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/wallet/overview")) {
      return {
        ok: true,
        json: async () => fullOverview,
      } as Response;
    }
    if (url.includes("/wallet/status")) {
      return {
        ok: true,
        json: async () => fullStatus,
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("TradingWalletCard onboarding CTAs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Connect wallet →' CTA pointing at /credits when no wallet is connected", async () => {
    mockFetch({ connected: false });
    render(withClient(<TradingWalletCard />));

    const link = await screen.findByRole("link", { name: /Connect wallet →/ });
    expect(link).toHaveAttribute("href", "/credits");
    expect(
      screen.getByText(/No trading wallet connected yet/i)
    ).toBeInTheDocument();
  });

  it("renders 'Enable trading →' CTA when connected but approvals are pending", async () => {
    mockFetch(
      {
        connected: true,
        address: "0x0000000000000000000000000000000000000001",
      },
      {
        connected: true,
        trading_ready: false,
        funder_address: "0x0000000000000000000000000000000000000001",
        connection_id: "conn-1",
      }
    );
    render(withClient(<TradingWalletCard />));

    const link = await screen.findByRole("link", { name: /Enable trading →/ });
    expect(link).toHaveAttribute("href", "/credits");
    expect(screen.getByText(/Trading not enabled/i)).toBeInTheDocument();
  });

  it("does not render an onboarding CTA when the wallet is ready", async () => {
    mockFetch(
      {
        connected: true,
        address: "0x0000000000000000000000000000000000000002",
        pol_gas: 0.5,
        usdc_available: 10,
        usdc_locked: 0,
        usdc_positions_mtm: 0,
        usdc_total: 10,
        open_orders: 0,
      },
      {
        connected: true,
        trading_ready: true,
        funder_address: "0x0000000000000000000000000000000000000002",
        connection_id: "conn-2",
      }
    );
    render(withClient(<TradingWalletCard />));

    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Connect wallet →/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Enable trading →/ })
      ).not.toBeInTheDocument();
    });
  });
});
